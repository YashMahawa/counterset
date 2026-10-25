"""Bounded retrospective validation on one publicly published festival day.

At most fourteen searches plus one exact row per resolved act and one control.
Public time/stage facts are separate from explicitly hypothetical production rules.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.providers import Gateway
from app.domain import Day
from app.evidence import fetch_snapshot, all_edges, entities
from app.solver import solve
from app.validator import audit

SOURCE = "https://pitchfork.com/news/pitchfork-music-festival-2024-schedule-all-the-set-times-you-need-to-know/"
SETS = [
    ("Black Duck", "green", 780, 820),
    ("Angry Blackmen", "red", 825, 865),
    ("ML Buch", "green", 870, 915),
    ("Rosali", "blue", 885, 930),
    ("Tkay Maidza", "red", 920, 970),
    ("Doss", "blue", 960, 1005),
    ("billy woods & Kenny Segal", "green", 975, 1030),
    ("Yaeji", "red", 1035, 1090),
    ("Amen Dunes", "blue", 1035, 1080),
    ("100 gecs", "green", 1095, 1155),
    ("Sudan Archives", "blue", 1110, 1155),
    ("Jai Paul", "red", 1165, 1225),
    ("Jeff Rosenstock", "blue", 1185, 1230),
    ("Black Pumas", "green", 1230, 1305),
]
cfg = Config()
g = Gateway(cfg)
resolved = {}
report = []
# Only reuse exact artist identities already present in this workspace's research.
for p in (cfg.root.parent / "research/api").glob("*.json"):
    try:
        for e in entities(json.loads(p.read_text())):
            if e.get("name") in {s[0] for s in SETS} and "artist" in str(
                e.get("type", "")
            ):
                resolved.setdefault(e["name"], {})[e["entity_id"]] = e
    except (ValueError, AttributeError, TypeError):
        continue
catalogue = {}
for name, stage, start, end in SETS:
    candidates = list(resolved.get(name, {}).values())
    if not candidates:
        payload, _ = g.qloo(
            "/search", {"query": name, "types": "urn:entity:artist", "take": 5}
        )
        candidates = entities(payload)
    exact = [e for e in candidates if e.get("name", "").casefold() == name.casefold()]
    # No automatic famous proxy for a missing joint billing.
    selected = exact[0] if len(exact) == 1 else None
    if name == "Black Duck":
        # A homonymous identity needs disambiguation; stay unscored rather than guess.
        selected = None
    catalogue[name] = selected.get("entity_id") if selected else None
    item = {
        "name": name,
        "resolved": bool(selected),
        "candidates": [
            {
                "name": e.get("name"),
                "id": e.get("entity_id"),
                "disambiguation": e.get("disambiguation"),
            }
            for e in candidates
        ],
    }
    report.append(item)
    print(
        json.dumps(
            {"artist": name, "resolved": bool(selected), "exact_matches": len(exact)}
        ),
        flush=True,
    )
(cfg.private / "real_resolutions.json").write_text(json.dumps(report, indent=2))
day = Day.model_validate(
    {
        "name": "Pitchfork 2024 Friday · retrospective",
        "date": "2024-07-19",
        "grid": 5,
        "stages": [
            {"id": s, "name": s.title(), "opens": 780, "closes": 1320}
            for s in ["green", "red", "blue"]
        ],
        "acts": [
            {
                "id": f"pf-{i}",
                "name": n,
                "qloo_id": catalogue[n],
                "duration": end - start,
                "changeover": 15,
                "allowed_stages": [stage],
                "earliest": 780,
                "latest": 1305,
                "locked": n == "Black Pumas",
            }
            for i, (n, stage, start, end) in enumerate(SETS)
        ],
        "draft": [
            {"act_id": f"pf-{i}", "stage_id": stage, "start": start}
            for i, (n, stage, start, end) in enumerate(SETS)
        ],
    }
)
snapshot = fetch_snapshot(
    day,
    g,
    lambda n, total: print(
        json.dumps({"evidence_rows_done": n, "requests": total}), flush=True
    ),
)
edges = all_edges(day, snapshot)
before = audit(day, day.draft, edges)
after = solve(day, edges, 4, 20)
result = {
    "source": SOURCE,
    "timezone": "America/Chicago",
    "kind": "Retrospective proxy analysis, not an operational recommendation",
    "assumptions": [
        "Stage-only placements are held fixed",
        "Availability is hypothetically the whole published day",
        "Fifteen-minute changeovers",
        "22:00 stage curfews",
        "Black Pumas is pinned at its published placement",
    ],
    "day": day.model_dump(),
    "evidence": snapshot,
    "before": before,
    "after": after,
}
(cfg.private / "real-day-validation.json").write_text(json.dumps(result, indent=2))
(cfg.private / "real-day.json").write_text(day.model_dump_json(indent=2))
print(
    json.dumps(
        {
            "resolved": sum(bool(v) for v in catalogue.values()),
            "acts": len(SETS),
            "coverage": snapshot["status"],
            "cue_edges": len(snapshot["edges"]),
            "before": before["counts"],
            "after": after.get("audit", {}).get("counts"),
            "solver_status": after["status"],
        }
    ),
    flush=True,
)
