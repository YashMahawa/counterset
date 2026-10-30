"""Build the Bonnaroo 2026 Sunday replay from the published timetable and press reports.

Identity decisions are made by a person and recorded here. Only an exact-name match whose
tags fit the billed performer is confirmed; everything else stays unresolved and its pairs
stay unknown. Writes a private example file holding derived ranks and tag names only.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.domain import Day, canonical_pair
from app.evidence import fetch_snapshot
from app.providers import Gateway

# Qloo's name for the billed performer, where the two differ.
CONFIRMED = {
    "Aly & AJ": "Aly & AJ", "Trombone Shorty": "Trombone Shorty", "Tedeschi Trucks Band": "Tedeschi Trucks Band",
    "Noah Kahan": "Noah Kahan", "Little Stranger": "Little Stranger", "Spacey Jane": "Spacey Jane",
    "Japanese Breakfast": "Japanese Breakfast", "Clipse": "Clipse", "Kesha": "Ke$ha",
    "Hemlocke Springs": "Hemlocke Springs", "Turnover": "Turnover", "Modest Mouse": "Modest Mouse",
    "Blondshell": "Blondshell", "Del Water Gap": "Del Water Gap", "Mariah The Scientist": "Mariah the Scientist",
    "San Holo": "San Holo", "Big Gigantic": "Big Gigantic",
}
UNRESOLVED_WHY = {
    "Role Model": "Qloo's Role Model is a chiptune act, not the billed singer",
    "Daily Bread": "Qloo's tags (Dutch, rock) do not fit the billed producer",
    "Nat Myers": "no exact match", "Buffalo Traffic Jam": "no exact match", "Girl Tones": "no exact match",
    "Audrey Hobert": "no exact match", "A Hundred Drums": "no exact match",
    "Fcukers": "not in the search results", "Soupless": "not in the search results",
    "MOTIFV": "not in the search results", "LSZEE": "not in the search results",
}
HEADLINERS = {"Noah Kahan", "Kesha", "Modest Mouse"}
# The closing set stays the closing set: its revised start on the day, 22:30.
CLOSER = {"Noah Kahan": 22 * 60 + 30}
# Qloo's Role Model is a different act, so this evening What Stage slot carries a programmer's estimate.
MAIN_STAGE_DRAW = {"Role Model": 0.95}
TIERS = {"What": "big", "Which": "big", "This": "tent", "That": "tent", "Other": "dance"}
HOLD = (13 * 60, 17 * 60 + 15)
CURFEW = 24 * 60
MESSAGE = (
    "13:00. Lightning in the area. Centeroo is being evacuated and every stage is closed. Site ops expect to reopen "
    "at 17:15. Soupless already played. Noah Kahan, Kesha and Modest Mouse must play in full. Hard stop is midnight. "
    "Everything else we can shorten if we have to. What can we save?"
)


# Qloo also returns where a crowd's taste comes from. These do not explain a shared taste.
PLACES = {"United States", "United Kingdom", "American", "British", "Manchester", "Canadian", "Australian", "Canada", "Australia"}


def minutes(t):
    h, m = map(int, t.split(":"))
    return h * 60 + m


def slug(s):
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-")


def explain(day, evidence, gw):
    """Why a pair shares a crowd, in Qloo's own tag names. Only the tag names are kept."""
    out = {}
    for e in evidence["edges"]:
        qa, qb = (next(a.qloo_id for a in day.acts if a.id == x) for x in (e["a"], e["b"]))
        payload, _ = gw.qloo(
            "/v2/analysis/compare",
            {"a.signal.interests.entities": qa, "b.signal.interests.entities": qb, "take": 12},
        )
        res = payload.get("results", {})
        tags = res.get("tags", []) if isinstance(res, dict) else []
        names = [t.get("name") for t in tags if t.get("name") and t.get("name") not in PLACES]
        out["|".join(canonical_pair(e["a"], e["b"]))] = names[:6]
    return out


