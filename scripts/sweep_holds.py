"""Offline sweep: for every stage and every hold start on a 30-minute grid (45 and 60
minutes long), solve the fewest-changed-acts repair with and without Qloo cues.
Reports how often the evidence changes the repair. No network calls."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.domain import Day, Outage
from app.evidence import all_edges, attendee_edges
from app.solver import solve
from app.validator import audit

cfg = Config()
data = json.loads((cfg.private / "examples/lollapalooza-2024-saturday.json").read_text())
base = Day.model_validate(data["day"])
ev = data["evidence"]
edges = all_edges(base, ev)
draft_clash = {(c["a"], c["b"]) for c in audit(base, base.draft, edges)["conflicts"] if c["source"] == "qloo"}
rows = []
for st in base.stages:
    for start in range(13 * 60, 21 * 60 + 1, 30):
        for length in (45, 60):
            day = Day.model_validate(base.model_dump())
            day.outages.append(Outage(stage_id=st.id, start=start, end=start + length))
            for a in day.acts:
                if next(p for p in day.draft if p.act_id == a.id).start < start:
                    a.locked = True
            day = Day.model_validate(day.model_dump())
            if audit(day, day.draft, [])["passed"]:
                continue  # the hold touches no set
            aware = solve(day, all_edges(day, ev), 4, 4, "fewest_acts")
            if not aware.get("placements"):
                rows.append({"stage": st.name, "start": start, "length": length, "status": aware["status"]})
                continue
            blind = solve(day, attendee_edges(all_edges(day, ev)), 4, 4, "fewest_acts")
            b = audit(day, [type(day.draft[0]).model_validate(p) for p in blind["placements"]], all_edges(day, ev))
            blind_clash = {(c["a"], c["b"]) for c in b["conflicts"] if c["source"] == "qloo"}
            aware_clash = {(c["a"], c["b"]) for c in aware["audit"]["conflicts"] if c["source"] == "qloo"}
            rows.append({
                "stage": st.name, "start": start, "length": length, "status": aware["status"],
                "same": aware["placements"] == blind["placements"],
                "aware_clashes": len(aware_clash), "blind_clashes": len(blind_clash),
                "new_in_blind": len(blind_clash - draft_clash - aware_clash),
                "aware_moves": aware["audit"]["moves"], "blind_moves": b["moves"],
            })
            print(rows[-1], flush=True)
(cfg.private / "lolla/hold_sweep.json").write_text(json.dumps(rows, indent=1))
ok = [r for r in rows if "same" in r]
print(f"holds touching a set: {len(rows)}; feasible: {len(ok)}; infeasible/unknown: {len(rows) - len(ok)}")
print(f"Qloo changed the repair: {sum(not r['same'] for r in ok)}; blind repair creates a new cue clash: {sum(r['new_in_blind'] > 0 for r in ok)}")
print(f"mean cue clashes left: aware {sum(r['aware_clashes'] for r in ok) / max(1, len(ok)):.2f}, blind {sum(r['blind_clashes'] for r in ok) / max(1, len(ok)):.2f}")
print(f"mean changed acts: aware {sum(r['aware_moves'] for r in ok) / max(1, len(ok)):.2f}, blind {sum(r['blind_moves'] for r in ok) / max(1, len(ok)):.2f}")
