"""Convert the earlier Pitchfork 2024 Friday validation into a worked example, re-deriving
its evidence from cached exact-bill Qloo rows only (no network)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.domain import Day
from app.evidence import fetch_snapshot
from app.providers import Gateway


def build():
    cfg = Config()
    old = json.loads((cfg.private / "real-day-validation.json").read_text())
    day = Day.model_validate(old["day"])
    evidence = fetch_snapshot(day, Gateway(cfg), offline=True)
    context = {
        "kind": "retrospective",
        "title": "Pitchfork 2024 · Friday",
        "summary": "14 published sets on 3 staggered stages, Union Park, Chicago. Present-day Qloo evidence on a past timetable.",
        "order": 3,
        "source": old["source"],
        "note": "Published times and stages. Production rules below are hypothetical. Not affiliated with the festival.",
        "assumptions": old["assumptions"],
        "sample_message": "Lightning protocol: Blue stage is clear 18:15–19:00. Sets already started keep their slots.",
    }
    out = cfg.private / "examples"
    out.mkdir(exist_ok=True)
    (out / "pitchfork-2024-friday.json").write_text(json.dumps({"day": day.model_dump(), "evidence": evidence, "context": context}, indent=1))
    print(evidence["status"], evidence["complete_rows"], "/", evidence["total_rows"], len(evidence["edges"]), "cues")


if __name__ == "__main__":
    build()
