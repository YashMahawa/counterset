"""Before, without Qloo and with Qloo for one saved run, in the words the public page shows.

Every number is read from the saved run or rechecked by the validator. Nothing here calls a model or Qloo.
"""

from __future__ import annotations
from .domain import Day, Placement
from .evidence import all_edges
from .validator import audit

# Words Qloo returns for nearly every pair, so they explain nothing.
VAGUE = {"Diverse", "Varied", "Moderate", "Simple", "Engaging", "Energetic", "Loyal", "Love", "Expressive", "Passionate", "Modernism", "Rhythmic", "Melodic", "Catchy", "Vocals", "Guitar", "Drums", "Bass Guitar", "Keyboard", "Piano", "Marches", "Work Songs", "Spirituals", "Ragtime", "Futurism", "Folk", "Blues", "Singer & Songwriter"}


def pair_key(a, b):
    return "|".join(sorted((a, b)))


def reason(evidence, a, b):
    """Why two acts count as sharing a crowd: the rank each gave the other, and the tastes they share."""
    parts = []
    edge = next((e for e in evidence.get("edges", []) if pair_key(e["a"], e["b"]) == pair_key(a, b)), None)
    if edge:
        best = edge["ranks"][0] == 1 and edge["ranks"][1] == 1
        parts.append("each other's closest match on this bill" if best else f"each ranks the other in its top {max(edge['ranks'])} of {edge['of'][0]} on this bill")
    words = [t for t in evidence.get("explain", {}).get(pair_key(a, b), []) if t not in VAGUE][:3]
    if words:
        parts.append("both crowds lean " + ", ".join(words))
    return " · ".join(parts)


def state(day, evidence, places, checked, names, draws):
    clashes = sorted((c for c in checked["conflicts"] if c["source"] in ("qloo", "must_see")), key=lambda c: -c["minutes"])
    return {
        "placements": [{"act_id": p["act_id"], "stage_id": p["stage_id"], "start": p["start"], "length": p.get("length"), "cut": bool(p.get("cut"))} for p in places],
        "clashes": [{"a": c["a"], "b": c["b"], "names": [names[c["a"]], names[c["b"]]], "minutes": c["minutes"], "why": reason(evidence, c["a"], c["b"])} for c in clashes],
        "moved": checked.get("moves", 0),
        "shortened": checked.get("trim_minutes", 0),
        "dropped": [{"name": names[i], "draw": draws.get(i)} for i in checked.get("cuts", [])],
    }


def blocked(day, places):
    """Sets the problem itself rules out: an act that can no longer make its slot, or a slot that is closed."""
    out = []
    acts = {a.id: a for a in day.acts}
    for p in places:
        a = acts[p["act_id"]]
        length = p.get("length") or a.duration
        late = (a.earliest is not None and p["start"] < a.earliest) or (a.latest is not None and p["start"] > a.latest)
        closed = any(o.stage_id == p["stage_id"] and o.start < p["start"] + length and p["start"] < o.end for o in day.outages)
        if late or closed:
            out.append(a.id)
    return out


def day_block(example_id, ex, title):
    recorded = ex["context"]["recorded_run"]
    saved = recorded["saved"]["proposal"]
    option = saved["options"][0]
    blind = option["without_qloo"]
    evidence = ex["evidence"]
    original = Day.model_validate(ex["day"])
    problem = Day.model_validate(saved["day"])
    draft = [p.model_dump() for p in original.draft]
    names = {a.id: a.name for a in problem.acts}
    draws = {a.id: round(a.draw * 100) for a in problem.acts if a.draw is not None}
    before = audit(original, original.draft, all_edges(original, evidence))
    both = [*draft, *option["placements"], *(blind["placements"] or [])]
    lengths = {a.id: a.duration for a in problem.acts}
    return {
        "id": example_id,
        "title": title,
        "message": recorded["message"],
        "stages": [{"id": s.id, "name": s.name} for s in problem.stages],
        "acts": [{"id": a.id, "name": a.name, "duration": a.duration} for a in problem.acts],
        "from": min(p["start"] for p in both),
        "to": max(p["start"] + (p.get("length") or lengths[p["act_id"]]) for p in both),
        "closed": [{"stage_id": o.stage_id, "start": o.start, "end": o.end} for o in problem.outages],
        "blocked": blocked(problem, draft),
        "before": state(original, evidence, draft, before, names, draws),
        "without": state(problem, evidence, blind["placements"], blind["audit"], names, draws),
        "with": state(problem, evidence, option["placements"], option["audit"], names, draws),
    }


def build(examples):
    """The saved days, Lollapalooza first: there the fix without Qloo itself lands an act on her closest match."""
    days = []
    for t in examples.templates():
        ex = examples.get(t["id"])
        if (ex["context"].get("recorded_run") or {}).get("saved"):
            days.append(day_block(t["id"], ex, t["title"]))
    days.sort(key=lambda d: not d["id"].startswith("lollapalooza"))
    return {"days": days}