def build():
    cfg = Config()
    gw = Gateway(cfg)
    root = Path(__file__).resolve().parents[1]
    rows = [l.split("|") for l in (root / "scripts/sources/bonnaroo-2026-sunday.txt").read_text().splitlines() if l and not l.startswith("#")]
    search = json.loads((cfg.private / "bonnaroo/search.json").read_text())
    stages = list(TIERS)
    stage_id = {s: "stage-" + slug(s) for s in stages}
    gaps = {}
    for s in stages:
        sets = sorted((minutes(a), minutes(b)) for st, _, a, b, _ in rows if st == s)
        gaps[s] = min(n[0] - p[1] for p, n in zip(sets, sets[1:]))
    acts, draft, as_run = [], [], []
    for s, name, a, b, outcome in rows:
        wanted = CONFIRMED.get(name)
        match = next((c for c in search[name] if c["name"] == wanted), None) if wanted else None
        qid = match["id"] if match else None
        if wanted and not qid:
            raise SystemExit(f"{name}: expected Qloo entity {wanted} not in search results")
        aid = "act-" + slug(name)
        acts.append({
            "id": aid, "name": name, "kind": "artist", "qloo_id": qid,
            "duration": minutes(b) - minutes(a), "changeover": 0 if name == "Soupless" else gaps[s],
            "allowed_stages": [stage_id[x] for x in stages if TIERS[x] == TIERS[s]],
            # People plan around the published time and acts arrive for it, so nothing moves earlier.
            "earliest": CLOSER.get(name, minutes(a)), "latest": 1500, "locked": name == "Soupless", "headliner": name in HEADLINERS,
            "draw": match.get("pop") if match else MAIN_STAGE_DRAW.get(name),
        })
        draft.append({"act_id": aid, "stage_id": stage_id[s], "start": minutes(a)})
        if name == "Soupless":
            as_run.append(draft[-1])
        elif outcome == "cancelled":
            as_run.append({**draft[-1], "cut": True})
        else:
            as_run.append({**draft[-1], "start": minutes(a) + 60})
    day = Day.model_validate({
        "name": "Bonnaroo 2026 · Sunday",
        "date": "2026-06-14",
        "stages": [{"id": stage_id[s], "name": s, "opens": 720, "closes": 1380} for s in stages],
        "acts": acts, "draft": draft, "grid": 5, "threshold": 10, "k": 3, "auto_lock_started": False,
    })
    evidence = fetch_snapshot(day, gw, lambda n, t, d=None: print(d, flush=True))
    evidence["explain"] = explain(day, evidence, gw)
    context = {
        "kind": "replay",
        "title": "Bonnaroo 2026 · Sunday storm",
        "summary": "A real storm, a real timetable. 11 sets were cancelled on 14 June 2026. How many could have played?",
        "order": 0,
        "source": "https://festiplannr.com/festival/bonnaroo-2026/set-times",
        "corroboration": "https://stereogum.com/2502293/bonnaroo-2026-weather-wipes-out-11-sunday-sets-including-aly-aj-for-a-second-straight-year/news",
        "sample_message": MESSAGE,
        "storm": {"start": HOLD[0], "end": HOLD[1], "curfew": CURFEW},
        "as_run": as_run,
        "note": "Published timetable and press reports of 14 June 2026. Production rules are assumed. Not affiliated with Bonnaroo or any performer.",
        "assumptions": [
            "Site closed 13:00–17:15. Reports put the evacuation at 14:00–14:15, but sets due from 12:30 were also cancelled, so the replay treats them as unplayed",
            "Soupless is not on the reported cancelled list, so it counts as played",
            "Midnight finish, because Noah Kahan's revised set ended at midnight",
            "Changeover per stage equals its shortest published gap: What and Which 45 minutes, This and That 30, Other 15",
            "Acts may move only between stages of a similar size: What and Which, This and That, Other alone",
            "Every act was still on site and willing to play a shorter set. This is the largest assumption; the festival knew things this replay cannot",
            "No set starts earlier than its published time, because people plan around it and acts arrive for it",
            "Noah Kahan, Kesha and Modest Mouse play in full, and Noah Kahan starts no earlier than 22:30, his revised start on the day",
            "If a set must go, the lowest Qloo popularity goes first. An act Qloo cannot identify counts as middling, except Role Model, whose evening What Stage slot carries a programmer's estimate",
            "As-run grid is reconstructed: reported cancellations, confirmed times for the three headliners, and the reported one-hour push for the rest",
            "The sample message is written from press reports. The festival's own radio traffic is not public",
        ],
        "unresolved_why": UNRESOLVED_WHY,
    }
    out = cfg.private / "examples"
    out.mkdir(exist_ok=True)
    (out / "bonnaroo-2026-sunday.json").write_text(json.dumps({"day": day.model_dump(), "evidence": evidence, "context": context}, indent=1))
    print(evidence["status"], evidence["complete_rows"], "/", evidence["total_rows"], "rows;", len(evidence["edges"]), "cues;", len(evidence["unknown"]), "unknown pairs")
    print({k: v[:4] for k, v in evidence["explain"].items()})


if __name__ == "__main__":
    build()
