"""Grid audit against random fills of the same slots. Pure Python, deterministic.

The question it answers: if these exact slots (stage, start, length) were filled
with the same acts in random order, how often would the cued pairs clash as
little as they do here? A low share means the grid separates those pairs more
carefully than chance; a high share means the slot pattern alone explains it.
"""

import random
from .domain import Day


def _clashes(slot_of, pairs, threshold, buffer):
    n = 0
    for a, b in pairs:
        sa, ta, da = slot_of[a]
        sb, tb, db = slot_of[b]
        if sa != sb and min(ta + da, tb + db) - max(ta, tb) + buffer > threshold:
            n += 1
    return n


def random_fill(day: Day, placements, edges, samples=4000, seed=0):
    acts = {a.id: a for a in day.acts}
    pairs = [(e["a"], e["b"]) for e in edges if e["source"] in {"qloo", "genre", "listenbrainz"}]
    placements = [p for p in placements if not p.cut]
    ids = [p.act_id for p in placements]
    slots = [(p.stage_id, p.start, p.length or acts[p.act_id].duration) for p in placements]
    present = set(ids)
    pairs = [(a, b) for a, b in pairs if a in present and b in present]
    if not pairs:
        return {"pairs": 0, "observed": 0, "samples": 0, "share_at_or_below": None, "mean": None}
    observed = _clashes(dict(zip(ids, slots)), pairs, day.threshold, day.buffer)
    rng = random.Random(seed)
    worse = equal_or_better = total = 0
    hist = {}
    for _ in range(samples):
        rng.shuffle(slots)
        n = _clashes(dict(zip(ids, slots)), pairs, day.threshold, day.buffer)
        total += n
        hist[n] = hist.get(n, 0) + 1
        equal_or_better += n <= observed
        worse += n > observed
    return {
        "pairs": len(pairs),
        "observed": observed,
        "samples": samples,
        "mean": round(total / samples, 2),
        "share_at_or_below": round(equal_or_better / samples, 4),
        "histogram": [[k, hist[k]] for k in sorted(hist)],
        "scope": "Random reassignment of the same acts to the same slots; not a forecast of attendance",
    }
