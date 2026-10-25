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
    assert r["status"] == "INFEASIBLE"
    # Deletion filtering leaves only the rule that actually conflicts.
    assert r["core"] == ["0: available 16:00–16:20"], r["core"]


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


def rows_for(day, score=lambda a, b: 1):
    from app.domain import QLOO_TYPES

    rows = {}
    for a in day.acts:
        for qtype in {QLOO_TYPES[b.kind] for b in day.acts}:
            group = [b for b in day.acts if QLOO_TYPES[b.kind] == qtype and b.id != a.id]
            if group:
                rows[(a.qloo_id, qtype)] = {
                    "complete": True,
                    "scores": {b.qloo_id: score(a, b) for b in group},
                    "errors": [],
                    "source": "test",
                    "at": 0,
                    "n": len(group),
                }
    return rows


def test_rank_ties_are_included_and_incomplete_rows_unknown():
    day = tiny()
    for a in day.acts:
        a.qloo_id = a.id
    day.k = 1
    rows = rows_for(day)
    e = graph(day, rows, "test")
    assert len(e["edges"]) == 6
    rows[("0", "urn:entity:artist")]["complete"] = False
    e = graph(day, rows, "test")
    assert len(e["unknown"]) == 3
    assert not graph(day, rows, "test", {"passed": False})["edges"]


def test_cross_kind_ranks_stay_inside_their_own_response():
    day = tiny()
    for a in day.acts:
        a.qloo_id = a.id
    day.acts[3].kind = "comedian"
    # Raw values from different responses are on different scales; only ranks count.
    rows = rows_for(day, lambda a, b: (100 if b.kind == "comedian" else 0) + int(b.id))
    e = graph(day, rows, "test")
    cross = [x for x in e["edges"] if x["cross"]]
    assert all(x["of"] == [1, 3] or x["of"] == [3, 1] for x in cross)
    assert e["ranks"]["0"]["3"] == 1  # the only person in act 0's person row
    # Cap: never more than a quarter of the candidates of that kind.
    from app.evidence import cap

    assert cap(3, 3) == 1 and cap(3, 11) == 3 and cap(3, 41) == 3 and cap(3, 5) == 2


def test_random_fill_reports_share_of_equal_or_better_grids():
    from app.stats import random_fill

    day = tiny()
    edges = [{"a": "0", "b": "1", "source": "qloo"}]
    r = random_fill(day, day.draft, edges, samples=300, seed=1)
    assert r["observed"] == 1 and 0 < r["share_at_or_below"] <= 1
    assert random_fill(day, day.draft, edges, samples=300, seed=1) == r


def test_counterfactual_names_pairs_only_qloo_kept_apart():
    from app.repair import plan

    day = Day.model_validate(
        {
            "name": "Hold",
            "grid": 20,
            "stages": [
                {"id": "a", "name": "A", "opens": 960, "closes": 1200},
                {"id": "b", "name": "B", "opens": 960, "closes": 1200},
            ],
            "acts": [
                {"id": i, "name": i, "duration": 50, "changeover": 10, "allowed_stages": [s], "earliest": 960, "latest": 1200, "locked": i != "Y"}
                for i, s in [("X", "a"), ("Y", "b"), ("Z", "a")]
            ],
            "draft": [
                {"act_id": "X", "stage_id": "a", "start": 960},
                {"act_id": "Y", "stage_id": "b", "start": 1000},
                {"act_id": "Z", "stage_id": "a", "start": 1080},
            ],
            "outages": [{"stage_id": "b", "start": 980, "end": 1060}],
        }
    )
    evidence = {"edges": [{"a": "Y", "b": "Z", "source": "qloo", "weight": 1, "ranks": [1, 1], "of": [2, 2]}], "unknown": []}
    out = plan(day, evidence, 4, 5)
    fewest = out["options"][0]
    assert fewest["status"] == "OPTIMAL" and fewest["audit"]["counts"]["qloo"] == 0
    assert next(p for p in fewest["placements"] if p["act_id"] == "Y")["start"] == 1120
    blind = fewest["without_qloo"]
    assert next(p for p in blind["placements"] if p["act_id"] == "Y")["start"] == 1060
    assert [(x["a"], x["b"]) for x in blind["protected"]] == [("Y", "Z")]
    assert out["options"][1].get("same_as") == 0


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

