"""Run the rescue agent live once and keep the model's decisions, for the recorded replay.

Only the decisions are kept. A replay re-runs every tool, so the solver and the validator
work again in front of the viewer. Run from the project root.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import desk_agent
from app.config import Config
from app.domain import Day
from app.providers import Gateway


def main(example="bonnaroo-2026-sunday", model="gemini-3.5-flash-lite"):
    cfg = Config()
    file = cfg.private / "examples" / f"{example}.json"
    ex = json.loads(file.read_text())
    day = Day.model_validate(ex["day"])
    message = ex["context"]["sample_message"]

    def show(step):
        print(f"{step['n']:>2} {step['tool']} {json.dumps(step['args'])[:150]}\n   thought: {step['thought']}\n   => {step['line']} ({step['seconds']}s)", flush=True)

    out = desk_agent.run(day, ex["evidence"], ex["context"], message, Gateway(cfg), model, show, seconds=10)
    print("SUMMARY", out["summary_source"], out["summary"], out["summary_rejected"], out["usage"])
    ex = json.loads(file.read_text())
    ex["context"]["recorded_run"] = {"model": model, "at": time.time(), "message": message, "decisions": out["decisions"], "usage": out["usage"]}
    file.write_text(json.dumps(ex, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:])
