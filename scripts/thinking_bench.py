"""Time the live agent at each thinking level, on the hard cases the desk gets. Writes app/thinking_bench.json.

The slider on the desk shows these numbers and no others. Usage: scripts/thinking_bench.py [runs per case].
Uses the keys this server uses. No key is printed or stored. Run from the project root.
"""

import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import desk_agent
from app.config import Config
from app.domain import Day
from app.providers import Gateway

MODEL = "gemini-3.5-flash-lite"
CASES = [
    ("outside-lands-2026-saturday", "Sutro lost power about 4:20pm and the techs say an hour. Curfew is still 10pm."),
    ("lollapalooza-2024-saturday", "Ethel Cain's flight is running late, she can't play before 6:30. Park curfew 10pm."),
]


def main():
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    source = ROOT / ".private" / "examples"
    os.environ["COUNTERSET_PRIVATE_DIR"] = tempfile.mkdtemp(prefix="bench-")
    cfg = Config()
    cfg.model_limit = 100000
    rows = []
    for _ in range(runs):
        for level in ("low", "medium", "high"):
            for example, message in CASES:
                ex = json.loads((source / f"{example}.json").read_text())
                ex["context"].pop("recorded_run", None)
                day = Day.model_validate(ex["day"])
                began = time.time()
                row = {"level": level, "example": example}
                try:
                    out = desk_agent.run(day, ex["evidence"], ex["context"], message, Gateway(cfg), MODEL, seconds=cfg.agent_solve_seconds, thinking=level)
                    row.update(calls=out["usage"]["model_calls"], tokens=out["usage"]["tokens"], plan=out["rescue_id"] is not None, refused=sum(not t["ok"] for t in out["trace"]))
                    if out["rescue_id"] is not None:
                        a = out["session"].rescues[out["rescue_id"]]["result"]["audit"]
                        row.update(clashes=sum(c["source"] == "qloo" for c in a["conflicts"]), moves=a["moves"])
                except Exception as e:
                    row["error"] = type(e).__name__
                row["seconds"] = round(time.time() - began, 1)
                rows.append(row)
                print(row, flush=True)
    levels = {}
    for level in ("low", "medium", "high"):
        done = [r for r in rows if r["level"] == level and "error" not in r]
        levels[level] = {
            "runs": len(done),
            "failed": sum(r["level"] == level and "error" in r for r in rows),
            "seconds": round(statistics.median(r["seconds"] for r in done)),
            "tokens": round(statistics.median(r["tokens"] for r in done)),
            "calls": round(statistics.median(r["calls"] for r in done)),
            "plans": sum(r["plan"] for r in done),
            "clean": sum(r.get("clashes") == 0 for r in done),
        }
    out = {"model": MODEL, "at": round(time.time()), "levels": levels, "rows": rows}
    (ROOT / "app" / "thinking_bench.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(levels, indent=1))


if __name__ == "__main__":
    main()
