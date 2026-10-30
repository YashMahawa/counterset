"""Solve the storm replay under every pair of terms, for the public page's live control.

The public page reads this table so it responds instantly; the studio solves live. Each
result is the same solver and the same independent validator. Run from the project root.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.domain import Day, Placement
from app.evidence import all_edges, attendee_edges
from app.repair import apply_scenario, as_run_audit, site_hold
from app.solver import solve
from app.validator import audit

CURFEWS = [24 * 60, 24 * 60 + 30, 25 * 60]
SHORTEST = [100, 85, 75, 60, 50]


def main(seconds=20):
    cfg = Config()
    file = cfg.private / "examples/bonnaroo-2026-sunday.json"
    ex = json.loads(file.read_text())
    day = Day.model_validate(ex["day"])
    evidence = ex["evidence"]
    storm = ex["context"]["storm"]
    held = site_hold(day, storm["start"], storm["end"], "Site evacuated")
    names = {a.id: a.name for a in day.acts}
    cancelled = {p["act_id"] for p in ex["context"]["as_run"] if p.get("cut")}

    def clashes(checked):
        return [
            {"a": c["a"], "b": c["b"], "minutes": c["minutes"], "ranks": c.get("ranks")}
            for c in checked["conflicts"]
            if c["source"] == "qloo"
        ]

    ran = as_run_audit(apply_scenario(held, {"curfew": storm["curfew"], "allow_cut": True}), evidence, ex["context"]["as_run"])
    print("as run: cancelled", len(ran["cuts"]), "clashes", clashes(ran), "errors", ran["errors"][:4], flush=True)
    rows = []
    for curfew in CURFEWS:
        for shortest in SHORTEST:
            began = time.monotonic()
            scenario = {"curfew": curfew, "shortest": shortest, "allow_cut": True}
            d = apply_scenario(held, scenario)
            edges = all_edges(d, evidence)
            out = solve(d, edges, len(d.acts), seconds)
            a = out["audit"]
            blind = solve(d, attendee_edges(edges), len(d.acts), seconds)
            blind_check = audit(d, [Placement.model_validate(p) for p in blind["placements"]], edges, len(d.acts))
            row = {
                "curfew": curfew,
                "shortest": shortest,
                "status": out["status"],
                "played": len(d.acts) - len(a["cuts"]),
                "total": len(d.acts),
                "saved": len(cancelled - set(a["cuts"])),
                "dropped": [names[i] for i in a["cuts"]],
                "minutes_shortened": a["trim_minutes"],
                "sets_shortened": len(a["trimmed"]),
                "moved": a["moves"],
                "clashes": clashes(a),
                "without_qloo": {
                    "status": blind["status"],
                    "played": len(d.acts) - len(blind_check["cuts"]),
                    "clashes": clashes(blind_check),
                },
                "placements": out["placements"],
            }
            rows.append(row)
            print(
                f"{curfew // 60 % 24:02}:{curfew % 60:02} {shortest}%: {out['status']} played {row['played']}/{row['total']} saved {row['saved']}/11, "
                f"short {row['minutes_shortened']}m, clashes {len(row['clashes'])}, blind {len(row['without_qloo']['clashes'])}, {time.monotonic() - began:.1f}s",
                flush=True,
            )
    # A schedule that fits stricter terms also fits looser ones, so looser terms can never do worse.
    # The solver is time-limited, so carry the best result forward where a search fell short.
    for row in rows:
        for other in rows:
            if (
                other["curfew"] <= row["curfew"]
                and other["shortest"] >= row["shortest"]
                and (len(other["dropped"]), other["minutes_shortened"]) < (len(row["dropped"]), row["minutes_shortened"])
            ):
                row.update({k: other[k] for k in ("played", "saved", "dropped", "minutes_shortened", "sets_shortened", "moved", "clashes", "placements", "without_qloo")})
    ex = json.loads(file.read_text())
    ex["context"]["rescue_table"] = {
        "curfews": CURFEWS,
        "shortest": SHORTEST,
        "rows": rows,
        "as_run": {"cancelled": [names[i] for i in ran["cuts"]], "clashes": clashes(ran), "placements": ex["context"]["as_run"]},
        "acts": [{"id": a.id, "name": a.name, "duration": a.duration, "qloo": bool(a.qloo_id), "headliner": a.headliner} for a in day.acts],
        "stages": [{"id": s.id, "name": s.name} for s in day.stages],
        "draft": [p.model_dump() for p in day.draft],
        "storm": storm,
        "names": names,
        "computed_at": time.time(),
    }
    file.write_text(json.dumps(ex, indent=1))


if __name__ == "__main__":
    main(float(sys.argv[1]) if len(sys.argv) > 1 else 20)
