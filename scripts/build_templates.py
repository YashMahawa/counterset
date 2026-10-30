"""Build the ready-to-try days from published timetables and real Qloo rows.

Each one is an ordinary lineup, so a person can edit any line. Only derived ranks and tag names are
stored. A pair is left unknown when Qloo has no exact-name match for an act.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import lineup
from app.config import Config
from app.domain import canonical_pair
from app.evidence import all_edges, explain_pairs, fetch_snapshot
from app.providers import Gateway
from app.validator import audit

ROOT = Path(__file__).resolve().parent / "sources"


def sets(file, day=None, stages=None, after=0):
    rows = []
    for line in (ROOT / file).read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split("|")
        if day:
            if parts[0] != day:
                continue
            parts = parts[1:]
        h, m = map(int, parts[2].split(":"))
        if (stages is None or parts[0] in stages) and h * 60 + m >= after:
            rows.append(" | ".join(parts))
    return "\n".join(rows)


OL = "https://festiplannr.com/festival/outside-lands-2026/set-times"
LOLLA = "https://www.timeout.com/chicago/news/lollapalooza-2024-lineup-and-set-times-the-full-schedule-you-need-to-know-073124"
TEMPLATES = {
    "outside-lands-2026-saturday": {
        "name": "Outside Lands 2026, Saturday",
        "text": sets("outside-lands-2026.txt", "sat"),
        "curfew": 22 * 60,
        "order": 0,
        "where": "San Francisco",
        "tiers": [["Lands End", "Twin Peaks"], ["Sutro"], ["Panhandle", "SOMA"]],
        "why": "The Strokes and The xx play at once, and each is the other's closest match on the bill.",
        "message": "Power fault on Sutro. The stage is closed from 16:20 to 17:20. Golden Gate Park curfew is still 22:00.",
    },
    "lollapalooza-2024-saturday": {
        "name": "Lollapalooza 2024, Saturday evening",
        "text": sets("lollapalooza-2024-saturday.txt", None, {"Bud Light", "T-Mobile", "Tito's", "Bacardi", "Sonny's", "IHG"}, 16 * 60),
        "curfew": 22 * 60,
        "order": 2,
        "where": "Chicago",
        "tiers": [["Bud Light", "T-Mobile"], ["Tito's", "IHG"], ["Bacardi", "Sonny's"]],
        "why": "Ethel Cain runs late, and the obvious new slot lands on Romy, her closest match.",
        "message": "Ethel Cain's flight is late. She cannot go on before 18:30. The park curfew is 22:00.",
    },
    "outside-lands-2026-friday": {
        "name": "Outside Lands 2026, Friday",
        "text": sets("outside-lands-2026.txt", "fri"),
        "curfew": 22 * 60,
        "order": 3,
        "where": "San Francisco",
        "tiers": [["Lands End", "Twin Peaks"], ["Sutro"], ["Panhandle", "SOMA"]],
        "why": "Subtronics and Odd Mob overlap for 90 minutes, and each is the other's closest match.",
        "message": "Rigging fault on Twin Peaks. The stage is closed from 17:10 to 17:55 while it is inspected. Golden Gate Park curfew is 22:00.",
    },
}


def build(only=None):
    cfg = Config()
    gw = Gateway(cfg)
    out = cfg.private / "examples"
    for tid, t in TEMPLATES.items():
        if only and tid != only:
            continue
        day = lineup.parse(t["name"], t["text"])
        data = day.model_dump()
        for s in data["stages"]:
            s["closes"] = t["curfew"]
        tier = {name: i for i, names in enumerate(t["tiers"]) for name in names}
        ids = {s["name"]: s["id"] for s in data["stages"]}
        home = {p["act_id"]: next(n for n, i in ids.items() if i == p["stage_id"]) for p in data["draft"]}
        # A set can move to a stage of its own size or one size up. Stage sizes are assumed.
        for a in data["acts"]:
            # Acts are on site for about two hours either side of their published set. Also assumed.
            start = next(p["start"] for p in data["draft"] if p["act_id"] == a["id"])
            a["earliest"] = max(data["stages"][0]["opens"], start - 120)
            a["latest"] = min(t["curfew"], start + a["duration"] + 120)
            mine = tier[home[a["id"]]]
            a["allowed_stages"] = [ids[n] for n, i in tier.items() if n in ids and mine - 1 <= i <= mine]
        day = type(day).model_validate(data)
        day, found = lineup.match(day, gw)
        evidence = fetch_snapshot(day, gw)
        checked = audit(day, day.draft, all_edges(day, evidence))
        clashes = [c for c in checked["conflicts"] if c["source"] == "qloo"]
        evidence["explain"] = explain_pairs(day, evidence, gw)
        # Every clash on the grid gets its reason, not only the strongest pairs.
        missing = [{**c, "ranks": c.get("ranks") or [1, 1]} for c in clashes if "|".join(canonical_pair(c["a"], c["b"])) not in evidence["explain"]]
        if missing:
            evidence["explain"].update(explain_pairs(day, {"edges": missing}, gw, limit=len(missing)))
        names = {a.id: a.name for a in day.acts}
        print(f"\n== {tid}: {len(day.acts)} sets, {len(found)} found, {len(evidence['edges'])} pairs, {len(clashes)} clashes, errors {checked['errors'][:3]}")
        print(" not found:", [a.name for a in day.acts if not a.qloo_id])
        for c in clashes:
            print(f"  {names[c['a']]} × {names[c['b']]}: {c['minutes']} min, ranks {c.get('ranks')} of {c.get('of')}, tags {evidence['explain'].get('|'.join(canonical_pair(c['a'], c['b'])))}")
        context = {
            "kind": "retrospective",
            "title": t["name"],
            "order": t["order"],
            "summary": f"{len(day.acts)} published sets, {t['where']}.",
            "source": OL if "outside" in tid else LOLLA,
            "note": "Published set times with real Qloo rows. The problem is an example, and the production rules are assumed. Not affiliated with the festival.",
            "sample_message": t["message"],
            "why": t["why"],
        }
        (out / f"{tid}.json").write_text(json.dumps({"day": day.model_dump(), "evidence": evidence, "context": context}, indent=1))


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else None)
