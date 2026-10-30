"""Do the clashes the press complained about rank high on Qloo?

Written before any Qloo row for these bills was fetched. Claim under test: among every pair of
acts on a day's bill whose sets overlap by more than 10 minutes, pairs that SFist named as painful
sit in the stronger half by Qloo's mutual rank. Mutual rank is the worse of the two within-bill
ranks. A pair with an unresolved act is left out and reported. Six named pairs is a small sample:
this can show a tendency, not establish one. The result is reported whichever way it falls.
Source of named clashes: sfist.com/2026/07/30/outside-lands-set-times-revealed/ (retrieved 30 Oct 2026).
"""

import json
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.evidence import entities, params, ranks_of, score_row
from app.providers import Gateway

NAMED = {
    "fri": [("Charli xcx", "Modest Mouse"), ("Charli xcx", "Subtronics")],
    "sat": [("The Strokes", "The xx"), ("The Strokes", "PinkPantheress"), ("The xx", "PinkPantheress"), ("The Strokes", "Lane 8"), ("The xx", "Lane 8"), ("PinkPantheress", "Lane 8")],
    "sun": [("RÜFÜS DU SOL", "Death Cab for Cutie"), ("RÜFÜS DU SOL", "Baby Keem"), ("Death Cab for Cutie", "Baby Keem")],
}


def norm(s):
    return "".join(c for c in s.lower().replace("ü", "u").replace("ö", "o") if c.isalnum())


def minutes(t):
    h, m = map(int, t.split(":"))
    return h * 60 + m


def main():
    cfg = Config()
    gw = Gateway(cfg)
    root = Path(__file__).resolve().parents[1]
    rows = [l.strip().split("|") for l in (root / "scripts/sources/outside-lands-2026.txt").read_text().splitlines() if l.strip() and not l.startswith("#")]
    out = {"days": {}, "named_total": sum(len(v) for v in NAMED.values())}
    for day in ("fri", "sat", "sun"):
        bill = [r for r in rows if r[0] == day]
        ids = {}
        for _, _, name, _, _ in bill:
            payload, _ = gw.qloo("/search", {"query": name, "types": "urn:entity:artist", "take": 3})
            top = entities(payload)[:1]
            if top and norm(top[0].get("name", "")) == norm(name):
                ids[name] = top[0]["entity_id"]
        print(day, "resolved", len(ids), "of", len(bill), "unresolved", [r[2] for r in bill if r[2] not in ids], flush=True)
        universe = list(ids.values())
        ranks = {}
        for name, qid in ids.items():
            payload, _ = gw.qloo("/v2/insights", params(qid, "urn:entity:artist", universe))
            row = score_row(payload, qid, universe)
            by_id = {v: k for k, v in ids.items()}
            ranks[name] = {by_id[e]: r for e, r in ranks_of(row["scores"]).items() if row["complete"] and e in by_id}
        slots = {r[2]: (r[1], minutes(r[3]), minutes(r[4])) for r in bill}
        pairs = []
        for a, b in combinations(ids, 2):
            sa, sb = slots[a], slots[b]
            if sa[0] != sb[0] and min(sa[2], sb[2]) - max(sa[1], sb[1]) > 10 and b in ranks[a] and a in ranks[b]:
                pairs.append({"a": a, "b": b, "mutual": max(ranks[a][b], ranks[b][a])})
        pairs.sort(key=lambda p: p["mutual"])
        named = []
        for a, b in NAMED[day]:
            hit = next((i for i, p in enumerate(pairs) if {p["a"], p["b"]} == {a, b}), None)
            if hit is None:
                named.append({"pair": [a, b], "known": False})
            else:
                better = sum(p["mutual"] < pairs[hit]["mutual"] for p in pairs)
                named.append({"pair": [a, b], "known": True, "mutual": pairs[hit]["mutual"], "better_pairs": better, "of": len(pairs), "percentile": round(100 * (1 - better / len(pairs)))})
        out["days"][day] = {"bill": len(bill), "resolved": len(ids), "overlapping_pairs": len(pairs), "named": named, "strongest": pairs[:5]}
        print(json.dumps(out["days"][day])[:900], flush=True)
    known = [n for d in out["days"].values() for n in d["named"] if n["known"]]
    out["named_known"] = len(known)
    out["named_in_stronger_half"] = sum(n["percentile"] > 50 for n in known)
    print("RESULT", out["named_in_stronger_half"], "of", len(known), "named pairs in the stronger half", flush=True)
    (cfg.private / "press-clash-test.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
