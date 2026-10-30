from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import csv
import io
import json
import secrets
import time
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import Field
from .agent import brief, llm_baseline, propose_changes
from . import desk_agent
from .config import Config
from .domain import Day, Placement, Priority, Strict, Kind, QLOO_TYPES, digest, reference_hash
from .evidence import age_days, all_edges, attendee_edges, entities, fetch_snapshot, genre_edges, identity_key
from .examples import Examples
from .fixtures import demo
from .providers import Gateway, ProviderError
from .repair import apply_scenario, as_run_audit, hold_stage, placements, plan, site_hold
from .solver import solve
from .stats import random_fill
from .store import Store
from .validator import audit

STALE_DAYS = 30


class Versioned(Strict):
    version: int


class Terms(Strict):
    curfew: int | None = Field(default=None, ge=0, le=2880)
    shortest: int = Field(default=100, ge=40, le=100)
    allow_cut: bool = False
    # Replay days only: solve as if the site closed when it really did.
    close_site: bool = False


class Repair(Versioned):
    move_budget: int = Field(default=4, ge=0, le=50)
    seconds: float = Field(default=8, ge=0.01, le=30)
    scenario: Terms | None = None


class AgentRun(Versioned):
    text: str = Field(min_length=1, max_length=4000)
    mode: str = "replay"
    model: str = "gemini-3.5-flash-lite"


class Change(Versioned):
    day: Day


class EvidenceRequest(Versioned):
    source: str = "cache"
    refresh: bool = False


class Publish(Versioned):
    proposal_id: str
    option: int = Field(default=0, ge=0, le=3)


class Message(Versioned):
    text: str = Field(min_length=1, max_length=6000)
    model: str = "gemma-4-31b-it"


class Decision(Strict):
    index: int = Field(ge=0, le=10)
    approve: bool


class Review(Versioned):
    note_id: str
    decisions: list[Decision] = Field(min_length=1, max_length=10)


class Briefing(Strict):
    model: str = "gemini-3.5-flash-lite"


class Baseline(Repair):
    model: str | None = "gemini-3.5-flash-lite"


class Hold(Versioned):
    stage_id: str
    start: int = Field(ge=0, le=2880)
    end: int = Field(ge=0, le=2880)
    reason: str = Field(default="Stage hold", max_length=200)


class Pin(Versioned):
    act_id: str


class Identity(Versioned):
    act_id: str
    qloo_id: str | None = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    )
    kind: Kind | None = None


class Resolve(Strict):
    query: str = Field(min_length=1, max_length=120)
    kind: Kind = "artist"


