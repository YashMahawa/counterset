"""Explicit small live test: one Qloo row, one note, two model-only comparisons.

Uses only the configured existing free-project key. Results stay in .private.
Run with the local application already serving. No credentials are printed.
"""

import json
import sys
import time
from pathlib import Path
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.providers import Gateway
from app.evidence import score_row

root = Path(__file__).resolve().parents[1]
cfg = Config()
gateway = Gateway(cfg)
recorded = json.loads((cfg.private / "recorded.json").read_text())
ids = list(recorded["catalogue"].values())
payload, source = gateway.qloo(
    "/v2/insights",
    {
        "filter.type": "urn:entity:artist",
        "signal.interests.entities": ids[0],
        "filter.results.entities": ",".join(ids),
        "take": len(ids),
        "feature.explainability": "true",
    },
)
checked = score_row(payload, ids[0], ids)
print(
    json.dumps(
        {
            "qloo_preflight": source,
            "complete": checked["complete"],
            "scored_peers": len(checked["scores"]),
        }
    ),
    flush=True,
)
client = httpx.Client(
    base_url="http://127.0.0.1:8877/api",
    headers={"X-Counterset": "workspace"},
    timeout=30,
)


def request(path, body):
    r = client.post(path, json=body)
    r.raise_for_status()
    return r.json()


def wait(job):
    for _ in range(500):
        j = client.get("/jobs/" + job["job_id"]).json()
        if j["status"] != "RUNNING":
            if j["status"] == "FAILED":
                raise RuntimeError(j["error"])
            return j["result"]
        time.sleep(1)
    raise RuntimeError("Timed out waiting for job")


p = request("/projects", None)
pid = p["id"]
wait(request(f"/projects/{pid}/evidence", {"version": 1, "source": "recorded"}))
version = 2
note = wait(
    request(
        f"/projects/{pid}/notes",
        {
            "version": version,
            "text": "Flying Lotus cannot start before 17:00. This is confirmed by the artist agent.",
            "model": "gemma-4-31b-it",
        },
    )
)
print(
    json.dumps(
        {
            "constraint_action": note["action"],
            "time": note.get("value"),
            "status": note["status"],
            "model": note["telemetry"]["model"],
        }
    ),
    flush=True,
)
results = {
    "qloo_preflight": {
        "complete": checked["complete"],
        "scored": len(checked["scores"]),
    },
    "note": note,
    "benchmarks": [],
}
for model in reversed(cfg.models):
    try:
        b = wait(
            request(
                f"/projects/{pid}/benchmark",
                {"version": version, "move_budget": 4, "seconds": 12, "model": model},
            )
        )
        results["benchmarks"].append(b)
        print(
            json.dumps(
                {
                    "model": model,
                    "llm_valid": b["llm_only"]["audit"]["passed"],
                    "llm_errors": b["llm_only"]["audit"]["errors"],
                    "llm_qloo_cue_overlaps": b["llm_only"]["audit"]["counts"]["qloo"],
                    "solver_valid": b["qloo_solver"].get("audit", {}).get("passed"),
                    "solver_qloo_cue_overlaps": b["qloo_solver"]
                    .get("audit", {})
                    .get("counts", {})
                    .get("qloo"),
                }
            ),
            flush=True,
        )
    except RuntimeError as e:
        results["benchmarks"].append({"model": model, "provider_error": str(e)})
        print(json.dumps({"model": model, "provider_error": str(e)}), flush=True)
    (cfg.private / "live-validation.json").write_text(json.dumps(results, indent=2))
(cfg.private / "live-validation.json").write_text(json.dumps(results, indent=2))
print("Saved private live-validation.json", flush=True)
