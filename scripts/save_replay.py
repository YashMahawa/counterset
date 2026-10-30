"""Save the recorded run's results for very small servers. No model or Qloo call.

Replays the recorded decisions once on this machine and keeps every step and the final
proposal, retrying until the model's own summary still matches the solver's numbers.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import desk_agent
from app.config import Config
from app.domain import Day


def main(example="bonnaroo-2026-sunday"):
    file = Config().private / "examples" / f"{example}.json"
    ex = json.loads(file.read_text())
    recorded = ex["context"]["recorded_run"]
    day = Day.model_validate(ex["day"])
    for attempt in range(6):
        out = desk_agent.run(day, ex["evidence"], ex["context"], recorded["message"], None, recorded["model"], turns=recorded["decisions"], seconds=10)
        print(attempt, out["summary_source"], out["summary"][:120], flush=True)
        if out["summary_source"] == "model":
            break
    recorded["saved"] = json.loads(json.dumps({"trace": out["trace"], "proposal": desk_agent.to_proposal(out, day)}))
    ex = {**json.loads(file.read_text()), "context": {**json.loads(file.read_text())["context"], "recorded_run": recorded}}
    file.write_text(json.dumps(ex, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:])
