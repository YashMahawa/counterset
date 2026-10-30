"""Exact-bill Qloo evidence: complete rows, within-response ranks, explicit unknowns.

Every resolved act is a seed. For each Qloo entity type on the bill (artists,
people, podcasts) one request ranks exactly the acts of that type. A rank is
only ever read inside the response that produced it; raw affinity values from
different requests are never compared, normalised or stored in the snapshot.
"""

import math
import time
from itertools import combinations
from .domain import QLOO_TYPES, Day, canonical_pair, digest


class NotCached(Exception):
    pass


def entities(payload):
    r = payload.get("results", {})
    return r if isinstance(r, list) else r.get("entities", [])


def score_row(payload, seed, candidates):
    expected = set(candidates) - {seed}
    scores, seen, errors = {}, [], []
    for e in entities(payload):
        eid = e.get("entity_id")
        seen.append(eid)
        value = (e.get("query") or {}).get("affinity")
        if eid == seed:
            errors.append("Self included")
            continue
        if (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
        ):
            errors.append("Missing or non-finite affinity")
            continue
        scores[eid] = value
    if len(set(seen)) != len(seen):
        errors.append("Duplicate entity")
    missing = expected - set(seen)
    if missing:
        errors.append(f"{len(missing)} requested act(s) not returned")
    if set(seen) - expected - {seed}:
        errors.append("Unrequested entity returned")
    return {"complete": not errors, "scores": scores, "errors": errors}


def ranks_of(scores):
    """Rank 1 is the strongest. Ties share the better rank, so a cutoff expands."""
    return {e: 1 + sum(o > s for o in scores.values()) for e, s in scores.items()}


def cap(k, n):
    """Top-k, but never more than a quarter of the acts of that kind."""
    return max(1, min(k, math.ceil(n / 4)))


def groups(day: Day):
    out = {}
    for a in day.acts:
        if a.qloo_id:
            out.setdefault(QLOO_TYPES[a.kind], []).append(a.qloo_id)
    return out


def params(seed, qtype, candidates):
    return {
        "filter.type": qtype,
        "signal.interests.entities": seed,
        "filter.results.entities": ",".join(candidates),
        "take": len(candidates),
        "feature.explainability": "true",
    }


def fetch_rows(day, gateway, progress=lambda *_: None, refresh=False, offline=False):
    """Returns rows[(seed, qtype)] with provenance, plus an order-control result."""
    g = groups(day)
    plan = [
        (a.qloo_id, qtype, ids)
        for a in day.acts
        if a.qloo_id
        for qtype, ids in g.items()
        if set(ids) - {a.qloo_id}
    ]
    total = len(plan) + (1 if plan else 0)
    rows = {}
    for i, (seed, qtype, ids) in enumerate(plan):
        request = params(seed, qtype, ids)
        try:
            payload, src = gateway.qloo("/v2/insights", request, refresh, offline)
            row = score_row(payload, seed, ids)
        except NotCached:
            src = "missing"
            row = {"complete": False, "scores": {}, "errors": ["Not in private cache"]}
        at = gateway.cached_at("/v2/insights", request) or time.time()
        rows[(seed, qtype)] = {**row, "source": src, "at": at, "n": len(set(ids) - {seed})}
        progress(i + 1, total, f"{i + 1} of {total} Qloo rows")
    control = None
    if plan:
        seed, qtype, ids = plan[0]
        try:
            payload, _ = gateway.qloo(
                "/v2/insights", params(seed, qtype, list(reversed(ids))), refresh, offline
            )
            reverse = score_row(payload, seed, ids)
            control = {
                "seed": seed,
                "passed": reverse["complete"]
                and reverse["scores"] == rows[(seed, qtype)]["scores"],
                "scope": "Reversed candidate order for one seed; a bounded stability check",
            }
        except NotCached:
            control = {"seed": seed, "passed": None, "scope": "Order control not cached"}
        progress(total, total, "Order control")
    return rows, control


