"""Independent of OR-Tools: never trusts a solver or language model's counts."""

from itertools import combinations
from .domain import Day, Placement, canonical_pair


def draw_of(a):
    """Whole-number weight for a dropped set. An act Qloo cannot rate counts as middling, not as nothing."""
    return round((0.5 if a.draw is None else a.draw) * 1000)


def played(p, a):
    """Minutes actually on stage: a shortened set counts its real length."""
    return p.length if p.length is not None else a.duration


def overlaps(day, pa, pb, acts):
    if pa.stage_id == pb.stage_id or pa.cut or pb.cut:
        return 0
    return max(
        0,
        min(pa.start + played(pa, acts[pa.act_id]), pb.start + played(pb, acts[pb.act_id]))
        - max(pa.start, pb.start)
        + day.buffer,
    )


def audit(day: Day, placements: list[Placement], edges: list[dict], budget=None):
    acts = {a.id: a for a in day.acts}
    stages = {s.id: s for s in day.stages}
    draft = {p.act_id: p for p in day.draft}
    ps = {p.act_id: p for p in placements}
    errors = []
    if len(placements) != len(acts) or set(ps) != set(acts):
        errors.append("Every act must appear exactly once")
    if len(ps) != len(placements):
        errors.append("Duplicate act placement")
    moved = []
    invalid = set()
    displacement = 0
    cuts = []
    cut_draw = 0
    trimmed = []
    trim_minutes = 0
    for p in placements:
        a = acts.get(p.act_id)
        s = stages.get(p.stage_id)
        if a is None or s is None:
            errors.append("Unknown act or stage")
            continue
        if p.cut:
            cuts.append(a.id)
            cut_draw += draw_of(a)
            if not (day.allow_cut or draft[a.id].cut):
                errors.append(f"{a.name}: dropping a set is not allowed on this day")
                invalid.add(a.id)
            if a.locked or a.headliner:
                errors.append(f"{a.name}: this set cannot be dropped")
                invalid.add(a.id)
            continue
        if draft[a.id].cut:
            errors.append(f"{a.name}: a dropped set cannot come back in a repair")
            invalid.add(a.id)
        length = played(p, a)
        if length != a.duration:
            trimmed.append(a.id)
            trim_minutes += a.duration - length
            if not day.allow_trim or a.locked or a.headliner:
                errors.append(f"{a.name}: this set cannot be shortened")
                invalid.add(a.id)
            elif a.min_duration is None or not a.min_duration <= length < a.duration:
                errors.append(f"{a.name}: set length outside what the act accepts")
                invalid.add(a.id)
            elif length % day.grid:
                errors.append(f"{a.name}: set length off time grid")
                invalid.add(a.id)
        end = p.start + length
        if p.stage_id not in a.allowed_stages:
            errors.append(f"{a.name}: stage incompatible")
            invalid.add(a.id)
        if p.start % day.grid:
            errors.append(f"{a.name}: off time grid")
            invalid.add(a.id)
        if p.start < a.earliest or end > a.latest:
            errors.append(f"{a.name}: outside availability")
            invalid.add(a.id)
        if p.start < s.opens or end > s.closes:
            errors.append(f"{a.name}: outside stage hours")
            invalid.add(a.id)
        changed = (p.stage_id, p.start) != (draft[a.id].stage_id, draft[a.id].start)
        if changed:
            moved.append(a.id)
            displacement += abs(p.start - draft[a.id].start)
        if a.locked and changed:
            errors.append(f"{a.name}: locked placement changed")
            invalid.add(a.id)
        for o in day.outages:
            if (
                o.stage_id == p.stage_id
                and p.start < o.end
                and end + a.changeover > o.start
            ):
                errors.append(f"{a.name}: stage on hold")
                invalid.add(a.id)
    for pa, pb in combinations(placements, 2):
        if pa.act_id not in acts or pb.act_id not in acts or pa.cut or pb.cut:
            continue
        if pa.stage_id == pb.stage_id:
            aa, ab = acts[pa.act_id], acts[pb.act_id]
            if (
                pa.start < pb.start + played(pb, ab) + ab.changeover
                and pb.start < pa.start + played(pa, aa) + aa.changeover
            ):
                errors.append(f"{aa.name} / {ab.name}: stage overlap or changeover")
                invalid.update({aa.id, ab.id})
    if budget is not None and len(moved) > budget:
        errors.append("Move budget exceeded")
    ignored = {canonical_pair(p.a, p.b) for p in day.intentional}
    conflicts = []
    totals = {"must_see": 0, "qloo": 0, "unknown": 0, "genre": 0, "listenbrainz": 0}
    minutes = 0
    for e in edges:
        if (
            e["a"] not in ps
            or e["b"] not in ps
            or canonical_pair(e["a"], e["b"]) in ignored
        ):
            continue
        overlap = overlaps(day, ps[e["a"]], ps[e["b"]], acts)
        if overlap > day.threshold:
            conflicts.append({**e, "minutes": overlap})
            totals[e["source"]] += e.get("weight", 1)
            if e["source"] in {"qloo", "genre"} or (
                e["source"] == "unknown" and day.unknown_policy == "cautious"
            ):
                minutes += overlap
    return {
        "passed": not errors,
        "errors": errors,
        "invalid": sorted(invalid),
        "counts": totals,
        "conflicts": conflicts,
        "moved": moved,
        "moves": len(moved),
        "displacement": displacement,
        "cue_overlap_minutes": minutes,
        "cuts": cuts,
        "cut_draw": cut_draw,
        "trimmed": trimmed,
        "trim_minutes": trim_minutes,
    }
