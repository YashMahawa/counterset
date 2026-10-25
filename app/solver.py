"""Lexicographic CP-SAT repair. Models propose; this engine decides feasibility."""

import time
from ortools.sat.python import cp_model
from .domain import Day, Placement, canonical_pair
from .validator import audit


def solve(day: Day, edges: list[dict], budget: int = 4, seconds: float = 12):
    m = cp_model.CpModel()
    start = {}
    stage = {}
    moved = []
    displacement = []
    by_stage = {s.id: [] for s in day.stages}
    stage_ids = [s.id for s in day.stages]
    drafts = {p.act_id: p for p in day.draft}
    acts = {a.id: a for a in day.acts}
    assumption_labels = {}

    def assumption(label):
        b = m.new_bool_var(label)
        m.add_assumption(b)
        assumption_labels[b.index] = label
        return b

    for a in day.acts:
        t = m.new_int_var(0, 2880 // day.grid, f"t_{a.id}")
        start[a.id] = t * day.grid
        st = m.new_int_var(0, len(stage_ids) - 1, f"stage_{a.id}")
        stage[a.id] = st
        window = assumption(f"{a.name}: availability {a.earliest}–{a.latest}")
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
            m.add(start[a.id] + a.duration + a.changeover <= s.closes).only_enforce_if(
                chosen
            )
            interval = m.new_optional_fixed_size_interval_var(
                start[a.id],
                a.duration + a.changeover,
                chosen,
                f"interval_{a.id}_{s.id}",
            )
            by_stage[s.id].append(interval)
        m.add_exactly_one(choices)
        same_t = m.new_bool_var(f"same_time_{a.id}")
        same_s = m.new_bool_var(f"same_stage_{a.id}")
        m.add(start[a.id] == drafts[a.id].start).only_enforce_if(same_t)
        m.add(start[a.id] != drafts[a.id].start).only_enforce_if(same_t.Not())
        m.add(st == stage_ids.index(drafts[a.id].stage_id)).only_enforce_if(same_s)
        m.add(st != stage_ids.index(drafts[a.id].stage_id)).only_enforce_if(
            same_s.Not()
        )
        changed = m.new_bool_var(f"moved_{a.id}")
        m.add_bool_or([same_t.Not(), same_s.Not()]).only_enforce_if(changed)
        m.add_bool_and([same_t, same_s]).only_enforce_if(changed.Not())
        moved.append(changed)
        if a.locked:
            lock = assumption(f"{a.name}: locked at draft placement")
            m.add(changed == 0).only_enforce_if(lock)
        d = m.new_int_var(0, 2880, f"displacement_{a.id}")
        m.add_abs_equality(d, start[a.id] - drafts[a.id].start)
        displacement.append(d)
    for o in day.outages:
        lit = assumption(f"{o.stage_id}: hold {o.start}–{o.end}")
        by_stage[o.stage_id].append(
            m.new_optional_fixed_size_interval_var(
                o.start, o.end - o.start, lit, f"hold_{o.stage_id}_{o.start}"
            )
        )
    for intervals in by_stage.values():
        m.add_no_overlap(intervals)
    move_limit = assumption(f"At most {budget} changed acts")
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
        m.add_min_equality(
            lo, [start[a] + acts[a].duration, start[b] + acts[b].duration]
        )
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
        src = e["source"]
        weight = e.get("weight", 1)
        if src == "must_see":
            terms["must_see"].append(conflict * weight)
        elif src in {"qloo", "genre"} or (
            src == "unknown" and day.unknown_policy == "cautious"
        ):
            terms["cue"].append(conflict * weight)
            ov = m.new_int_var(0, 3180, f"counted_overlap_{n}")
            m.add(ov == overlap).only_enforce_if(conflict)
            m.add(ov == 0).only_enforce_if(conflict.Not())
            terms["overlap"].append(ov)
    objectives = [
        ("must_see", sum(terms["must_see"])),
        ("cue_conflicts", sum(terms["cue"])),
        ("moved_acts", sum(moved)),
        ("overlap_minutes", sum(terms["overlap"])),
        ("displacement", sum(displacement)),
    ]
    if day.repair_priority == "least_time_shift":
        objectives = [
            objectives[0],
            objectives[1],
            objectives[4],
            objectives[2],
            objectives[3],
        ]
    deadline = time.monotonic() + seconds
    passes = []
    placements = None
    all_optimal = True
    for name, expr in objectives:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            all_optimal = False
            break
        m.minimize(expr)
        s = cp_model.CpSolver()
        s.parameters.num_search_workers = 1
        s.parameters.random_seed = 17
        s.parameters.max_time_in_seconds = max(0.001, remaining)
        status = s.solve(m)
        label = s.status_name(status)
        if status == cp_model.INFEASIBLE:
            core = [
                assumption_labels.get(i, f"assumption {i}")
                for i in s.sufficient_assumptions_for_infeasibility()
            ]
            return {
                "status": "INFEASIBLE",
                "placements": [],
                "core": core,
                "core_scope": "Sufficient conflicting assumptions, not guaranteed smallest. Stage exclusivity/hours are fixed rules.",
                "passes": passes,
            }
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if placements is None:
                return {"status": label, "placements": [], "passes": passes}
            all_optimal = False
            break
        placements = [
            Placement(
                act_id=a.id,
                stage_id=stage_ids[s.value(stage[a.id])],
                start=s.value(start[a.id]),
            )
            for a in day.acts
        ]
        value = s.value(expr)
        passes.append(
            {
                "objective": name,
                "value": value,
                "bound": s.best_objective_bound,
                "status": label,
            }
        )
        if status != cp_model.OPTIMAL:
            all_optimal = False
            break
        m.add(expr == value)
    if placements is None:
        return {"status": "UNKNOWN", "placements": [], "passes": passes}
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
    scope = (
        "Fewest changed acts"
        if day.repair_priority == "fewest_acts"
        else "Least total start-time displacement"
    )
    return {
        "status": "OPTIMAL"
        if all_optimal and len(passes) == len(objectives)
        else "FEASIBLE",
        "placements": [p.model_dump() for p in placements],
        "audit": checked,
        "passes": passes,
        "minimum_change_scope": scope
        + " at the achieved higher-priority objectives within this move budget"
        if all_optimal
        else "Best feasible result; minimum change not proven",
        "seconds": round(seconds - max(0, deadline - time.monotonic()), 3),
    }
