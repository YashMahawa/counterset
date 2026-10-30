"""Run the rescue agent live once on a template day and save the whole run, for replay.

A visitor who changes nothing watches this saved run: no model call, no solver, no cost.
--paid reads the key from ~/gemini_paid.env for this process only. It is never printed, stored
or deployed. The server only ever holds the free key. Run from the project root.
"""

import json
import sys
import tempfile
import os
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import desk_agent
from app.config import Config
from app.domain import Day
from app.evidence import all_edges
from app.providers import Gateway
from app.validator import audit
from app.domain import Placement


def main(example, model="gemini-3.8-flash", paid=False):
    examples = Path(__file__).resolve().parents[1] / ".private" / "examples"
    os.environ["COUNTERSET_PRIVATE_DIR"] = tempfile.mkdtemp(prefix="record-")
    cfg = Config()
    cfg.models = [model]
    cfg.model_limit = 100000
    if paid:
        cfg.model_key = Path("~/gemini_paid.env").expanduser().read_text().strip()
        cfg.extra_model_keys = []
    file = examples / f"{example}.json"
    ex = json.loads(file.read_text())
    ex["context"].pop("recorded_run", None)
    day = Day.model_validate(ex["day"])
    message = ex["context"]["sample_message"]

    def show(step):
        print(f"{example} {step['n']:>2} {step['tool']} => {step['line']} ({step['seconds']}s)", flush=True)

    out = desk_agent.run(day, ex["evidence"], ex["context"], message, Gateway(cfg), model, show, seconds=10)
    print(example, "SUMMARY", out["summary_source"], out["summary"], out["summary_rejected"], out["usage"], flush=True)
    if out["rescue_id"] is None:
        raise SystemExit(f"{example}: the agent found no plan, so nothing was saved")
    proposal = desk_agent.to_proposal(out, day)
    sandbox = Day.model_validate(proposal["day"])
    places = [Placement.model_validate(x) for x in proposal["options"][0]["placements"]]
    if not audit(sandbox, places, all_edges(sandbox, ex["evidence"]), proposal["budget"])["passed"]:
        raise SystemExit(f"{example}: the validator refused the plan, so nothing was saved")
    run = {
        "model": model,
        "thinking": cfg.thinking,
        "at": time.time(),
        "message": message,
        "decisions": out["decisions"],
        "usage": out["usage"],
        "saved": json.loads(json.dumps({"trace": out["trace"], "proposal": proposal})),
    }
    ex = json.loads(file.read_text())
    ex["context"]["recorded_run"] = run
    file.write_text(json.dumps(ex, indent=1))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--paid"]
    main(*args, paid="--paid" in sys.argv)
