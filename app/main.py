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
from .config import Config
from .domain import Day, Strict, Placement, reference_hash
from .evidence import graph, score_row, all_edges, fetch_snapshot, genre_edges, entities
from .fixtures import demo
from .providers import Gateway, ProviderError
from .solver import solve
from .store import Store
from .validator import audit
from .agent import propose_constraint, llm_baseline


class Versioned(Strict):
    version: int


class Repair(Versioned):
    move_budget: int = Field(default=4, ge=0, le=50)
    seconds: float = Field(default=12, ge=0.01, le=30)


class Change(Versioned):
    day: Day


class EvidenceRequest(Versioned):
    source: str = "recorded"
    refresh: bool = False


class Publish(Versioned):
    proposal_id: str


class Note(Versioned):
    text: str = Field(min_length=1, max_length=6000)
    model: str = "gemma-4-31b-it"


class Approve(Versioned):
    note_id: str


class Baseline(Repair):
    model: str = "gemma-4-31b-it"


class Hold(Versioned):
    stage_id: str
    start: int
    end: int


class Pin(Versioned):
    act_id: str


class Resolve(Strict):
    query: str = Field(min_length=1, max_length=120)


def create_app(config=None):
    cfg = config or Config()
    store = Store(cfg.private / "counterset.sqlite3")
    gateway = Gateway(cfg)
    pool = ThreadPoolExecutor(max_workers=2)
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
                    "error": "Server restarted. Retry the action; provider responses already cached will be reused.",
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
            raise HTTPException(
                409, "The workspace changed. Reload before applying this action."
            )
        return p, Day.model_validate(p["day"])

    def bump(id, p, day):
        p["day"] = day.model_dump()
        p["version"] += 1
        p["status"] = "DRAFT"
        store.put("project", p, id)
        return p

    def background(label, fn):
        id = store.put(
            "job",
            {
                "status": "RUNNING",
                "label": label,
                "progress": 0,
                "created": time.time(),
            },
        )

        def run():
            try:
                result = fn(id)
                store.put(
                    "job",
                    {
                        "status": "COMPLETED",
                        "label": label,
                        "result": result,
                        "progress": 1,
                    },
                    id,
                )
            except Exception as e:
                message = (
                    str(e)
                    if isinstance(e, (ProviderError, ValueError, HTTPException))
                    else "Operation failed; no schedule was applied"
                )
                store.put(
                    "job", {"status": "FAILED", "label": label, "error": message}, id
                )

        pool.submit(run)
        return {"job_id": id}

    def private_catalogue():
        f = cfg.private / "recorded.json"
        return (
            json.loads(f.read_text())
            if f.exists()
            else {"catalogue": {}, "payloads": {}}
        )

    @app.get("/api/config")
    def settings():
        return {
            "qloo_configured": bool(cfg.qloo_key),
            "model_configured": bool(cfg.model_key),
            "models": cfg.models,
            "budget": gateway.budget(),
            "recorded_available": bool(private_catalogue()["payloads"]),
            "real_day_available": (cfg.private / "real-day-validation.json").exists(),
            "local_only": not bool(cfg.access_token),
        }

    @app.get("/api/projects")
    def projects():
        return [
            {"id": p["id"], "name": p["day"]["name"], "version": p["version"]}
            for p in store.list("project")
        ]

    @app.post("/api/projects")
    def create(day: Day | None = None):
        sample = day is None
        day = day or demo(private_catalogue()["catalogue"])
        p = {
            "day": day.model_dump(),
            "version": 1,
            "evidence": {},
            "status": "DRAFT",
            "published": [],
            "context": {
                "kind": "synthetic" if sample else "operator_supplied",
                "note": "Rehearsal fixture: real artists and recorded Qloo evidence; illustrative festival, timings and contracts."
                if sample
                else "Imported production facts. Confirm sources and constraints before publishing.",
            },
        }
        id = store.put("project", p)
        return {"id": id, **p}

    @app.post("/api/examples/pitchfork-2024-friday")
    def real_example():
        f = cfg.private / "real-day-validation.json"
        if not f.exists():
            raise HTTPException(
                404, "Real-day validation is not available on this installation"
            )
        data = json.loads(f.read_text())
        day = Day.model_validate(data["day"])
        p = {
            "day": day.model_dump(),
            "version": 1,
            "evidence": data["evidence"],
            "status": "DRAFT",
            "published": [],
            "context": {
                "kind": "retrospective",
                "source": data["source"],
                "note": "Published Pitchfork 2024 Friday times/stages. Retrospective analysis with present-day associations. Production constraints below are hypothetical, not the festival’s contracts.",
                "assumptions": data["assumptions"],
            },
        }
        id = store.put("project", p)
        return {"id": id, **p}

    @app.get("/api/projects/{id}")
    def project(id):
        p, day = current(id)
        return {
            "id": id,
            **p,
            "audit": audit(day, day.draft, all_edges(day, p["evidence"])),
            "proposals": [r for r in store.list("proposal") if r["project"] == id],
            "notes": [r for r in store.list("note") if r["project"] == id],
        }

    @app.put("/api/projects/{id}")
    def change(id, req: Change):
        with store.lock:
            p, old = current(id, req.version)
            # Any identity or rule edit invalidates evidence, not only proposals.
            if [(a.id, a.qloo_id) for a in old.acts] != [
                (a.id, a.qloo_id) for a in req.day.acts
            ] or old.k != req.day.k:
                p["evidence"] = {}
            return bump(id, p, req.day)

    @app.post("/api/resolve")
    def resolve(req: Resolve):
        payload, source = gateway.qloo(
            "/search", {"query": req.query, "types": "urn:entity:artist", "take": 5}
        )
        return {
            "source": source,
            "candidates": [
                {
                    "id": e["entity_id"],
                    "name": e.get("name"),
                    "disambiguation": e.get("disambiguation"),
                }
                for e in entities(payload)
            ],
        }

    @app.post("/api/projects/{id}/evidence")
    def evidence(id, req: EvidenceRequest):
        p, day = current(id, req.version)
        if req.source not in {"recorded", "live"}:
            raise HTTPException(422, "Choose recorded or live evidence")

        def work(job):
            if req.source == "recorded":
                recorded = private_catalogue()
                ids = [a.qloo_id for a in day.acts if a.qloo_id]
                rows = {
                    seed: score_row(payload, seed, ids)
                    for seed, payload in recorded["payloads"].items()
                    if seed in ids
                }
                snapshot = graph(
                    day, rows, "qloo_recorded_2026-10-25", recorded.get("control")
                )
                if not rows:
                    raise ValueError(
                        "No recorded evidence for this lineup. Resolve artists and run live evidence."
                    )
            else:
                if sum(bool(a.qloo_id) for a in day.acts) < 2:
                    raise ValueError("Confirm at least two artist identities first")

                def progress(n, total):
                    store.put(
                        "job",
                        {
                            "status": "RUNNING",
                            "label": "Qloo evidence",
                            "progress": n / total,
                            "detail": f"{n} of {total} requests",
                        },
                        job,
                    )

                snapshot = fetch_snapshot(day, gateway, progress, req.refresh)
            with store.lock:
                fresh, _ = current(id, req.version)
                fresh["evidence"] = snapshot
                fresh["version"] += 1
                store.put("project", fresh, id)
            return {"evidence_id": snapshot["id"], "status": snapshot["status"]}

        return background("Qloo evidence", work)

    @app.post("/api/projects/{id}/repair")
    def repair(id, req: Repair):
        p, day = current(id, req.version)
        if not p["evidence"]:
            raise HTTPException(422, "Load the Qloo evidence before repairing")
        if not p["evidence"].get("edges") and not day.must_see:
            raise HTTPException(
                422,
                "No usable conflict evidence. Review coverage or enter actual attendee must-see pairs.",
            )
        hash = reference_hash(day, p["evidence"])

        def work(job):
            edges = all_edges(day, p["evidence"])
            result = solve(day, edges, req.move_budget, req.seconds)
            result.update(
                {
                    "project": id,
                    "input_version": req.version,
                    "input_hash": hash,
                    "budget": req.move_budget,
                    "created": time.time(),
                    "trace": [
                        {
                            "node": "evidence_gate",
                            "status": p["evidence"].get("status"),
                        },
                        {"node": "constraint_solver", "status": result["status"]},
                        {
                            "node": "independent_validator",
                            "status": "PASSED"
                            if result.get("audit", {}).get("passed")
                            else "NO_PROPOSAL",
                        },
                        {"node": "approval", "status": "WAITING_FOR_PROGRAMMER"},
                    ],
                }
            )
            pid = store.put("proposal", result)
            return {"proposal_id": pid, **result}

        return background("Schedule repair", work)

    @app.post("/api/projects/{id}/pin")
    def pin(id, req: Pin):
        with store.lock:
            p, day = current(id, req.version)
            if req.act_id not in {a.id for a in day.acts}:
                raise HTTPException(422, "Unknown act")
            for a in day.acts:
                if a.id == req.act_id:
                    a.locked = True
            return bump(id, p, day)

    @app.post("/api/projects/{id}/hold")
    def hold(id, req: Hold):
        with store.lock:
            p, day = current(id, req.version)
            from .domain import Outage

            day.outages.append(
                Outage(stage_id=req.stage_id, start=req.start, end=req.end)
            )
            # Played/in-progress sets are pinned to the currently approved draft.
            drafts = {x.act_id: x for x in day.draft}
            for a in day.acts:
                if drafts[a.id].start <= req.start:
                    a.locked = True
            day = Day.model_validate(day.model_dump())
            return bump(id, p, day)

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
                raise HTTPException(
                    409, "Proposal is stale or belongs to another workspace"
                )
            if proposal["status"] not in {"OPTIMAL", "FEASIBLE"}:
                raise HTTPException(422, "No feasible proposal")
            places = [Placement.model_validate(x) for x in proposal["placements"]]
            checked = audit(
                day, places, all_edges(day, p["evidence"]), proposal["budget"]
            )
            if (
                not checked["passed"]
                or checked["counts"] != proposal["audit"]["counts"]
            ):
                raise HTTPException(422, "Independent validation rejected publication")
            number = len(p["published"]) + 1
            pub = {
                "project": id,
                "number": number,
                "input_hash": proposal["input_hash"],
                "proposal_id": req.proposal_id,
                "placements": proposal["placements"],
                "audit": checked,
                "solver_status": proposal["status"],
                "published_at": time.time(),
                "day": day.model_dump(),
                "context": p.get("context", {}),
                "evidence_id": p["evidence"].get("id"),
            }
            pubid = store.put("published", pub)
            p["published"].append(pubid)
            day.draft = places
            p = bump(id, p, day)
            p["status"] = "PUBLISHED"
            store.put("project", p, id)
            return {"published_id": pubid, **pub}

    @app.get("/api/published/{id}/export")
    def export(id, format: str = "json"):
        pub = store.get("published", id)
        if format == "json":
            return Response(
                json.dumps(pub, indent=2),
                media_type="application/json",
                headers={
                    "Content-Disposition": f"attachment; filename=counterset-v{pub['number']}.json"
                },
            )
        if format != "csv":
            raise HTTPException(422, "Choose json or csv")
        buf = io.StringIO()
        writer = csv.DictWriter(
            buf, fieldnames=["artist", "stage", "start", "end", "act_id"]
        )
        writer.writeheader()
        acts = {a["id"]: a for a in pub["day"]["acts"]}
        stages = {s["id"]: s for s in pub["day"]["stages"]}

        def clock(n):
            return f"{n // 60:02}:{n % 60:02}"

        def safe(s):
            return "'" + s if s and s[0] in "=+-@" else s

        for place in pub["placements"]:
            a = acts[place["act_id"]]
            writer.writerow(
                {
                    "artist": safe(a["name"]),
                    "stage": safe(stages[place["stage_id"]]["name"]),
                    "start": clock(place["start"]),
                    "end": clock(place["start"] + a["duration"]),
                    "act_id": safe(a["id"]),
                }
            )
        return Response(
            buf.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=counterset-v{pub['number']}.csv"
            },
        )

    @app.post("/api/projects/{id}/notes")
    def note(id, req: Note):
        p, day = current(id, req.version)

        def work(job):
            result = propose_constraint(day, req.text, gateway, req.model)
            result.update(
                {"project": id, "input_version": req.version, "source_text": req.text}
            )
            nid = store.put("note", result)
            return {"note_id": nid, **result}

        return background("Interpret production note", work)

    @app.post("/api/projects/{id}/notes/approve")
    def approve(id, req: Approve):
        with store.lock:
            p, day = current(id, req.version)
            note = store.get("note", req.note_id)
            if (
                note["project"] != id
                or note["input_version"] != req.version
                or note["status"] != "PENDING_REVIEW"
            ):
                raise HTTPException(409, "Note is stale or already reviewed")
            if note["action"] == "unsupported":
                raise HTTPException(422, "The note requires clarification")
            for a in day.acts:
                if a.id == note["act_id"]:
                    setattr(
                        a,
                        {"earliest": "earliest", "latest": "latest", "lock": "locked"}[
                            note["action"]
                        ],
                        True if note["action"] == "lock" else note["value"],
                    )
            day = Day.model_validate(day.model_dump())
            bump(id, p, day)
            note["status"] = "APPROVED"
            store.put("note", note, req.note_id)
            return note

    @app.post("/api/projects/{id}/benchmark")
    def benchmark(id, req: Baseline):
        p, day = current(id, req.version)
        edges = all_edges(day, p["evidence"])
        if not p["evidence"]:
            raise HTTPException(422, "Load evidence first")

        def work(job):
            actual = [e for e in edges if e["source"] == "must_see"]
            genre = genre_edges(day)
            base = audit(day, day.draft, edges, req.move_budget)
            g = solve(day, actual + genre, req.move_budget, req.seconds)
            if g.get("placements"):
                g["common_audit"] = audit(
                    day,
                    [Placement.model_validate(x) for x in g["placements"]],
                    edges,
                    req.move_budget,
                )
            q = solve(day, edges, req.move_budget, req.seconds)
            llm = llm_baseline(day, edges, req.move_budget, gateway, req.model)
            result = {
                "project": id,
                "input_version": req.version,
                "no_change": base,
                "genre_solver": g,
                "qloo_solver": q,
                "llm_only": llm,
                "scope": "Same production facts and move budget. Hard-constraint compliance is independent; Qloo cue reduction is self-objective evidence only. Actual fan benefit remains unmeasured.",
                "input_hash": reference_hash(day, p["evidence"]),
            }
            bid = store.put("benchmark", result)
            return {"benchmark_id": bid, **result}

        return background("LLM-only and genre comparison", work)

    @app.get("/api/jobs/{id}")
    def job(id):
        return store.get("job", id)

    @app.get("/")
    def landing():
        return FileResponse(cfg.root / "web/index.html")

    @app.get("/studio")
    def studio():
        return FileResponse(cfg.root / "web/studio.html")

    app.mount("/web", StaticFiles(directory=cfg.root / "web"), name="web")
    return app


app = create_app()
