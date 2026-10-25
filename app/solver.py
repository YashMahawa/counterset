"""Lexicographic CP-SAT repair. Models propose; this engine decides feasibility."""

import time
from ortools.sat.python import cp_model
from .domain import Day, Placement, canonical_pair
from .validator import audit


def clock(n):
    return f"{n // 60 % 24:02}:{n % 60:02}"


def build(day: Day, edges: list[dict], budget: int):
    """Hard rules are guarded by named literals so an infeasibility can be explained."""
    m = cp_model.CpModel()
    start, stage, moved, displacement = {}, {}, [], []
    by_stage = {s.id: [] for s in day.stages}
    stage_ids = [s.id for s in day.stages]
    names = {s.id: s.name for s in day.stages}
    drafts = {p.act_id: p for p in day.draft}
    acts = {a.id: a for a in day.acts}
    guards = {}

    def guard(label):
        b = m.new_bool_var(label)
        guards[label] = b
        return b

    for a in day.acts:
        t = m.new_int_var(0, 2880 // day.grid, f"t_{a.id}")
        start[a.id] = t * day.grid
        st = m.new_int_var(0, len(stage_ids) - 1, f"stage_{a.id}")
        stage[a.id] = st
        window = guard(f"{a.name}: available {clock(a.earliest)}–{clock(a.latest)}")
        m.add(start[a.id] >= a.earliest).only_enforce_if(window)
        m.add(start[a.id] + a.duration <= a.latest).only_enforce_if(window)
        choices = []
        for i, s in enumerate(day.stages):
            chosen = m.new_bool_var(f"{a.id}_{s.id}")
            choices.append(chosen)
            m.add(st == i).only_enforce_if(chosen)
            m.add(st != i).only_enforce_if(chosen.Not())
            if s.id not in a.allowed_stages:
                m.add(chosen == 0)
            m.add(start[a.id] >= s.opens).only_enforce_if(chosen)
            # Curfew binds the set itself; changeover only separates consecutive sets.
            m.add(start[a.id] + a.duration <= s.closes).only_enforce_if(chosen)
            by_stage[s.id].append(
                m.new_optional_fixed_size_interval_var(
                    start[a.id], a.duration + a.changeover, chosen, f"interval_{a.id}_{s.id}"
                )
            )
        m.add_exactly_one(choices)
        same_t = m.new_bool_var(f"same_time_{a.id}")
        same_s = m.new_bool_var(f"same_stage_{a.id}")
        m.add(start[a.id] == drafts[a.id].start).only_enforce_if(same_t)
        m.add(start[a.id] != drafts[a.id].start).only_enforce_if(same_t.Not())
        m.add(st == stage_ids.index(drafts[a.id].stage_id)).only_enforce_if(same_s)
        m.add(st != stage_ids.index(drafts[a.id].stage_id)).only_enforce_if(same_s.Not())
        changed = m.new_bool_var(f"moved_{a.id}")
        m.add_bool_or([same_t.Not(), same_s.Not()]).only_enforce_if(changed)
        m.add_bool_and([same_t, same_s]).only_enforce_if(changed.Not())
        moved.append(changed)
        if a.locked:
            lock = guard(f"{a.name}: locked at {names[drafts[a.id].stage_id]} {clock(drafts[a.id].start)}")
            m.add(changed == 0).only_enforce_if(lock)
        d = m.new_int_var(0, 2880, f"displacement_{a.id}")
        m.add_abs_equality(d, start[a.id] - drafts[a.id].start)
        displacement.append(d)
    for o in day.outages:
        lit = guard(f"{names[o.stage_id]} hold {clock(o.start)}–{clock(o.end)}")
        by_stage[o.stage_id].append(
            m.new_optional_fixed_size_interval_var(o.start, o.end - o.start, lit, f"hold_{o.stage_id}_{o.start}")
        )
    for intervals in by_stage.values():
        m.add_no_overlap(intervals)
    move_limit = guard(f"At most {budget} changed acts")
    m.add(sum(moved) <= budget).only_enforce_if(move_limit)

    ignored = {canonical_pair(p.a, p.b) for p in day.intentional}
    terms = {"must_see": [], "cue": [], "overlap": []}
    for n, e in enumerate(edges):
        a, b = e["a"], e["b"]
        if canonical_pair(a, b) in ignored:
            continue
        lo = m.new_int_var(0, 3120, f"lo_{n}")
        hi = m.new_int_var(0, 2880, f"hi_{n}")
        overlap = m.new_int_var(0, 3180, f"overlap_{n}")
        m.add_min_equality(lo, [start[a] + acts[a].duration, start[b] + acts[b].duration])
        m.add_max_equality(hi, [start[a], start[b]])
        m.add_max_equality(overlap, [0, lo - hi + day.buffer])
        hit = m.new_bool_var(f"hit_{n}")
        diff = m.new_bool_var(f"diff_{n}")
        conflict = m.new_bool_var(f"conflict_{n}")
        m.add(overlap > day.threshold).only_enforce_if(hit)
        m.add(overlap <= day.threshold).only_enforce_if(hit.Not())
        m.add(stage[a] != stage[b]).only_enforce_if(diff)
        m.add(stage[a] == stage[b]).only_enforce_if(diff.Not())
        m.add_bool_and([hit, diff]).only_enforce_if(conflict)
        m.add_bool_or([hit.Not(), diff.Not()]).only_enforce_if(conflict.Not())
        src, weight = e["source"], e.get("weight", 1)
        if src == "must_see":
            terms["must_see"].append(conflict * weight)
        elif src in {"qloo", "genre"} or (src == "unknown" and day.unknown_policy == "cautious"):
            terms["cue"].append(conflict * weight)
            ov = m.new_int_var(0, 3180, f"counted_overlap_{n}")
            m.add(ov == overlap).only_enforce_if(conflict)
            m.add(ov == 0).only_enforce_if(conflict.Not())
            terms["overlap"].append(ov)
    objectives = {
        "must_see": sum(terms["must_see"]),
        "cue_conflicts": sum(terms["cue"]),
        "moved_acts": sum(moved),
        "overlap_minutes": sum(terms["overlap"]),
        "displacement": sum(displacement),
    }
    return m, start, stage, stage_ids, guards, objectives


def _solver(seconds):
    s = cp_model.CpSolver()
    s.parameters.num_search_workers = 1
    s.parameters.random_seed = 17
    s.parameters.max_time_in_seconds = max(0.001, seconds)
    return s


def minimal_core(day, budget, labels, seconds=10):
    """Deletion filter: drop each rule that is not needed for the contradiction.

    The result is irreducible when every check was decided: removing any one of
    the returned rules makes the remaining rules satisfiable.
    """
    deadline = time.monotonic() + seconds
    keep = list(labels)
    decided = True
    for label in list(labels):
        if time.monotonic() > deadline:
            decided = False
            break
        trial = [x for x in keep if x != label]
        m, *_, guards, _ = build(day, [], budget)
        for name, lit in guards.items():
            if name in trial:
                m.add(lit == 1)
        status = _solver(min(1.5, max(0.05, deadline - time.monotonic()))).solve(m)
        if status == cp_model.INFEASIBLE:
            keep = trial
        elif status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            decided = False
    return keep, decided


def solve(day: Day, edges: list[dict], budget: int = 4, seconds: float = 12, priority=None):
    priority = priority or day.repair_priority
    m, start, stage, stage_ids, guards, obj = build(day, edges, budget)
    for lit in guards.values():
        m.add_assumption(lit)
    by_index = {lit.index: name for name, lit in guards.items()}
    order = ["must_see", "cue_conflicts", "moved_acts", "overlap_minutes", "displacement"]
    if priority == "least_time_shift":
        order = ["must_see", "cue_conflicts", "displacement", "moved_acts", "overlap_minutes"]
    deadline = time.monotonic() + seconds
    passes, placements, all_optimal = [], None, True
    for name in order:
        expr = obj[name]
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            all_optimal = False
            break
        m.minimize(expr)
        s = _solver(remaining)
        status = s.solve(m)
        label = s.status_name(status)
        if status == cp_model.INFEASIBLE:
            core = [by_index.get(i, f"rule {i}") for i in s.sufficient_assumptions_for_infeasibility()]
            core, decided = minimal_core(day, budget, core, seconds=max(4.0, seconds))
            return {
                "status": "INFEASIBLE",
                "placements": [],
                "core": core,
                "core_scope": (
                    "These rules cannot all hold together. Removing any one of them makes the rest satisfiable."
                    if decided
                    else "These rules cannot all hold together. Some checks timed out, so the list may include a rule that is not needed."
                )
                + " Stage exclusivity and stage hours are fixed and not listed.",
                "passes": passes,
                "priority": priority,
            }
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if placements is None:
                return {
                    "status": label,
                    "placements": [],
                    "passes": passes,
                    "priority": priority,
                    "core": [],
                    "core_scope": "No schedule was found within the time limit. This is not a proof that none exists.",
                }
            all_optimal = False
            break
        placements = [
            Placement(act_id=a.id, stage_id=stage_ids[s.value(stage[a.id])], start=s.value(start[a.id]))
            for a in day.acts
        ]
        value = s.value(expr)
        passes.append({"objective": name, "value": value, "bound": s.best_objective_bound, "status": label})
        if status != cp_model.OPTIMAL:
            all_optimal = False
            break
        m.add(expr == value)
    if placements is None:
        return {"status": "UNKNOWN", "placements": [], "passes": passes, "priority": priority, "core": [], "core_scope": "No schedule within the time limit; not a proof of infeasibility."}
    checked = audit(day, placements, edges, budget)
    if not checked["passed"]:
        raise RuntimeError("Independent schedule validation failed")
    expected = {
        "must_see": checked["counts"]["must_see"],
        "cue_conflicts": checked["counts"]["qloo"]
        + checked["counts"]["genre"]
        + (checked["counts"]["unknown"] if day.unknown_policy == "cautious" else 0),
        "moved_acts": checked["moves"],
        "overlap_minutes": checked["cue_overlap_minutes"],
        "displacement": checked["displacement"],
    }
    if any(p["value"] != expected[p["objective"]] for p in passes):
        raise RuntimeError("Independent objective recount disagrees with solver")
    scope = "Fewest changed acts" if priority == "fewest_acts" else "Least total start-time displacement"
    return {
        "status": "OPTIMAL" if all_optimal and len(passes) == len(order) else "FEASIBLE",
        "placements": [p.model_dump() for p in placements],
        "audit": checked,
        "passes": passes,
        "priority": priority,
        "minimum_change_scope": scope + " at the achieved higher-priority objectives within this move budget"
        if all_optimal
        else "Best feasible result; minimum change not proven",
        "seconds": round(seconds - max(0, deadline - time.monotonic()), 3),
    }
