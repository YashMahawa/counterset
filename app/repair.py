"""Repair options and the counterfactual that shows what Qloo evidence changed."""

import math
from .domain import Day, Outage, Placement
from .evidence import all_edges, attendee_edges
from .solver import solve
from .stats import random_fill
from .validator import audit

PRIORITIES = ["fewest_acts", "least_time_shift"]


def apply_scenario(day: Day, scenario: dict | None) -> Day:
    """Rescue terms a person chose for one repair. The saved day is not changed until approval.

    curfew: when the last set must end. shortest: the smallest share of a set an act
    is asked to accept, as a whole number percent. allow_cut: sets may be dropped.
    """
    if not scenario:
        return day
    data = day.model_dump()
    curfew = scenario.get("curfew")
    if curfew:
        if curfew <= max(s["opens"] for s in data["stages"]):
            raise ValueError("That finish time is before the stages open.")
        # The last set really ends by this time, whether it is later or earlier than the stages' hours.
        for s in data["stages"]:
            s["closes"] = curfew
        for a in data["acts"]:
            a["latest"] = max(a["latest"], curfew)
    shortest = scenario.get("shortest")
    if shortest and shortest < 100:
        data["allow_trim"] = True
        for a in data["acts"]:
            if a["locked"] or a["headliner"]:
                continue
            floor = math.ceil(a["duration"] * shortest / 100 / day.grid) * day.grid
            a["min_duration"] = min(a["duration"], max(floor, day.grid))
    data["allow_cut"] = bool(scenario.get("allow_cut"))
    return Day.model_validate(data)


def hold_stage(day: Day, stage_id: str, start: int, end: int, reason: str) -> Day:
    """Close one stage. Sets that began before the hold cannot move, unless the day says otherwise."""
    data = day.model_dump()
    data["outages"].append(Outage(stage_id=stage_id, start=start, end=end, reason=reason).model_dump())
    if day.auto_lock_started:
        placed = {p.act_id: p for p in day.draft}
        for a in data["acts"]:
            p = placed[a["id"]]
            if p.start < start:
                a["locked"] = True
                # A set that finishes before the closure has no changeover left to fit into it.
                end = p.start + (p.length or a["duration"])
                if p.stage_id == stage_id and end <= start:
                    a["changeover"] = min(a["changeover"], start - end)
    return Day.model_validate(data)


def site_hold(day: Day, start: int, end: int, reason: str) -> Day:
    """Close every stage for one window: the whole site is evacuated."""
    for s in day.stages:
        day = hold_stage(day, s.id, start, end, reason)
    # The decision is made as the site closes, so nothing still to play can use the time before it.
    data = day.model_dump()
    for a in data["acts"]:
        if not a["locked"]:
            a["earliest"] = max(a["earliest"], end)
    return Day.model_validate(data)


def placements(result):
    return [Placement.model_validate(p) for p in result.get("placements", [])]


def counterfactual(day: Day, edges, option, budget, seconds):
    """Same facts, budget and preference, with every Qloo signal removed: cues and draw."""
    data = day.model_dump()
    for a in data["acts"]:
        a["draw"] = None
    blind = solve(Day.model_validate(data), attendee_edges(edges), budget, seconds, option["priority"])
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
        "dropped": checked["cuts"],
    }


def as_run_audit(day: Day, evidence, as_run):
    """Score what a festival really did on the same terms as any repair."""
    return audit(day, [Placement.model_validate(p) for p in as_run], all_edges(day, evidence))


def plan(day: Day, evidence, budget, seconds, progress=lambda *_: None, scenario=None):
    day = apply_scenario(day, scenario)
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