def graph(day: Day, rows, source, control=None):
    by_qloo = {a.qloo_id: a for a in day.acts if a.qloo_id}
    rank, sizes, coverage, provenance = {}, {}, {}, {}
    for a in day.acts:
        mine = {k: v for k, v in rows.items() if k[0] == a.qloo_id} if a.qloo_id else {}
        errors = [] if a.qloo_id else ["Identity not confirmed"]
        if a.qloo_id and not mine:
            errors.append("No scored row")
        rank[a.id], sizes[a.id] = {}, {}
        for (_, qtype), row in mine.items():
            errors += [f"{qtype.split(':')[-1]} row: {e}" for e in row["errors"]]
            provenance.setdefault(a.id, []).append(
                {"type": qtype, "source": row["source"], "at": row["at"], "complete": row["complete"]}
            )
            if row["complete"]:
                sizes[a.id][qtype] = row["n"]
                for eid, r in ranks_of(row["scores"]).items():
                    if eid in by_qloo:
                        rank[a.id][by_qloo[eid].id] = r
        coverage[a.id] = {"complete": not errors, "errors": errors}
    unstable = bool(control and control.get("passed") is False)
    edges, unknown = [], []
    for a, b in combinations(day.acts, 2):
        ar, br = rank[a.id].get(b.id), rank[b.id].get(a.id)
        if unstable or ar is None or br is None:
            unknown.append({"a": a.id, "b": b.id, "source": "unknown", "weight": 1})
            continue
        na = sizes[a.id][QLOO_TYPES[b.kind]]
        nb = sizes[b.id][QLOO_TYPES[a.kind]]
        if ar <= cap(day.k, na) and br <= cap(day.k, nb):
            edges.append(
                {
                    "a": a.id,
                    "b": b.id,
                    "source": "qloo",
                    "weight": 1,
                    "ranks": [ar, br],
                    "of": [na, nb],
                    "cross": a.kind != b.kind,
                }
            )
    times = [p["at"] for v in provenance.values() for p in v]
    result = {
        "source": source,
        "fetched_at": min(times) if times else time.time(),
        "k": day.k,
        "universe": {a.id: a.qloo_id for a in day.acts if a.qloo_id},
        "kinds": {a.id: a.kind for a in day.acts},
        "coverage": coverage,
        "provenance": provenance,
        "ranks": rank,
        "sizes": sizes,
        "complete_rows": sum(x["complete"] for x in coverage.values()),
        "total_rows": len(day.acts),
        "edges": edges,
        "unknown": unknown,
        "order_control": control,
        "status": "UNSTABLE"
        if unstable
        else "COMPLETE"
        if all(x["complete"] for x in coverage.values())
        else "PARTIAL",
    }
    result["id"] = digest({k: v for k, v in result.items() if k not in {"fetched_at", "provenance"}})
    return result


def fetch_snapshot(day, gateway, progress=lambda *_: None, refresh=False, offline=False):
    rows, control = fetch_rows(day, gateway, progress, refresh, offline)
    source = "qloo_private_cache" if offline else "qloo_live_or_private_cache"
    return graph(day, rows, source, control)


# Qloo also returns where a crowd's taste comes from. These do not explain a shared taste.
PLACES = {"United States", "United Kingdom", "American", "British", "Manchester", "Canadian", "Australian", "Canada", "Australia"}


def explain_pairs(day: Day, evidence, gateway, limit=6):
    """Why the strongest pairs share a crowd, in Qloo's tag names. Only the names are kept."""
    ids = {a.id: a.qloo_id for a in day.acts}
    out = {}
    for e in sorted(evidence.get("edges", []), key=lambda x: sum(x["ranks"]))[:limit]:
        payload, _ = gateway.qloo(
            "/v2/analysis/compare",
            {"a.signal.interests.entities": ids[e["a"]], "b.signal.interests.entities": ids[e["b"]], "take": 12},
        )
        res = payload.get("results", {})
        tags = res.get("tags", []) if isinstance(res, dict) else []
        out["|".join(canonical_pair(e["a"], e["b"]))] = [t["name"] for t in tags if t.get("name") and t["name"] not in PLACES][:6]
    return out


def identity_key(day: Day):
    return sorted(((a.id, a.qloo_id, a.kind) for a in day.acts), key=lambda x: x[0]) + [day.k]


def all_edges(day, evidence):
    ms = {}
    for p in day.must_see:
        key = canonical_pair(p.a, p.b)
        ms[key] = ms.get(key, 0) + p.weight
    actual = [{"a": a, "b": b, "weight": w, "source": "must_see"} for (a, b), w in ms.items()]
    return actual + evidence.get("edges", []) + evidence.get("unknown", [])


def attendee_edges(edges):
    return [e for e in edges if e["source"] == "must_see"]


def genre_edges(day):
    return [
        {"a": a.id, "b": b.id, "source": "genre", "weight": 1}
        for a, b in combinations(day.acts, 2)
        if a.genre != "unclassified" and a.genre == b.genre
    ]


def age_days(evidence):
    return (time.time() - evidence.get("fetched_at", time.time())) / 86400
