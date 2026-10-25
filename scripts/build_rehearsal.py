"""Build the multi-arts rehearsal example: real musicians, comedians and podcasts on an
illustrative festival day. Resolves names through Qloo search (exact-name matches
only), fetches exact-bill rows for every kind, and writes a private example file."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.domain import QLOO_TYPES, Day
from app.evidence import entities, fetch_snapshot
from app.providers import Gateway

M, G, W, C, P = "stage-main", "stage-grove", "stage-warehouse", "stage-comedy", "stage-podcast"
BILL = [
    # name, kind, stage, start, minutes, allowed
    ("Taylor Swift", "artist", M, "16:00", 50, [M, G, W]),
    ("Kamasi Washington", "artist", M, "17:00", 50, [M, G, W]),
    ("Radiohead", "artist", M, "18:00", 50, [M, G, W]),
    ("Kendrick Lamar", "artist", M, "19:00", 50, [M, G, W]),
    ("Flying Lotus", "artist", G, "16:00", 50, [M, G, W]),
    ("DJ Shadow", "artist", G, "17:00", 50, [M, G, W]),
    ("Björk", "artist", G, "18:00", 50, [M, G, W]),
    ("Thundercat", "artist", G, "19:00", 50, [M, G, W]),
    ("BTS", "artist", W, "16:00", 50, [M, G, W]),
    ("Massive Attack", "artist", W, "17:00", 50, [M, G, W]),
    ("A. R. Rahman", "artist", W, "18:00", 50, [M, G, W]),
    ("Arijit Singh", "artist", W, "19:00", 50, [M, G, W]),
    ("Nate Bargatze", "comedian", C, "16:00", 45, [C]),
    ("Ali Wong", "comedian", C, "17:00", 45, [C]),
    ("Hasan Minhaj", "comedian", C, "18:00", 45, [C]),
    ("John Mulaney", "comedian", C, "19:00", 45, [C]),
    ("Bo Burnham", "comedian", C, "15:00", 45, [C, G]),
    ("Conan O'Brien Needs a Friend", "podcast", P, "16:00", 60, [P]),
    ("SmartLess", "podcast", P, "17:30", 60, [P]),
    ("Song Exploder", "podcast", P, "19:00", 60, [P]),
]
LOCKED = {"Kendrick Lamar", "Taylor Swift", "John Mulaney"}


def norm(s):
    return "".join(c for c in s.lower().replace("’", "'") if c.isalnum())


def minutes(t):
    h, m = map(int, t.split(":"))
    return h * 60 + m


def build():
    cfg = Config()
    gw = Gateway(cfg)
    acts, draft, unresolved = [], [], []
    for i, (name, kind, stage, start, length, allowed) in enumerate(BILL):
        query = name.replace("A. R. Rahman", "A.R. Rahman")
        payload, _ = gw.qloo("/search", {"query": query, "types": QLOO_TYPES[kind], "take": 3})
        top = entities(payload)[:1]
        qid = top[0]["entity_id"] if top and norm(top[0].get("name", "")) == norm(query) else None
        if not qid:
            unresolved.append(name)
        aid = f"act-{i}"
        acts.append({"id": aid, "name": name, "kind": kind, "qloo_id": qid, "duration": length, "changeover": 10, "allowed_stages": allowed, "earliest": 900, "latest": 1380, "locked": name in LOCKED})
        draft.append({"act_id": aid, "stage_id": stage, "start": minutes(start)})
    day = Day.model_validate({
        "name": "Crosswinds · multi-arts rehearsal",
        "stages": [
            {"id": M, "name": "Main", "opens": 900, "closes": 1380},
            {"id": G, "name": "Grove", "opens": 900, "closes": 1380},
            {"id": W, "name": "Warehouse", "opens": 900, "closes": 1380},
            {"id": C, "name": "Comedy Tent", "opens": 900, "closes": 1380},
            {"id": P, "name": "Podcast Stage", "opens": 900, "closes": 1380},
        ],
        "acts": acts, "draft": draft, "grid": 15, "k": 3,
    })
    evidence = fetch_snapshot(day, gw, lambda n, t, d=None: print(d, flush=True))
    context = {
        "kind": "synthetic",
        "title": "Crosswinds · multi-arts rehearsal",
        "summary": "Musicians, comedians and live podcasts on one bill. Real names and live Qloo evidence; the festival and its grid are illustrative.",
        "order": 2,
        "note": "Rehearsal day: real performer names and Qloo rows, an invented festival, timings and contracts. No performer is booked.",
        "sample_message": "Production: Comedy Tent sound desk is down, so the tent is closed 18:00–19:00. Bo Burnham's team says he can do the Grove instead if needed. Also, Thundercat's flight lands late, so he cannot start before 19:30.",
        "unresolved": unresolved,
    }
    out = cfg.private / "examples"
    out.mkdir(exist_ok=True)
    (out / "crosswinds-multi-arts.json").write_text(json.dumps({"day": day.model_dump(), "evidence": evidence, "context": context}, indent=1))
    print(evidence["status"], evidence["complete_rows"], "/", evidence["total_rows"], "rows;", len(evidence["edges"]), "cues;", sum(e["cross"] for e in evidence["edges"]), "cross-kind; unresolved", unresolved)


if __name__ == "__main__":
    build()
