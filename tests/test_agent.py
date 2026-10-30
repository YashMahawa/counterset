"""The rescue agent: real tools, a scripted model. Nothing here calls a provider."""

import json
import time
import pytest
from fastapi.testclient import TestClient
from app import desk_agent
from app.config import Config
from app.domain import Day
from app.main import create_app
from app.mcp import call
from app.providers import ProviderError

H = {"x-counterset": "workspace"}
MESSAGE = "Lightning. Site closed 14:00 to 15:00. Hard stop 19:00. Save what you can."


def day():
    stages = [{"id": "a", "name": "A", "opens": 780, "closes": 1140}, {"id": "b", "name": "B", "opens": 780, "closes": 1140}]
    acts, draft = [], []
    for i in range(6):
        acts.append(
            {
                "id": f"x{i}", "name": f"Act {i}", "duration": 60, "changeover": 0, "allowed_stages": ["a", "b"],
                "earliest": 780, "latest": 1140, "draw": 0.1 * (i + 1), "qloo_id": None,
            }
        )
        draft.append({"act_id": f"x{i}", "stage_id": "ab"[i % 2], "start": 780 + 60 * (i // 2) + 60})
    return Day.model_validate({"name": "Mini", "grid": 5, "stages": stages, "acts": acts, "draft": draft, "auto_lock_started": False})


EVIDENCE = {
    "id": "fixture",
    "fetched_at": time.time(),
    "edges": [{"a": "x0", "b": "x1", "source": "qloo", "weight": 1, "ranks": [1, 1], "of": [5, 5]}],
    "unknown": [],
    "ranks": {"x0": {"x1": 1}, "x1": {"x0": 1}},
    "explain": {"x0|x1": ["Indie", "Folk"]},
    "status": "COMPLETE",
}
CONTEXT = {
    "as_run": [
        *[{"act_id": f"x{i}", "stage_id": "ab"[i % 2], "start": 780 + 60 * (i // 2) + 60, "cut": i < 2} for i in range(2)],
        *[{"act_id": f"x{i}", "stage_id": "ab"[i % 2], "start": 780 + 60 * (i // 2) + 60} for i in range(2, 6)],
    ],
    "storm": {"start": 840, "end": 900, "curfew": 1140},
}
GOOD = [
    {"thought": "Record it", "tool": "close_site", "args": {"start": "14:00", "end": "15:00", "quote": "Site closed 14:00 to 15:00."}},
    {"thought": "Check", "tool": "audit", "args": {}},
    {"thought": "Gentlest", "tool": "try_rescue", "args": {"curfew": None, "shortest_percent": 100, "allow_drop": False, "max_moves": None, "prefer": "fewest_acts"}},
    {"thought": "Compare", "tool": "compare_without_qloo", "args": {"rescue_id": 0}},
    {"thought": "Against the day", "tool": "compare_as_run", "args": {"rescue_id": 0}},
    {"thought": "Why", "tool": "why_they_share_a_crowd", "args": {"act_a": "x0", "act_b": "x1"}},
    {"thought": "Done", "tool": "finish", "args": {"rescue_id": 0, "summary": "Every set plays. Nothing dropped."}},
]


def run(decisions, context=CONTEXT):
    return desk_agent.run(day(), EVIDENCE, context, MESSAGE, None, "m", turns=decisions, seconds=4)


def test_agent_produces_a_validated_proposal_and_changes_nothing():
    d = day()
    out = run(GOOD)
    assert [t["tool"] for t in out["trace"]] == [g["tool"] for g in GOOD]
    assert out["session"].rescues[0]["result"]["audit"]["passed"]
    assert not d.outages  # the saved day is untouched
    proposal = desk_agent.to_proposal(out, d)
    assert proposal["agent"] and proposal["day"]["outages"]


def test_agent_quote_must_be_exact_and_unknown_tools_are_refused():
    bad = [
        {"tool": "close_site", "args": {"start": "14:00", "end": "15:00", "quote": "The organiser says so"}},
        {"tool": "publish_everything", "args": {}},
        *GOOD,
    ]
    out = run(bad)
    assert not out["trace"][0]["ok"] and "exact part" in out["trace"][0]["line"]
    assert not out["trace"][1]["ok"]
    assert out["trace"][-1]["tool"] == "finish"


def test_agent_cannot_finish_before_comparing_without_qloo_and_against_the_day():
    decisions = [GOOD[0], GOOD[2], GOOD[6], GOOD[3], GOOD[6], GOOD[4], GOOD[6]]
    out = run(decisions)
    refused = [t for t in out["trace"] if not t["ok"]]
    assert len(refused) == 2 and "compare_without_qloo" in refused[0]["line"] and "compare_as_run" in refused[1]["line"]


def test_agent_summary_with_an_invented_number_is_replaced():
    last = {**GOOD[6], "args": {"rescue_id": 0, "summary": "This sells 4000 more tickets."}}
    out = run([*GOOD[:6], last])
    assert out["summary_source"] == "deterministic" and "4000" not in out["summary"] and "4000" in out["summary_rejected"]


def test_agent_may_not_extend_past_the_stated_hard_stop():
    over = {"tool": "try_rescue", "args": {"curfew": "20:00", "shortest_percent": 100, "allow_drop": False}}
    out = run([GOOD[0], over, *GOOD[2:]])
    assert not out["trace"][1]["ok"] and "hard stop" in out["trace"][1]["line"]


def test_agent_stops_cleanly_after_repeated_bad_calls():
    with pytest.raises(desk_agent.AgentStop):
        run([{"tool": "nope", "args": {}}] * 3)


def ready(tmp_path, public=False, recorded=False):
    cfg = Config(root=tmp_path)
    cfg.private = tmp_path
    cfg.model_key = "fake"
    cfg.qloo_key = None
    cfg.public = public
    cfg.agent_per_hour = 1
    (tmp_path / "web").mkdir(exist_ok=True)
    (tmp_path / "examples").mkdir(exist_ok=True)
    context = {**CONTEXT, "kind": "replay", "title": "Mini", "summary": "s", "order": 0}
    if recorded:
        context["recorded_run"] = {"model": "m", "at": time.time(), "message": MESSAGE, "decisions": GOOD}
    context["rescue_table"] = {"rows": []}
    (tmp_path / "examples/mini.json").write_text(json.dumps({"day": day().model_dump(), "evidence": EVIDENCE, "context": context}))
    app = create_app(cfg)
    return TestClient(app), app, cfg


def finish(c, job_id):
    for _ in range(800):
        j = c.get("/api/jobs/" + job_id).json()
        if j["status"] != "RUNNING":
            return j
        time.sleep(0.02)
    raise AssertionError("Job did not finish")


def test_recorded_replay_reruns_tools_then_a_person_approves(tmp_path):
    c, app, cfg = ready(tmp_path, recorded=True)
    p = c.post("/api/examples/mini", headers=H).json()
    start = c.post(f"/api/projects/{p['id']}/agent", headers=H, json={"version": 1, "text": MESSAGE, "mode": "replay"})
    assert start.status_code == 200, start.text
    j = finish(c, start.json()["job_id"])
    assert j["status"] == "COMPLETED", j
    assert len(j["trace"]) == len(GOOD)
    # Nothing has changed until approval.
    before = c.get(f"/api/projects/{p['id']}").json()
    assert before["version"] == 1 and not before["day"]["outages"]
    pub = c.post(f"/api/projects/{p['id']}/publish", headers=H, json={"version": 1, "proposal_id": j["result"]["proposal_id"], "option": 0})
    assert pub.status_code == 200, pub.text
    after = c.get(f"/api/projects/{p['id']}").json()
    assert after["version"] == 2 and after["day"]["outages"] and after["audit"]["passed"]
    assert after["day"]["allow_cut"] is False and after["day"]["allow_trim"] is False


def test_recording_refuses_a_changed_message_or_day(tmp_path):
    c, app, cfg = ready(tmp_path, recorded=True)
    p = c.post("/api/examples/mini", headers=H).json()
    r = c.post(f"/api/projects/{p['id']}/agent", headers=H, json={"version": 1, "text": "Something else", "mode": "replay"})
    assert r.status_code == 409


def test_live_failure_applies_nothing_and_says_so(tmp_path, monkeypatch):
    c, app, cfg = ready(tmp_path)
    p = c.post("/api/examples/mini", headers=H).json()

    def down(*a, **k):
        raise ProviderError("model returned HTTP 503; no action applied")

    monkeypatch.setattr(app.state.gateway, "model", down)
    start = c.post(f"/api/projects/{p['id']}/agent", headers=H, json={"version": 1, "text": MESSAGE, "mode": "live"}).json()
    j = finish(c, start["job_id"])
    assert j["status"] == "FAILED" and "503" in j["error"]
    assert c.get(f"/api/projects/{p['id']}").json()["version"] == 1


def test_public_mode_hides_workspaces_and_caps_agent(tmp_path, monkeypatch):
    c, app, cfg = ready(tmp_path, public=True)
    p = c.post("/api/examples/mini", headers=H).json()
    assert c.get("/api/projects").json() == []
    assert c.post(f"/api/projects/{p['id']}/evidence", headers=H, json={"version": 1, "source": "live"}).status_code == 403
    monkeypatch.setattr(app.state.gateway, "model", lambda *a, **k: (_ for _ in ()).throw(ProviderError("down")))
    first = c.post(f"/api/projects/{p['id']}/agent", headers=H, json={"version": 1, "text": MESSAGE, "mode": "live"})
    assert first.status_code == 200
    assert finish(c, first.json()["job_id"])["status"] == "FAILED"
    second = c.post(f"/api/projects/{p['id']}/agent", headers=H, json={"version": 1, "text": MESSAGE, "mode": "live"})
    assert second.status_code == 429


def test_rescue_terms_through_the_repair_endpoint_can_be_approved(tmp_path):
    c, app, cfg = ready(tmp_path)
    p = c.post("/api/examples/mini", headers=H).json()
    body = {"version": 1, "move_budget": 6, "seconds": 3, "scenario": {"curfew": 1140, "shortest": 75, "allow_cut": True}}
    j = finish(c, c.post(f"/api/projects/{p['id']}/repair", headers=H, json=body).json()["job_id"])
    assert j["status"] == "COMPLETED", j
    assert j["result"]["scenario"]["shortest"] == 75
    pub = c.post(f"/api/projects/{p['id']}/publish", headers=H, json={"version": 1, "proposal_id": j["result"]["proposal_id"], "option": 0})
    assert pub.status_code == 200, pub.text


def test_rescue_terms_can_replay_the_recorded_closure(tmp_path):
    c, app, cfg = ready(tmp_path)
    p = c.post("/api/examples/mini", headers=H).json()
    body = {"version": 1, "move_budget": 6, "seconds": 3, "scenario": {"curfew": 1140, "shortest": 75, "allow_cut": True, "close_site": True}}
    j = finish(c, c.post(f"/api/projects/{p['id']}/repair", headers=H, json=body).json()["job_id"])
    assert j["status"] == "COMPLETED", j
    held = j["result"]["day"]["outages"]
    assert {(o["stage_id"], o["start"], o["end"]) for o in held} == {("a", 840, 900), ("b", 840, 900)}
    option = next(o for o in j["result"]["options"] if o.get("placements"))
    for place in option["placements"]:
        assert place["cut"] or place["start"] >= 900 or place["start"] + (place["length"] or 60) <= 840
    # The closure lives on the proposal until a person approves it.
    assert c.get(f"/api/projects/{p['id']}").json()["day"]["outages"] == []
    pub = c.post(f"/api/projects/{p['id']}/publish", headers=H, json={"version": 1, "proposal_id": j["result"]["proposal_id"], "option": 0})
    assert pub.status_code == 200, pub.text
    assert len(c.get(f"/api/projects/{p['id']}").json()["day"]["outages"]) == 2


def test_closing_the_site_needs_a_recorded_closure(tmp_path):
    c, app, cfg = ready(tmp_path)
    p = c.post("/api/examples/mini", headers=H).json()
    state = app.state.store.get("project", p["id"])
    state["context"].pop("storm")
    app.state.store.put("project", state, p["id"])
    body = {"version": 1, "scenario": {"close_site": True}}
    assert c.post(f"/api/projects/{p['id']}/repair", headers=H, json=body).status_code == 422


def test_an_earlier_finish_time_really_applies(tmp_path):
    from app.repair import apply_scenario

    earlier = apply_scenario(day(), {"curfew": 1080, "allow_cut": True})
    assert {s.closes for s in earlier.stages} == {1080}
    with pytest.raises(ValueError, match="before the stages open"):
        apply_scenario(day(), {"curfew": 600})


def test_csv_gives_a_dropped_set_no_slot_and_marks_only_real_changes(tmp_path):
    import csv
    import io

    c, app, cfg = ready(tmp_path)
    p = c.post("/api/examples/mini", headers=H).json()
    body = {"version": 1, "move_budget": 6, "seconds": 3, "scenario": {"curfew": 900, "allow_cut": True}}
    j = finish(c, c.post(f"/api/projects/{p['id']}/repair", headers=H, json=body).json()["job_id"])
    assert j["status"] == "COMPLETED", j
    option = j["result"]["options"][0]
    assert option["audit"]["cuts"], "the earlier finish should force a drop"
    pub = c.post(f"/api/projects/{p['id']}/publish", headers=H, json={"version": 1, "proposal_id": j["result"]["proposal_id"], "option": 0})
    assert pub.status_code == 200, pub.text
    text = c.get("/api/published/" + pub.json()["published_id"] + "/export?format=csv").text
    rows = list(csv.DictReader(io.StringIO(text)))
    assert len(rows) == 6
    for row in rows:
        if row["status"] == "dropped":
            assert row["stage"] == row["start"] == row["end"] == "" and row["previous_start"]
        else:
            assert row["stage"] and row["start"] and row["end"]
    changed = {r["act_id"] for r in rows if r["changed"]}
    assert changed == set(option["audit"]["moved"]) | set(option["audit"]["cuts"]) | set(option["audit"]["trimmed"])


def test_mcp_lists_audits_rescues_and_explains(tmp_path):
    c, app, cfg = ready(tmp_path)
    init = c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}).json()
    assert init["result"]["serverInfo"]["name"] == "counterset"
    tools = c.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]
    assert {t["name"] for t in tools} == {"list_days", "audit_day", "rescue_day", "why_share_a_crowd"}

    def tool(name, **args):
        r = c.post("/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": name, "arguments": args}}).json()["result"]
        return r, json.loads(r["content"][0]["text"]) if not r["isError"] else None

    assert tool("list_days")[1][0]["id"] == "mini"
    assert "clashes" in tool("audit_day", day_id="mini")[1]
    out = tool("rescue_day", day_id="mini", closed_from=840, closed_until=900, allow_drop=True, shortest_percent=75, curfew=1140)[1]
    assert out["sets_total"] == 6 and "what_really_happened" in out
    assert tool("why_share_a_crowd", day_id="mini", act_a="Act 0", act_b="Act 1")[1]["shared_tags"] == ["Indie", "Folk"]
    assert tool("rescue_day", day_id="mini", closed_from=900, closed_until=840)[0]["isError"]
    assert tool("audit_day", day_id="missing")[0]["isError"]


def test_a_text_false_does_not_open_dropping_sets():
    text = {"tool": "try_rescue", "args": {"curfew": None, "shortest_percent": "100", "allow_drop": "false", "max_moves": None}}
    out = run([GOOD[0], text, *GOOD[2:]])
    assert out["session"].rescues[0]["scenario"]["allow_cut"] is False


def test_unlisted_mode_asks_crawlers_to_stay_out(tmp_path):
    cfg = Config(root=tmp_path)
    cfg.private = tmp_path
    cfg.unlisted = True
    (tmp_path / "web").mkdir(exist_ok=True)
    c = TestClient(create_app(cfg))
    assert c.get("/api/config").headers["x-robots-tag"].startswith("noindex")
    assert "Disallow: /" in c.get("/robots.txt").text.splitlines()


def test_saved_replay_shows_saved_steps_and_validator_rechecks(tmp_path):
    c, app, cfg = ready(tmp_path, recorded=True)
    cfg.saved_replay = True
    file = tmp_path / "examples/mini.json"
    ex = json.loads(file.read_text())
    out = desk_agent.run(day(), EVIDENCE, CONTEXT, MESSAGE, None, "m", turns=GOOD, seconds=4)
    plain = lambda v: json.loads(json.dumps(v))
    ex["context"]["recorded_run"]["saved"] = {"trace": plain(out["trace"]), "proposal": plain(desk_agent.to_proposal(out, day()))}
    file.write_text(json.dumps(ex))
    p = c.post("/api/examples/mini", headers=H).json()
    j = finish(c, c.post(f"/api/projects/{p['id']}/agent", headers=H, json={"version": 1, "text": MESSAGE, "mode": "replay"}).json()["job_id"])
    assert j["status"] == "COMPLETED", j
    assert j["mode"] == "saved" and len(j["trace"]) == len(GOOD)
    pub = c.post(f"/api/projects/{p['id']}/publish", headers=H, json={"version": 1, "proposal_id": j["result"]["proposal_id"], "option": 0})
    assert pub.status_code == 200, pub.text
    # A tampered plan is refused by the validator rather than shown.
    ex = json.loads(file.read_text())
    ex["context"]["recorded_run"]["saved"]["proposal"]["options"][0]["placements"][0]["start"] = 0
    file.write_text(json.dumps(ex))
    p = c.post("/api/examples/mini", headers=H).json()
    j = finish(c, c.post(f"/api/projects/{p['id']}/agent", headers=H, json={"version": 1, "text": MESSAGE, "mode": "replay"}).json()["job_id"])
    assert j["status"] == "FAILED" and "validator" in j["error"]


# ---------- Your own lineup: live Qloo with the key on the server ----------
LINES = "Main | Mitski | 20:00 | 21:00\nMain | Big Thief | 21:15 | 22:15\nTent | Ali Wong | 20:30 | 21:15 | comedy\nTent | Unknown Local Band | 21:30 | 22:00"


def test_lineup_parser_reads_a_day_and_explains_mistakes():
    from app.lineup import parse

    d = parse("Mine", LINES)
    assert [s.name for s in d.stages] == ["Main", "Tent"]
    assert next(a for a in d.acts if a.name == "Ali Wong").kind == "comedian"
    assert d.acts[0].duration == 60 and d.acts[0].changeover == 15
    assert parse("X", "A, One, 23:30, 00:30\nA, Two, 00:45, 01:30").draft[1].start == 1485
    for bad, words in [("A | One | 9pm | 10pm\nA | Two | 11:00 | 12:00", "not a time"), ("only one line", "stage | act"), ("A | One | 20:00 | 21:00\nA | Two | 20:30 | 21:30", "overlap"), ("A | One | 20:00 | 21:00\nB | One | 22:00 | 23:00", "once")]:
        with pytest.raises(ValueError, match=words):
            parse("X", bad)


class FakeQloo:
    def __init__(self):
        self.calls = []

    def qloo(self, path, params, refresh=False, offline=False):
        self.calls.append(path)
        if path == "/search":
            q = params["query"]
            return {"results": {"entities": [] if "Unknown" in q else [{"entity_id": "%08x-0000-0000-0000-000000000000" % (abs(hash(q)) % 2**32), "name": q, "popularity": 0.9}]}}, "live"
        if path == "/v2/insights":
            ids = params["filter.results.entities"].split(",")
            seed = params["signal.interests.entities"]
            return {"results": {"entities": [{"entity_id": e, "query": {"affinity": 0.9 - i / 10}} for i, e in enumerate(x for x in ids if x != seed)]}}, "live"
        return {"results": {"tags": [{"name": "Indie"}, {"name": "United States"}]}}, "live"

    def cached_at(self, *a):
        return time.time()

    def budget(self):
        return {"qloo_successes": 0, "qloo_limit": 5000, "model_attempts": 0, "model_limit": 60}


def test_public_visitor_runs_a_lineup_live_within_caps_and_never_sees_the_key(tmp_path, monkeypatch):
    c, app, cfg = ready(tmp_path, public=True)
    cfg.qloo_key = "secret-qloo-key"
    cfg.qloo_per_hour = 20
    fake = FakeQloo()
    for name in ("qloo", "cached_at", "budget"):
        monkeypatch.setattr(app.state.gateway, name, getattr(fake, name))
    config = c.get("/api/config")
    assert config.json()["qloo_configured"] is True and "secret-qloo-key" not in config.text
    p = c.post("/api/lineups", headers=H, json={"name": "Mine", "text": LINES}).json()
    j = finish(c, c.post(f"/api/projects/{p['id']}/identify", headers=H, json={"version": 1}).json()["job_id"])
    assert j["status"] == "COMPLETED", j
    assert j["result"]["found"] == ["Mitski", "Big Thief", "Ali Wong"] and j["result"]["total"] == 4
    state = c.get(f"/api/projects/{p['id']}").json()
    assert sum(bool(a["qloo_id"]) for a in state["day"]["acts"]) == 3
    e = finish(c, c.post(f"/api/projects/{p['id']}/evidence", headers=H, json={"version": state["version"], "source": "live"}).json()["job_id"])
    assert e["status"] == "COMPLETED", e
    state = c.get(f"/api/projects/{p['id']}").json()
    assert state["evidence_state"]["loaded"] and "secret-qloo-key" not in json.dumps(state)
    assert "/v2/insights" in fake.calls
    # The next visitor's bill would pass this visitor's hourly share, so it is refused.
    over = c.post(f"/api/projects/{p['id']}/evidence", headers=H, json={"version": state["version"], "source": "live"})
    assert over.status_code == 429


def test_public_visitor_cannot_spend_qloo_on_a_worked_example(tmp_path):
    c, app, cfg = ready(tmp_path, public=True)
    cfg.qloo_key = "secret-qloo-key"
    p = c.post("/api/examples/mini", headers=H).json()
    assert c.post(f"/api/projects/{p['id']}/evidence", headers=H, json={"version": 1, "source": "live"}).status_code == 403
    assert c.post(f"/api/projects/{p['id']}/identify", headers=H, json={"version": 1}).status_code == 403


def test_a_time_out_is_never_reported_as_impossible():
    # A hundredth of a second is not enough to answer, and the agent must say so plainly.
    out = desk_agent.Session(day(), EVIDENCE, CONTEXT, MESSAGE)
    out.seconds = 0.001
    line, result, _ = out.try_rescue({"shortest_percent": 100, "allow_drop": False})
    assert "no schedule fits" not in line or result["status"] == "INFEASIBLE"


def test_saying_an_act_has_not_started_lifts_the_automatic_freeze():
    data = day().model_dump()
    data["auto_lock_started"] = True
    s = desk_agent.Session(Day.model_validate(data), EVIDENCE, {}, MESSAGE)
    s.close_stage({"stage_id": "a", "start": "16:00", "end": "17:00", "quote": "Save what you can."})
    assert next(a for a in s.day.acts if a.id == "x0").locked
    s.limit_act({"act_id": "x0", "limit": "not_before", "time": "16:30", "quote": "Save what you can."})
    assert not next(a for a in s.day.acts if a.id == "x0").locked


def test_agent_can_end_honestly_when_nothing_fits_and_cannot_repeat_itself():
    data = day().model_dump()
    data["acts"][0]["locked"] = True
    d = Day.model_validate(data)
    decisions = [
        {"tool": "close_site", "args": {"start": "13:50", "end": "15:00", "quote": "Save what you can."}},
        {"tool": "try_rescue", "args": {"shortest_percent": 100, "allow_drop": False}},
        {"tool": "try_rescue", "args": {"shortest_percent": 100, "allow_drop": False}},
        {"tool": "report_conflict", "args": {"summary": "Act 0 is locked inside the closure."}},
    ]
    out = desk_agent.run(d, EVIDENCE, {}, MESSAGE, None, "m", turns=decisions, seconds=3)
    assert not out["trace"][2]["ok"] and "already tried" in out["trace"][2]["line"]
    assert out["rescue_id"] is None and out["core"]
    proposal = desk_agent.to_proposal(out, d)
    assert proposal["no_plan"] and proposal["options"] == [] and proposal["core"]


def test_a_set_that_finished_before_a_closure_does_not_block_it():
    from app.repair import hold_stage
    from app.validator import audit as recount

    data = day().model_dump()
    data["auto_lock_started"] = True
    data["acts"][0]["changeover"] = 30
    d = hold_stage(Day.model_validate(data), "a", 900, 960, "Closed")
    x0 = next(a for a in d.acts if a.id == "x0")
    assert x0.locked and x0.changeover == 0
    assert not [e for e in recount(d, d.draft, [])["errors"] if "Act 0" in e]
