"""Independent evidence lenses for the real example days, built from open data.

MusicBrainz genres (supplementary data, CC BY-NC-SA, kept private) and ListenBrainz
similar artists (CC0). Each lens uses the same reciprocal rule as Qloo: both acts in
each other's top-k within the bill, capped at a quarter of the ranked acts. Only acts
matched in the lens by exact name (case-insensitive) are ranked. Writes lens edges into
the private example files and prints a per-day comparison with random-fill audits."""

import json
import math
import sys
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config
from app.domain import Day
from app.evidence import cap
from app.stats import random_fill

WRONG = {"Romy"}  # MusicBrainz top hit is a different person (author Romy Fölck)


def norm(s):
    return "".join(c for c in s.lower() if c.isalnum())


def reciprocal(ids, score, k):
    ranks = {}
    for a in ids:
        others = {b: score(a, b) for b in ids if b != a and score(a, b) is not None and score(a, b) > 0}
        ranks[a] = {b: 1 + sum(o > s for o in others.values()) for b, s in others.items()}
    edges = []
    for a, b in combinations(ids, 2):
        ra, rb = ranks[a].get(b), ranks[b].get(a)
        if ra and rb and ra <= cap(k, len(ranks[a])) and rb <= cap(k, len(ranks[b])):
            edges.append({"a": a, "b": b, "source": "qloo", "weight": 1, "ranks": [ra, rb]})
    return edges


def lenses(day, open_rows):
    by_name = {norm(r["name"]): r for r in open_rows}
    matched = {}
    for a in day.acts:
        r = by_name.get(norm(a.name))
        if r and r["candidates"] and norm(r["candidates"][0]["name"]) == norm(a.name) and a.name not in WRONG:
            matched[a.id] = r
    mbid = {aid: r["candidates"][0]["mbid"] for aid, r in matched.items()}
    genres = {aid: {g["name"]: max(1, g["count"]) for g in r["genres"]} for aid, r in matched.items()}

    def jaccard(a, b):
        ga, gb = genres[a], genres[b]
        if not ga or not gb:
            return None
        keys = set(ga) | set(gb)
        return sum(min(ga.get(x, 0), gb.get(x, 0)) for x in keys) / sum(max(ga.get(x, 0), gb.get(x, 0)) for x in keys)

    lb = {aid: {s["mbid"]: s["score"] for s in r["similar"]} for aid, r in matched.items()}

    def listen(a, b):
        return lb[a].get(mbid[b])

    genre_ids = [a for a in matched if genres[a]]
    lb_ids = [a for a in matched if lb[a]]
    return {
        "musicbrainz_genre": {"label": "MusicBrainz genres", "edges": reciprocal(genre_ids, jaccard, day.k), "ranked": len(genre_ids), "ids": genre_ids},
        "listenbrainz": {"label": "ListenBrainz co-listening", "edges": reciprocal(lb_ids, listen, day.k), "ranked": len(lb_ids), "ids": lb_ids},
    }


def report(name, day, evidence, lens):
    qloo_ids = {a.id for a in day.acts if a.qloo_id}
    print(f"\n== {name}: Qloo ranked {len(qloo_ids)} acts, {len(evidence['edges'])} cues")
    common = qloo_ids & {x for l in lens.values() for e in l["edges"] for x in (e["a"], e["b"])}
    sets = {"Qloo": evidence["edges"], **{v["label"]: v["edges"] for v in lens.values()}}
    for label, edges in sets.items():
        f = random_fill(day, day.draft, edges, samples=20000, seed=17)
        print(f"{label:28} edges={len(edges):3}  published-grid clashes={f['observed']}  random mean={f['mean']}  share<=observed={f['share_at_or_below']}")
    keys = {k: {tuple(sorted((e['a'], e['b']))) for e in v} for k, v in sets.items()}
    q = keys["Qloo"]
    for k, v in keys.items():
        if k != "Qloo":
            print(f"overlap Qloo∩{k}: {len(q & v)} of {len(q)} Qloo / {len(v)} {k}")


def main():
    cfg = Config()
    jobs = [("lollapalooza-2024-saturday", cfg.private / "lolla/open_lenses.json"), ("pitchfork-2024-friday", cfg.private / "pitchfork-open-lenses.json")]
    for ex, src in jobs:
        f = cfg.private / "examples" / f"{ex}.json"
        data = json.loads(f.read_text())
        day = Day.model_validate(data["day"])
        lens = lenses(day, json.loads(src.read_text()))
        data["context"]["lenses"] = lens
        f.write_text(json.dumps(data, indent=1))
        report(ex, day, data["evidence"], lens)


if __name__ == "__main__":
    main()