def create_app(config=None):
    cfg = config or Config()
    store = Store(cfg.private / "counterset.sqlite3")
    gateway = Gateway(cfg)
    examples = Examples(cfg.private / "examples")
    pool = ThreadPoolExecutor(max_workers=2)
    fills = {}
    agent_hits = {}
    app = FastAPI(title="Counterset", docs_url="/api/docs")
    app.state.store = store
    app.state.gateway = gateway
    for old in store.list("job"):
        if old["status"] == "RUNNING":
            store.put(
                "job",
                {
                    **old,
                    "status": "FAILED",
                    "error": "The server restarted during this job. Nothing was applied. Retry; Qloo rows already fetched are cached.",
                },
                old["id"],
            )

    @app.exception_handler(ProviderError)
    async def provider_error(request, error):
        return JSONResponse(status_code=503, content={"detail": str(error)})

    @app.exception_handler(ValueError)
    async def value_error(request, error):
        return JSONResponse(status_code=422, content={"detail": str(error)[:1500]})

    @app.middleware("http")
    async def protect(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            if cfg.access_token and not secrets.compare_digest(
                request.headers.get("authorization", ""), f"Bearer {cfg.access_token}"
            ):
                return Response("Authentication required", status_code=401)
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                length = request.headers.get("content-length")
                if length and length.isdigit() and int(length) > 400_000:
                    return Response("Request too large", status_code=413)
                if request.headers.get("x-counterset") != "workspace":
                    return Response("Workspace header required", status_code=403)
                origin = request.headers.get("origin")
                if origin and origin != str(request.base_url).rstrip("/"):
                    return Response("Cross-origin mutation refused", status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def current(id, version=None):
        p = store.get("project", id)
        if version is not None and p["version"] != version:
            raise HTTPException(409, "The workspace changed since you loaded it. Reload, then repeat the action.")
        return p, Day.model_validate(p["day"])

    def bump(id, p, day, reason):
        p["day"] = day.model_dump()
        p["version"] += 1
        p["status"] = "DRAFT"
        p.setdefault("history", []).append({"version": p["version"], "reason": reason, "at": time.time()})
        store.put("project", p, id)
        return p

    def change_day(id, p, old, new, reason):
        if identity_key(old) != identity_key(new):
            p["evidence"] = {}
        return bump(id, p, new, reason)

    def background(label, fn):
        id = store.put("job", {"status": "RUNNING", "label": label, "progress": 0, "created": time.time()})

        def progress(n, total, detail=None):
            store.put(
                "job",
                {"status": "RUNNING", "label": label, "progress": n / max(total, 1), "detail": detail or label},
                id,
            )

        def run():
            try:
                result = fn(progress)
                store.put("job", {"status": "COMPLETED", "label": label, "result": result, "progress": 1}, id)
            except Exception as e:
                message = (
                    str(e)
                    if isinstance(e, (ProviderError, ValueError))
                    else e.detail
                    if isinstance(e, HTTPException)
                    else "Operation failed; nothing was applied"
                )
                store.put("job", {"status": "FAILED", "label": label, "error": message}, id)

        pool.submit(run)
        return {"job_id": id}

    def fill(day, evidence, places):
        if not evidence.get("edges"):
            return None
        key = digest({"e": evidence["id"], "p": [p.model_dump() for p in places], "t": day.threshold, "b": day.buffer})
        if key not in fills:
            fills[key] = random_fill(day, places, evidence["edges"], seed=17)
        return fills[key]

    def ran(day, p):
        """The record of what really happened on this day, scored like any repair."""
        context = p.get("context", {})
        if not context.get("as_run") or p["version"] != 1:
            return None
        terms = {"curfew": context.get("storm", {}).get("curfew"), "allow_cut": True}
        return as_run_audit(apply_scenario(day, terms), p["evidence"], context["as_run"])

    def evidence_state(e):
        if not e:
            return {"loaded": False}
        age = age_days(e)
        return {"loaded": True, "age_days": round(age, 1), "stale": age > STALE_DAYS}

    @app.get("/api/config")
    def settings():
        return {
            "public": cfg.public,
            "qloo_configured": bool(cfg.qloo_key) and not cfg.public,
            "model_configured": bool(cfg.model_key),
            "models": cfg.models,
            "budget": gateway.budget(),
            "examples": examples.list(),
            "local_only": not bool(cfg.access_token),
            "stale_days": STALE_DAYS,
        }

    @app.get("/api/projects")
    def projects():
        # A public deployment never lists other visitors' workspaces.
        if cfg.public:
            return []
        return [
            {"id": p["id"], "name": p["day"]["name"], "version": p["version"], "kind": p.get("context", {}).get("kind")}
            for p in store.list("project")
        ]

    def new_project(day, evidence, context):
        p = {
            "day": day.model_dump(),
            "version": 1,
            "evidence": evidence or {},
            "status": "DRAFT",
            "published": [],
            "context": context,
            "history": [{"version": 1, "reason": "Created", "at": time.time()}],
        }
        id = store.put("project", p)
        return {"id": id, **p}

    @app.post("/api/projects")
    def create(day: Day | None = None):
        if day is None:
            return new_project(
                demo(),
                {},
                {
                    "kind": "synthetic",
                    "title": "Blank rehearsal",
                    "note": "Rehearsal fixture: real artist names, illustrative festival, timings and contracts. Confirm identities and load evidence.",
                },
            )
        return new_project(day, {}, {"kind": "operator_supplied", "note": "Imported production facts. Confirm identities and constraints before publishing."})

    @app.post("/api/examples/{example_id}")
    def open_example(example_id: str):
        ex = examples.get(example_id)
        return new_project(Day.model_validate(ex["day"]), ex.get("evidence"), ex["context"])

    @app.get("/api/projects/{id}")
    def project(id):
        p, day = current(id)
        edges = all_edges(day, p["evidence"])
        return {
            "id": id,
            **p,
            "evidence_state": evidence_state(p["evidence"]),
            "audit": audit(day, day.draft, edges),
            "as_run_audit": ran(day, p),
            "random_fill": fill(day, p["evidence"], day.draft),
            "proposals": [r for r in store.list("proposal") if r["project"] == id][:6],
            "notes": [r for r in store.list("note") if r["project"] == id][:10],
            "versions": [
                {k: v for k, v in store.get("published", x).items() if k in {"number", "published_at", "audit", "option_priority", "reason"}} | {"id": x}
                for x in p["published"]
            ],
        }

    @app.put("/api/projects/{id}")
    def change(id, req: Change):
        with store.lock:
            p, old = current(id, req.version)
            return change_day(id, p, old, req.day, "Facts edited")

    @app.post("/api/resolve")
    def resolve(req: Resolve):
        if cfg.public:
            raise HTTPException(403, "Live Qloo search is off on the public demo. The worked examples use recorded Qloo rows.")
        payload, source = gateway.qloo("/search", {"query": req.query, "types": QLOO_TYPES[req.kind], "take": 5})
        return {
            "source": source,
            "candidates": [
                {
                    "id": e["entity_id"],
                    "name": e.get("name"),
                    "disambiguation": e.get("disambiguation"),
                    "types": e.get("types", []),
                }
                for e in entities(payload)
            ],
        }

    @app.post("/api/projects/{id}/identity")
    def identity(id, req: Identity):
        with store.lock:
            p, day = current(id, req.version)
            act = next((a for a in day.acts if a.id == req.act_id), None)
            if act is None:
                raise HTTPException(422, "Unknown act")
            act.qloo_id = req.qloo_id
            if req.kind:
                act.kind = req.kind
            new = Day.model_validate(day.model_dump())
            reason = f"{act.name}: identity {'confirmed' if req.qloo_id else 'cleared'}"
            return change_day(id, p, Day.model_validate(p["day"]), new, reason)

    @app.post("/api/projects/{id}/evidence")
    def evidence(id, req: EvidenceRequest):
        p, day = current(id, req.version)
        if req.source == "live" and cfg.public:
            raise HTTPException(403, "Live Qloo queries are off on the public demo. The worked examples use recorded Qloo rows.")
        if req.source not in {"cache", "live"}:
            raise HTTPException(422, "Choose cache or live evidence")
        if sum(bool(a.qloo_id) for a in day.acts) < 2:
            raise HTTPException(422, "Confirm at least two identities first")
        if req.source == "live" and not cfg.qloo_key:
            raise HTTPException(422, "No Qloo key is configured on this server")

        def work(progress):
            snapshot = fetch_snapshot(day, gateway, progress, req.refresh, offline=req.source == "cache")
            if req.source == "cache" and not any(v for v in snapshot["ranks"].values()):
                raise ValueError("This lineup has no cached Qloo rows. Query it live with a configured key.")
            with store.lock:
                fresh, _ = current(id, req.version)
                fresh["evidence"] = snapshot
                bump(id, fresh, day, f"Evidence loaded: {snapshot['status'].lower()}, {len(snapshot['edges'])} cues")
            return {"evidence_id": snapshot["id"], "status": snapshot["status"]}

        return background("Qloo evidence", work)

    @app.post("/api/projects/{id}/repair")
    def repair(id, req: Repair):
        p, day = current(id, req.version)
        if not p["evidence"]:
            raise HTTPException(422, "Load Qloo evidence before repairing")
        hash = reference_hash(day, p["evidence"])

        scenario = req.scenario.model_dump(exclude_none=True) if req.scenario else None
        base = day
        if scenario and scenario.pop("close_site", False):
            storm = p.get("context", {}).get("storm")
            if not storm:
                raise HTTPException(422, "This day has no recorded closure")
            base = site_hold(day, storm["start"], storm["end"], "Site evacuated")
            scenario["close_site"] = True

        def work(progress):
            result = plan(base, p["evidence"], req.move_budget, req.seconds, progress, scenario)
            result.update(
                {
                    "project": id,
                    "input_version": req.version,
                    "input_hash": hash,
                    "evidence_id": p["evidence"].get("id"),
                    "budget": req.move_budget,
                    "created": time.time(),
                }
            )
            if scenario:
                result["scenario"] = scenario
                result["day"] = apply_scenario(base, scenario).model_dump()
            pid = store.put("proposal", result)
            return {"proposal_id": pid, **result}

        return background("Schedule repair", work)

    def agent_allowed(request):
        """Live runs spend a shared free model quota, so each visitor gets a few."""
        now = time.time()
        ip = request.client.host if request.client else "unknown"
        hits = [t for t in agent_hits.get(ip, []) if now - t < 3600]
        total = sum(1 for v in agent_hits.values() for t in v if now - t < 86400)
        if len(hits) >= cfg.agent_per_hour or total >= cfg.agent_per_day:
            raise HTTPException(429, "Live agent runs are capped on the public demo. Watch the recorded run: its tools are re-run for you now.")
        agent_hits[ip] = [*hits, now]

    @app.post("/api/projects/{id}/agent")
    def agent_run(id, req: AgentRun, request: Request):
        p, day = current(id, req.version)
        if not p["evidence"]:
            raise HTTPException(422, "Load Qloo evidence before running the agent")
        context = p.get("context", {})
        recorded = context.get("recorded_run")
        if req.mode == "replay":
            if not recorded:
                raise HTTPException(422, "This day has no recorded run. Run the agent live.")
            if p["version"] != 1 or req.text != recorded["message"]:
                raise HTTPException(409, "The recorded run only fits the untouched day and its original message. Run the agent live instead.")
        elif req.mode == "live":
            if not cfg.model_key:
                raise HTTPException(422, "No model is configured. Watch the recorded run instead.")
            if req.model not in cfg.models:
                raise HTTPException(422, "Choose a configured model")
            if cfg.public:
                agent_allowed(request)
        else:
            raise HTTPException(422, "Choose live or replay")
        hash = reference_hash(day, p["evidence"])
        jid = store.put("job", {"status": "RUNNING", "label": "Rescue agent", "progress": 0, "trace": [], "created": time.time(), "mode": req.mode})
        trace = []

        def step(item):
            trace.append({k: v for k, v in item.items()})
            store.put(
                "job",
                {"status": "RUNNING", "label": "Rescue agent", "progress": min(0.95, len(trace) / 11), "detail": item["line"], "trace": trace, "mode": req.mode},
                jid,
            )

        def run():
            try:
                outcome = desk_agent.run(
                    day, p["evidence"], context, req.text, gateway, req.model, step,
                    turns=recorded["decisions"] if req.mode == "replay" else None, seconds=10,
                )
                proposal = desk_agent.to_proposal(outcome, day)
                proposal.update(
                    {
                        "project": id,
                        "input_version": req.version,
                        "input_hash": hash,
                        "evidence_id": p["evidence"].get("id"),
                        "created": time.time(),
                        "trace": trace,
                        "mode": req.mode,
                        "recorded": {k: recorded[k] for k in ("model", "at")} if req.mode == "replay" else None,
                        "model": req.model if req.mode == "live" else recorded["model"],
                        "usage": outcome["usage"],
                        "decisions": outcome["decisions"],
                        "message": req.text,
                    }
                )
                pid = store.put("proposal", proposal)
                store.put(
                    "job",
                    {"status": "COMPLETED", "label": "Rescue agent", "progress": 1, "trace": trace, "mode": req.mode, "result": {"proposal_id": pid, **proposal}},
                    jid,
                )
            except Exception as e:
                known = isinstance(e, (ProviderError, ValueError, desk_agent.AgentStop))
                message = str(e) if known else "The agent stopped; nothing was applied"
                store.put("job", {"status": "FAILED", "label": "Rescue agent", "error": message, "trace": trace, "mode": req.mode}, jid)

        pool.submit(run)
        return {"job_id": jid}

    @app.get("/api/rescue-table")
    def rescue_table():
        """The storm replay under every pair of terms, for the public page's live control."""
        try:
            return examples.get("bonnaroo-2026-sunday")["context"]["rescue_table"]
        except (KeyError, HTTPException):
            raise HTTPException(404, "The storm replay is not installed here") from None

    @app.post("/api/proposals/{pid}/briefing")
    def briefing(pid, req: Briefing):
        proposal = store.get("proposal", pid)
        p, day = current(proposal["project"])
        if proposal["input_version"] != p["version"]:
            raise HTTPException(409, "This proposal is stale")
        if not cfg.model_key:
            raise HTTPException(422, "No model is configured; the computed options are complete without a briefing")

        def work(progress):
            progress(0, 1, "Briefing from computed facts")
            out = brief(day, proposal, gateway, req.model)
            proposal["briefing"] = out
            store.put("proposal", proposal, pid)
            return out

        return background("Agent briefing", work)

    @app.post("/api/projects/{id}/pin")
    def pin(id, req: Pin):
        with store.lock:
            p, day = current(id, req.version)
            act = next((a for a in day.acts if a.id == req.act_id), None)
            if act is None:
                raise HTTPException(422, "Unknown act")
            act.locked = True
            return bump(id, p, day, f"{act.name} pinned to its draft placement")

    @app.post("/api/projects/{id}/hold")
    def hold(id, req: Hold):
        with store.lock:
            p, day = current(id, req.version)
            return bump(id, p, hold_stage(day, req.stage_id, req.start, req.end, req.reason), f"Stage hold {req.reason}")

    @app.post("/api/projects/{id}/messages")
    def message(id, req: Message):
        p, day = current(id, req.version)
        if not cfg.model_key:
            raise HTTPException(422, "No model is configured. Add the constraint with Stage hold or Edit act.")

        def work(progress):
            progress(0, 1, f"{req.model} is reading the message; nothing is applied")
            result = propose_changes(day, req.text, gateway, req.model)
            result.update({"project": id, "input_version": req.version, "source_text": req.text, "model": req.model, "created": time.time()})
            nid = store.put("note", result)
            return {"note_id": nid, **result}

        return background("Read production message", work)

    @app.post("/api/projects/{id}/messages/review")
    def review(id, req: Review):
        with store.lock:
            p, day = current(id, req.version)
            note = store.get("note", req.note_id)
            if note["project"] != id or note["input_version"] != req.version:
                raise HTTPException(409, "These proposed changes were read from an older version. Send the message again.")
            applied = []
            for d in req.decisions:
                if d.index >= len(note["items"]):
                    raise HTTPException(422, "Unknown proposed change")
                item = note["items"][d.index]
                if item["status"] != "PENDING_REVIEW":
                    raise HTTPException(409, "That change was already reviewed or rejected")
                if not d.approve:
                    item["status"] = "DECLINED"
                    continue
                acts = {a.id: a for a in day.acts}
                if item["action"] == "stage_hold":
                    day = hold_stage(day, item["stage_id"], item["start"], item["end"], item["quote"][:200])
                elif item["action"] == "not_before":
                    acts[item["act_id"]].earliest = item["value"]
                elif item["action"] == "finish_by":
                    acts[item["act_id"]].latest = item["value"]
                elif item["action"] == "lock":
                    acts[item["act_id"]].locked = True
                else:
                    raise HTTPException(422, "Unsupported items need a person to act on them")
                item["status"] = "APPROVED"
                applied.append(item["quote"])
            if applied:
                day = Day.model_validate(day.model_dump())
                bump(id, p, day, "Approved from message: " + "; ".join(applied)[:300])
            store.put("note", note, req.note_id)
            return note

    @app.post("/api/projects/{id}/publish")
    def publish(id, req: Publish):
        with store.lock:
            p, day = current(id, req.version)
            proposal = store.get("proposal", req.proposal_id)
            if (
                proposal["project"] != id
                or proposal["input_version"] != req.version
                or proposal["input_hash"] != reference_hash(day, p["evidence"])
            ):
                raise HTTPException(409, "This proposal was computed for an older version. Repair again.")
            if evidence_state(p["evidence"]).get("stale"):
                raise HTTPException(409, f"Evidence is older than {STALE_DAYS} days. Refresh it before publishing.")
            if req.option >= len(proposal["options"]):
                raise HTTPException(422, "Unknown option")
            option = proposal["options"][req.option]
            if option["status"] not in {"OPTIMAL", "FEASIBLE"}:
                raise HTTPException(422, "That option has no feasible schedule")
            places = [Placement.model_validate(x) for x in option["placements"]]
            # An agent or rescue repair carries its own terms; they only become real here.
            if proposal.get("day"):
                day = Day.model_validate(proposal["day"])
            checked = audit(day, places, all_edges(day, p["evidence"]), proposal["budget"])
            if not checked["passed"] or checked["counts"] != option["audit"]["counts"]:
                raise HTTPException(422, "The independent validator rejected this schedule")
            before = [x.model_dump() for x in day.draft]
            number = len(p["published"]) + 1
            pub = {
                "project": id,
                "number": number,
                "input_hash": proposal["input_hash"],
                "proposal_id": req.proposal_id,
                "option": req.option,
                "option_priority": option["priority"],
                "notices": proposal.get("notices", []),
                "solver_status": option["status"],
                "placements": option["placements"],
                "previous": before,
                "audit": checked,
                "without_qloo": {k: v for k, v in option.get("without_qloo", {}).items() if k in {"protected", "status", "identical"}},
                "published_at": time.time(),
                "day": day.model_dump(),
                "context": p.get("context", {}),
                "evidence_id": p["evidence"].get("id"),
                "evidence_status": p["evidence"].get("status"),
            }
            pubid = store.put("published", pub)
            p["published"].append(pubid)
            # The approved lengths become the new facts, and the rescue terms close again.
            for act, place in ((a, next(x for x in places if x.act_id == a.id)) for a in day.acts):
                if place.length is not None:
                    act.duration = place.length
                    place.length = None
                act.min_duration = None
            day.draft = places
            day.allow_trim = day.allow_cut = False
            p = bump(id, p, day, f"Published v{number}")
            p["status"] = "PUBLISHED"
            store.put("project", p, id)
            return {"published_id": pubid, **pub}

    @app.get("/api/published/{id}/export")
    def export(id, format: str = "json"):
        pub = store.get("published", id)
        name = f"counterset-v{pub['number']}"
        if format == "json":
            return Response(
                json.dumps(pub, indent=2),
                media_type="application/json",
                headers={"Content-Disposition": f"attachment; filename={name}.json"},
            )
        if format != "csv":
            raise HTTPException(422, "Choose json or csv")
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=["artist", "kind", "status", "stage", "start", "end", "changed", "previous_stage", "previous_start", "act_id"])
        writer.writeheader()
        acts = {a["id"]: a for a in pub["day"]["acts"]}
        stages = {s["id"]: s for s in pub["day"]["stages"]}
        before = {x["act_id"]: x for x in pub.get("previous", [])}

        def clock(n):
            return f"{n // 60 % 24:02}:{n % 60:02}"

        def safe(s):
            return "'" + s if s and s[0] in "=+-@\t\r" else s

        for place in sorted(pub["placements"], key=lambda x: (x["stage_id"], x["start"])):
            a = acts[place["act_id"]]
            old = before.get(place["act_id"], place)
            # A dropped set has no slot; its old one stays in the previous_ columns.
            dropped = bool(place.get("cut"))
            writer.writerow(
                {
                    "artist": safe(a["name"]),
                    "kind": a.get("kind", "artist"),
                    "stage": "" if dropped else safe(stages[place["stage_id"]]["name"]),
                    "start": "" if dropped else clock(place["start"]),
                    "end": "" if dropped else clock(place["start"] + (place.get("length") or a["duration"])),
                    "status": "dropped" if place.get("cut") else "shortened" if place.get("length") else "plays",
                    "changed": "yes" if old != place else "",
                    "previous_stage": safe(stages[old["stage_id"]]["name"]),
                    "previous_start": clock(old["start"]),
                    "act_id": safe(a["id"]),
                }
            )
        return Response(
            buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={name}.csv"},
        )

    @app.post("/api/projects/{id}/benchmark")
    def benchmark(id, req: Baseline):
        p, day = current(id, req.version)
        if not p["evidence"]:
            raise HTTPException(422, "Load evidence first")
        edges = all_edges(day, p["evidence"])
        lenses = dict(p.get("context", {}).get("lenses", {}))
        declared = genre_edges(day)
        if declared:
            lenses["declared_genre"] = {"edges": declared, "label": "Programmer-declared genre"}

        def work(progress):
            attendee = attendee_edges(edges)
            arms = {"Current grid": {"placements": [x.model_dump() for x in day.draft], "status": "DRAFT"}}
            steps = 3 + len(lenses) + (1 if req.model else 0)
            progress(0, steps, "Repair with Qloo")
            arms["Qloo + solver"] = solve(day, edges, req.move_budget, req.seconds)
            progress(1, steps, "Repair without audience evidence")
            arms["No audience evidence"] = solve(day, attendee, req.move_budget, req.seconds)
            for i, (name, lens) in enumerate(lenses.items()):
                progress(2 + i, steps, f"Repair with {lens['label']}")
                arms[lens["label"] + " + solver"] = solve(day, attendee + lens["edges"], req.move_budget, req.seconds)
            if req.model:
                progress(steps - 1, steps, f"{req.model} schedules without Qloo or a solver")
                try:
                    arms[f"LLM only ({req.model})"] = llm_baseline(day, edges, req.move_budget, gateway, req.model, day.repair_priority)
                except (ProviderError, ValueError) as e:
                    arms[f"LLM only ({req.model})"] = {"status": "FAILED", "error": str(e), "placements": []}
            measures = {"Qloo cues": p["evidence"]["edges"], **{v["label"]: v["edges"] for v in lenses.values()}}
            table = []
            for name, arm in arms.items():
                row = {"arm": name, "status": arm.get("status"), "error": arm.get("error")}
                if arm.get("placements"):
                    places = placements(arm)
                    hard = audit(day, places, attendee, req.move_budget if name != "Current grid" else None)
                    row.update({"valid": hard["passed"], "errors": hard["errors"][:6], "moves": hard["moves"], "shift": hard["displacement"], "attendee": hard["counts"]["must_see"]})
                    row["clashes"] = {
                        m: audit(day, places, [{**e, "source": "qloo"} for e in es])["counts"]["qloo"] for m, es in measures.items()
                    }
                table.append(row)
            result = {
                "project": id,
                "input_version": req.version,
                "measures": {m: len(es) for m, es in measures.items()},
                "table": table,
                "scope": "Each row is scored under every evidence source. A solver scores best on the source it optimised by construction; read the off-diagonal cells. Hard-rule validity is checked independently. None of these measures attendance.",
                "created": time.time(),
            }
            bid = store.put("benchmark", result)
            return {"benchmark_id": bid, **result}

        return background("Evidence comparison", work)

    @app.get("/api/jobs/{id}")
    def job(id):
        return store.get("job", id)

    @app.get("/")
    def landing():
        return FileResponse(cfg.root / "web/index.html")

    @app.get("/studio")
    def studio():
        return FileResponse(cfg.root / "web/studio.html")

    from .mcp import mount_mcp

    mount_mcp(app, cfg, examples)
    app.mount("/web", StaticFiles(directory=cfg.root / "web"), name="web")
    return app


app = create_app()
