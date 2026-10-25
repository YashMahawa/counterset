import copy
from itertools import permutations
from app.domain import Day, Placement
from app.evidence import score_row, graph
from app.solver import solve
from app.validator import audit


def test_coverage_rejects_missing_duplicate_self_and_nan():
    def payload(values):
        return {
            "results": {
                "entities": [
                    {"entity_id": k, "query": {"affinity": v}} for k, v in values
                ]
            }
        }

    assert score_row(payload([("b", 0.5), ("c", 0.3)]), "a", ["a", "b", "c"])[
        "complete"
    ]
    for values in [
        [("b", 0.5)],
        [("b", 0.5), ("b", 0.3)],
        [("a", 0.5), ("b", 0.3)],
        [("b", float("nan")), ("c", 0.3)],
    ]:
        assert not score_row(payload(values), "a", ["a", "b", "c"])["complete"]


def tiny():
    return Day.model_validate(
        {
            "name": "Tiny",
            "grid": 60,
            "stages": [
                {"id": "a", "name": "A", "opens": 960, "closes": 1080},
                {"id": "b", "name": "B", "opens": 960, "closes": 1080},
            ],
            "acts": [
                {
                    "id": str(i),
                    "name": str(i),
                    "duration": 50,
                    "changeover": 10,
                    "allowed_stages": ["a", "b"],
                    "earliest": 960,
                    "latest": 1080,
                }
                for i in range(4)
            ],
            "draft": [
                {
                    "act_id": str(i),
                    "stage_id": ["a", "b"][i % 2],
                    "start": 960 + 60 * (i // 2),
                }
                for i in range(4)
            ],
        }
    )


def test_solver_matches_bruteforce_lexicographic_optimum():
    day = tiny()
    edges = [{"a": "0", "b": "1", "source": "qloo", "weight": 1}]
    scores = []
    for slots in permutations([(s, t) for s in ["a", "b"] for t in [960, 1020]]):
        ps = [
            Placement(act_id=str(i), stage_id=s, start=t)
            for i, (s, t) in enumerate(slots)
        ]
        a = audit(day, ps, edges, 4)
        if a["passed"]:
            scores.append(
                (
                    a["counts"]["qloo"],
                    a["moves"],
                    a["cue_overlap_minutes"],
                    a["displacement"],
                )
            )
    result = solve(day, edges, 4, 5)
    a = result["audit"]
    assert result["status"] == "OPTIMAL"
    assert (
        a["counts"]["qloo"],
        a["moves"],
        a["cue_overlap_minutes"],
        a["displacement"],
    ) == min(scores)


def test_must_see_has_priority_over_qloo_and_locks_preserved():
    day = tiny()
    day.acts[0].locked = True
    edges = [
        {"a": "0", "b": "1", "source": "must_see", "weight": 10},
        {"a": "0", "b": "2", "source": "qloo", "weight": 1},
    ]
    r = solve(day, edges, 4, 5)
    assert r["audit"]["counts"]["must_see"] == 0
    assert (
        next(p for p in r["placements"] if p["act_id"] == "0")
        == day.draft[0].model_dump()
    )


def test_zero_budget_preserves_grid_and_impossible_window_reports_infeasible():
    day = tiny()
    r = solve(day, [], 0, 5)
    assert r["audit"]["moves"] == 0
    day.acts[0].latest = 980
    r = solve(day, [], 4, 5)
    assert r["status"] == "INFEASIBLE" and r["core"]


def test_validator_catches_model_style_errors():
    day = tiny()
    ps = copy.deepcopy(day.draft)
    ps[1].stage_id = "a"
    assert not audit(day, ps, [])["passed"]
    assert not audit(day, ps[:-1], [])["passed"]


def test_stage_hold_and_minute_buffer_match_validator():
    day = tiny()
    day.buffer = 5
    edges = [{"a": "0", "b": "1", "source": "qloo", "weight": 1}]
    r = solve(day, edges, 4, 5)
    assert (
        r["audit"]["counts"]
        == audit(day, [Placement.model_validate(p) for p in r["placements"]], edges)[
            "counts"
        ]
    )


def test_rank_ties_are_included_and_incomplete_rows_unknown():
    day = tiny()
    for a in day.acts:
        a.qloo_id = a.id
    day.k = 1
    rows = {
        a.id: {
            "complete": True,
            "scores": {b.id: 1 for b in day.acts if b.id != a.id},
            "errors": [],
        }
        for a in day.acts
    }
    e = graph(day, rows, "test")
    assert len(e["edges"]) == 6
    rows["0"]["complete"] = False
    e = graph(day, rows, "test")
    assert len(e["unknown"]) == 3
    assert not graph(day, rows, "test", {"passed": False})["edges"]


def test_unknown_cautious_policy_is_recounted_independently():
    day = tiny()
    day.unknown_policy = "cautious"
    edges = [{"a": "0", "b": "1", "source": "unknown", "weight": 1}]
    r = solve(day, edges, 0, 5)
    assert r["audit"]["counts"]["unknown"] == 1
    assert (
        next(p for p in r["passes"] if p["objective"] == "cue_conflicts")["value"] == 1
    )
    assert r["audit"]["cue_overlap_minutes"] == 50


def test_intentional_pair_is_excluded_from_solver_and_validator():
    day = tiny()
    from app.domain import Pair

    day.intentional = [Pair(a="0", b="1")]
    r = solve(day, [{"a": "0", "b": "1", "source": "qloo", "weight": 1}], 0, 5)
    assert r["audit"]["counts"]["qloo"] == 0


def test_alternative_priority_matches_bruteforce_displacement_first():
    day = tiny()
    day.repair_priority = "least_time_shift"
    edges = [{"a": "0", "b": "1", "source": "qloo", "weight": 1}]
    scores = []
    for slots in permutations([(s, t) for s in ["a", "b"] for t in [960, 1020]]):
        a = audit(
            day,
            [
                Placement(act_id=str(i), stage_id=s, start=t)
                for i, (s, t) in enumerate(slots)
            ],
            edges,
            4,
        )
        if a["passed"]:
            scores.append(
                (
                    a["counts"]["qloo"],
                    a["displacement"],
                    a["moves"],
                    a["cue_overlap_minutes"],
                )
            )
    r = solve(day, edges, 4, 5)
    a = r["audit"]
    assert (
        a["counts"]["qloo"],
        a["displacement"],
        a["moves"],
        a["cue_overlap_minutes"],
    ) == min(scores)
