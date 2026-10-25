"""Build the Lollapalooza 2024 Saturday retrospective example from the published timetable.

Reads the committed public timetable source plus private identity decisions and
search results, queries (or reuses cached) exact-bill Qloo rows, and writes a
private example file holding derived ranks only. Run from the project root.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.domain import Day
from app.evidence import fetch_snapshot
from app.providers import Gateway

TIERS = {"Bud Light": "main", "T-Mobile": "main", "Tito's": "mid", "IHG": "mid", "Bacardi": "small", "BMI": "small", "Sonny's": "dj"}
LOCKED = {"Future X Metro Boomin", "The Killers", "Skrillex", "Yoasobi"}


def minutes(t):
    h, m = map(int, t.split(":"))
    return h * 60 + m


def slug(s):
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-")


def build(offline=False):
    cfg = Config()
    root = Path(__file__).resolve().parents[1]
    rows = [l.split("|") for l in (root / "scripts/sources/lollapalooza-2024-saturday.txt").read_text().splitlines() if l and not l.startswith("#")]
    resolutions = {x["name"]: x for x in json.loads((cfg.private / "lolla/resolutions.json").read_text())}
    decisions = json.loads((cfg.private / "lolla/identity_decisions.json").read_text())
    stages = sorted({r[0] for r in rows}, key=list(TIERS).index)
    stage_id = {s: "stage-" + slug(s) for s in stages}
    gaps = {}
    for s in stages:
        sets = sorted((minutes(a), minutes(b)) for st, _, a, b in rows if st == s)
        gaps[s] = min(min(n[0] - p[1] for p, n in zip(sets, sets[1:])), 30)
    acts, draft = [], []
    for s, name, a, b in rows:
        cands = resolutions[name]["candidates"]
        qid = None
        if name in decisions["proxy"]:
            qid = next(c["id"] for c in cands if c["name"] == decisions["proxy"][name]["use"])
        elif name not in decisions["unresolved"] and cands:
            qid = cands[0]["id"]
        aid = "act-" + slug(name)
        acts.append({
            "id": aid, "name": name, "kind": "artist", "qloo_id": qid,
            "duration": minutes(b) - minutes(a), "changeover": gaps[s],
            "allowed_stages": [stage_id[x] for x in stages if TIERS[x] == TIERS[s]],
            "earliest": 720, "latest": 1320, "locked": name in LOCKED,
        })
        draft.append({"act_id": aid, "stage_id": stage_id[s], "start": minutes(a)})
    day = Day.model_validate({
        "name": "Lollapalooza 2024 · Saturday",
        "date": "2024-08-03",
        "stages": [{"id": stage_id[s], "name": s, "opens": 720, "closes": 1320} for s in stages],
        "acts": acts, "draft": draft, "grid": 5, "threshold": 10, "k": 3,
    })
    evidence = fetch_snapshot(day, Gateway(cfg), lambda n, t, d=None: print(d, flush=True), offline=offline)
    context = {
        "kind": "retrospective",
        "title": "Lollapalooza 2024 · Saturday",
        "summary": "42 published sets on 7 stages, Grant Park, Chicago. Present-day Qloo evidence on a past timetable.",
        "order": 1,
        "source": "https://www.timeout.com/chicago/news/lollapalooza-2024-lineup-and-set-times-the-full-schedule-you-need-to-know-073124",
        "corroboration": "https://uproxx.com/music/lollapalooza-chicago-set-times-2024/",
        "sample_message": "Lightning protocol from site ops: Bacardi stage is closed 17:15–18:15 while the roof is checked. Separately, Ethel Cain's tour manager says she cannot go on before 18:00. Please don't touch anything that has already started.",
        "note": "Published pre-festival timetable (Kidzapalooza excluded). Production rules below are hypothetical. Not affiliated with the festival.",
        "assumptions": [
            "Acts may move only between stages of the same size: Bud Light/T-Mobile, Tito's/IHG, Bacardi/BMI, Sonny's alone",
            "Changeover per stage equals its shortest published gap, capped at 30 minutes",
            "Every act is available 12:00–22:00; 22:00 curfew on every stage",
            "Headliners Future X Metro Boomin, The Killers, Skrillex and Yoasobi are locked",
            "Headliner end times were not published; 22:00 assumed",
            "Future X Metro Boomin uses the Metro Boomin entity; 10 acts stay unresolved rather than guessed",
        ],
    }
    out = cfg.private / "examples"
    out.mkdir(exist_ok=True)
    (out / "lollapalooza-2024-saturday.json").write_text(json.dumps({"day": day.model_dump(), "evidence": evidence, "context": context}, indent=1))
    print(evidence["status"], evidence["complete_rows"], "/", evidence["total_rows"], "rows;", len(evidence["edges"]), "cues;", len(evidence["unknown"]), "unknown pairs")


if __name__ == "__main__":
    build(offline="--offline" in sys.argv)
