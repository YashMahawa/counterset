"""Repair options and the counterfactual that shows what Qloo evidence changed."""

from .domain import Day, Placement
from .evidence import all_edges, attendee_edges
from .solver import solve
from .stats import random_fill
from .validator import audit

PRIORITIES = ["fewest_acts", "least_time_shift"]


def placements(result):
    return [Placement.model_validate(p) for p in result.get("placements", [])]


def counterfactual(day: Day, edges, option, budget, seconds):
    """Same facts, budget and preference, with every Qloo cue removed."""
    blind = solve(day, attendee_edges(edges), budget, seconds, option["priority"])
    if not blind.get("placements"):
        return {"status": blind["status"], "protected": []}
    checked = audit(day, placements(blind), edges, budget)
    kept = {(c["a"], c["b"]) for c in option["audit"]["conflicts"]}
    protected = [
        {"a": c["a"], "b": c["b"], "minutes": c["minutes"], "ranks": c.get("ranks"), "of": c.get("of")}
        for c in checked["conflicts"]
        if c["source"] == "qloo" and (c["a"], c["b"]) not in kept
    ]
    return {
        "status": blind["status"],
        "placements": blind["placements"],
        "audit": checked,
        "protected": protected,
        "identical": blind["placements"] == option["placements"],
    }


def plan(day: Day, evidence, budget, seconds, progress=lambda *_: None):
    edges = all_edges(day, evidence)
    options = []
    steps = len(PRIORITIES) * 2
    for i, priority in enumerate(PRIORITIES):
        progress(2 * i, steps, f"Solving: {priority.replace('_', ' ')}")
        result = solve(day, edges, budget, seconds, priority)
        if result.get("placements"):
            progress(2 * i + 1, steps, "Same repair without Qloo evidence")
            result["without_qloo"] = counterfactual(day, edges, result, budget, seconds)
            result["random_fill"] = random_fill(
                day, placements(result), evidence.get("edges", []), seed=17
            )
        options.append(result)
        if result["status"] == "INFEASIBLE":
            break
    for i, o in enumerate(options[1:], 1):
        if o.get("placements") and o["placements"] == options[0].get("placements"):
            o["same_as"] = 0
    feasible = [o for o in options if o.get("placements")]
    return {
        "status": feasible[0]["status"] if feasible else options[0]["status"],
        "options": options,
        "core": options[0].get("core", []),
        "core_scope": options[0].get("core_scope"),
    }
