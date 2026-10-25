import time
from fastapi.testclient import TestClient
from app.config import Config
from app.main import create_app
from app.fixtures import demo

H = {"x-counterset": "workspace"}


def ready(tmp_path):
    cfg = Config(root=tmp_path)
    cfg.private = tmp_path
    cfg.model_key = None
    cfg.qloo_key = None
    web = tmp_path / "web"
    web.mkdir(exist_ok=True)
    app = create_app(cfg)
    client = TestClient(app)
    p = client.post("/api/projects", headers=H, json=demo().model_dump()).json()
    state = app.state.store.get("project", p["id"])
    state["evidence"] = {
        "id": "fixture",
        "edges": [{"a": "act-8", "b": "act-0", "source": "qloo", "weight": 1}],
        "unknown": [],
        "status": "COMPLETE",
    }
    app.state.store.put("project", state, p["id"])
    return client, app, p


def wait(c, id):
    for _ in range(200):
        j = c.get("/api/jobs/" + id).json()
        if j["status"] != "RUNNING":
            return j
        time.sleep(0.02)
    raise AssertionError("Job did not finish")


def test_publish_validates_and_stale_proposal_rejected(tmp_path):
    c, app, p = ready(tmp_path)
    id = p["id"]
    job = c.post(
        f"/api/projects/{id}/repair",
        headers=H,
        json={"version": 1, "move_budget": 4, "seconds": 5},
    ).json()
    j = wait(c, job["job_id"])
    assert j["status"] == "COMPLETED", j
    pid = j["result"]["proposal_id"]
    pub = c.post(
        f"/api/projects/{id}/publish",
        headers=H,
        json={"version": 1, "proposal_id": pid},
    )
    assert pub.status_code == 200, pub.text
    assert (
        c.get(
            "/api/published/" + pub.json()["published_id"] + "/export?format=csv"
        ).status_code
        == 200
    )
    assert (
        c.post(
            f"/api/projects/{id}/publish",
            headers=H,
            json={"version": 2, "proposal_id": pid},
        ).status_code
        == 409
    )


def test_mutation_requires_same_origin_header_and_version(tmp_path):
    c, app, p = ready(tmp_path)
    assert c.post("/api/projects").status_code == 403
    assert (
        c.post(
            "/api/projects", headers={**H, "origin": "https://untrusted.example"}
        ).status_code
        == 403
    )
    assert (
        c.post(
            f"/api/projects/{p['id']}/pin",
            headers=H,
            json={"version": 99, "act_id": "act-0"},
        ).status_code
        == 409
    )


def test_untrusted_model_constraint_stays_pending_then_requires_review(tmp_path):
    c, app, p = ready(tmp_path)
    app.state.gateway.model = lambda prompt, model: (
        {
            "action": "earliest",
            "act_id": "act-0",
            "value": 1020,
            "quote": "after 17:00",
            "reason": "explicit",
        },
        {"model": model},
    )
    job = c.post(
        f"/api/projects/{p['id']}/notes",
        headers=H,
        json={"version": 1, "text": "Flying Lotus after 17:00"},
    ).json()
    j = wait(c, job["job_id"])
    assert j["status"] == "COMPLETED", j
    assert c.get(f"/api/projects/{p['id']}").json()["day"]["acts"][0]["earliest"] == 960
    approved = c.post(
        f"/api/projects/{p['id']}/notes/approve",
        headers=H,
        json={"version": 1, "note_id": j["result"]["note_id"]},
    )
    assert approved.status_code == 200
    assert (
        c.get(f"/api/projects/{p['id']}").json()["day"]["acts"][0]["earliest"] == 1020
    )
