"""Counterset as a tool for other agents: a small MCP server over plain HTTP.

Any MCP client can audit a festival day or ask for a rescue. These tools run the solver and
read recorded Qloo evidence only; they spend no live Qloo calls and no model calls.
"""

import json
import time
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response
from .domain import Day, canonical_pair
from .evidence import all_edges
from .repair import apply_scenario, as_run_audit
from .solver import solve
from .validator import audit

PROTOCOL = "2025-03-26"
TOOLS = [
    {
        "name": "list_days",
        "description": "List the festival days this server holds, with their ids.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "audit_day",
        "description": "List the pairs of acts on a day that share a crowd according to Qloo and play at the same time.",
        "inputSchema": {"type": "object", "properties": {"day_id": {"type": "string"}}, "required": ["day_id"], "additionalProperties": False},
    },
    {
        "name": "rescue_day",
        "description": "Close the whole site for a window and solve the day again. Sets may shrink to shortest_percent, and may be dropped if allow_drop is true. Returns what plays, what is dropped and what clashes. Changes nothing.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "day_id": {"type": "string"},
                "closed_from": {"type": "integer", "description": "Minutes after midnight"},
                "closed_until": {"type": "integer", "description": "Minutes after midnight"},
                "curfew": {"type": "integer", "description": "Minutes after midnight"},
                "shortest_percent": {"type": "integer", "minimum": 40, "maximum": 100},
                "allow_drop": {"type": "boolean"},
            },
            "required": ["day_id", "closed_from", "closed_until"],
            "additionalProperties": False,
        },
    },
    {
        "name": "why_share_a_crowd",
        "description": "Qloo's ranks for two acts on a day, and the taste tags their crowds share.",
        "inputSchema": {
            "type": "object",
            "properties": {"day_id": {"type": "string"}, "act_a": {"type": "string"}, "act_b": {"type": "string"}},
            "required": ["day_id", "act_a", "act_b"],
            "additionalProperties": False,
        },
    },
]


def find_act(day, text):
    wanted = text.strip().lower()
    for a in day.acts:
        if a.id == text or a.name.lower() == wanted:
            return a
    raise ValueError(f"No act called {text!r} on this day")


def pairs(day, checked):
    names = {a.id: a.name for a in day.acts}
    return [
        {"a": names[c["a"]], "b": names[c["b"]], "minutes_at_once": c["minutes"], "ranks": c.get("ranks")}
        for c in checked["conflicts"]
        if c["source"] in {"qloo", "must_see"}
    ]


def call(examples, name, args):
    if name == "list_days":
        return [{"id": e["id"], "title": e["title"], "summary": e["summary"]} for e in examples.list()]
    ex = examples.get(args.get("day_id", ""))
    day = Day.model_validate(ex["day"])
    evidence = ex.get("evidence") or {}
    if name == "audit_day":
        checked = audit(day, day.draft, all_edges(day, evidence))
        return {"sets": len(day.acts), "clashes": pairs(day, checked), "unknown_pairs": checked["counts"]["unknown"], "scope": "Qloo ranks read inside one response each. Not attendance."}
    if name == "why_share_a_crowd":
        a, b = find_act(day, args["act_a"]), find_act(day, args["act_b"])
        ranks = evidence.get("ranks", {})
        return {
            "a": a.name,
            "b": b.name,
            "a_ranks_b": ranks.get(a.id, {}).get(b.id),
            "b_ranks_a": ranks.get(b.id, {}).get(a.id),
            "shared_tags": evidence.get("explain", {}).get("|".join(canonical_pair(a.id, b.id)), []),
        }
    if name == "rescue_day":
        from .repair import site_hold

        if args["closed_until"] <= args["closed_from"]:
            raise ValueError("closed_until must be after closed_from")
        held = site_hold(day, args["closed_from"], args["closed_until"], "Site closed")
        terms = {"shortest": args.get("shortest_percent", 100), "allow_cut": bool(args.get("allow_drop")), "curfew": args.get("curfew")}
        solved_day = apply_scenario(held, terms)
        out = solve(solved_day, all_edges(solved_day, evidence), len(day.acts), 6)
        if not out.get("placements"):
            return {"status": out["status"], "rules_in_conflict": out.get("core", []), "note": out.get("core_scope")}
        a = out["audit"]
        names = {x.id: x.name for x in day.acts}
        result = {
            "status": out["status"],
            "sets_played": len(day.acts) - len(a["cuts"]),
            "sets_total": len(day.acts),
            "dropped": [names[i] for i in a["cuts"]],
            "minutes_shortened": a["trim_minutes"],
            "acts_moved": a["moves"],
            "clashes_left": pairs(day, a),
            "note": "A proposal only. A person approves changes. Assumes acts accept these terms.",
        }
        if ex["context"].get("as_run"):
            ran = as_run_audit(solved_day.model_copy(update={"allow_cut": True}), evidence, ex["context"]["as_run"])
            result["what_really_happened"] = {"cancelled": len(ran["cuts"]), "clashes": pairs(day, ran)}
        return result
    raise ValueError(f"Unknown tool {name}")


def mount_mcp(app, cfg, examples):
    hits = {}

    @app.post("/mcp")
    async def mcp(request: Request):
        ip = request.client.host if request.client else "unknown"
        now = time.time()
        recent = [t for t in hits.get(ip, []) if now - t < 60]
        if len(recent) >= 30:
            return Response("Too many requests", status_code=429)
        hits[ip] = [*recent, now]
        try:
            body = await request.json()
        except ValueError:
            return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, status_code=400)
        rid, method = body.get("id"), body.get("method")
        if rid is None:
            return Response(status_code=202)

        def ok(result):
            return JSONResponse({"jsonrpc": "2.0", "id": rid, "result": result})

        if method == "initialize":
            return ok({"protocolVersion": PROTOCOL, "capabilities": {"tools": {}}, "serverInfo": {"name": "counterset", "version": "1.0.0"}})
        if method == "ping":
            return ok({})
        if method == "tools/list":
            return ok({"tools": TOOLS})
        if method == "tools/call":
            params = body.get("params") or {}
            try:
                out = call(examples, params.get("name"), params.get("arguments") or {})
                return ok({"content": [{"type": "text", "text": json.dumps(out, indent=1)}], "isError": False})
            except (ValueError, KeyError, HTTPException) as e:
                text = e.detail if isinstance(e, HTTPException) else str(e)
                return ok({"content": [{"type": "text", "text": str(text)}], "isError": True})
        return JSONResponse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "Method not found"}})
