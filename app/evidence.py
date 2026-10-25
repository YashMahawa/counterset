"""Qloo response coverage, within-row ranks and separately labelled missing evidence."""

import math
import time
from itertools import combinations
from .domain import Day, canonical_pair, digest


def entities(payload):
    r = payload.get("results", {})
    return r if isinstance(r, list) else r.get("entities", [])


def score_row(payload, seed, universe):
    expected = set(universe) - {seed}
    scores = {}
    seen = []
    errors = []
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
            errors.append("Non-finite or missing affinity")
            continue
        scores[eid] = value
    if len(set(seen)) != len(seen):
        errors.append("Duplicate entity")
    if set(seen) != expected:
        errors.append("Candidate coverage mismatch")
    return {"complete": not errors, "scores": scores, "errors": errors}


def graph(day: Day, rows, source, control=None):
    ranks = {}
    status = {}
    ids = [a.qloo_id for a in day.acts if a.qloo_id]
    for a in day.acts:
        row = rows.get(a.qloo_id)
        status[a.id] = {
            "complete": bool(row and row["complete"]),
            "errors": row["errors"] if row else ["No scored row"],
        }
        if row and row["complete"]:
            values = row["scores"]
            ranks[a.id] = {
                eid: 1 + sum(other > score for other in values.values())
                for eid, score in values.items()
            }
    edges = []
    unknown = []
    unstable = bool(control and not control.get("passed"))
    for a, b in combinations(day.acts, 2):
        if unstable or a.id not in ranks or b.id not in ranks:
            unknown.append({"a": a.id, "b": b.id, "source": "unknown", "weight": 1})
            continue
        ar = ranks[a.id].get(b.qloo_id)
        br = ranks[b.id].get(a.qloo_id)
        if ar is not None and br is not None and ar <= day.k and br <= day.k:
            edges.append(
                {"a": a.id, "b": b.id, "source": "qloo", "weight": 1, "ranks": [ar, br]}
            )
    result = {
        "source": source,
        "fetched_at": time.time(),
        "universe": ids,
        "k": day.k,
        "coverage": status,
        "complete_rows": sum(x["complete"] for x in status.values()),
        "total_rows": len(day.acts),
        "edges": edges,
        "unknown": unknown,
        "order_control": control,
        "status": "UNSTABLE"
        if unstable
        else "COMPLETE"
        if all(x["complete"] for x in status.values())
        else "PARTIAL",
    }
    result["id"] = digest(result)
    return result


def all_edges(day, evidence):
    ms = {}
    for p in day.must_see:
        ms[canonical_pair(p.a, p.b)] = ms.get(canonical_pair(p.a, p.b), 0) + p.weight
    actual = [
        {"a": a, "b": b, "weight": w, "source": "must_see"} for (a, b), w in ms.items()
    ]
    return actual + evidence.get("edges", []) + evidence.get("unknown", [])


def genre_edges(day):
    return [
        {"a": a.id, "b": b.id, "source": "genre", "weight": 1}
        for a, b in combinations(day.acts, 2)
        if a.genre != "unclassified" and a.genre == b.genre
    ]


def fetch_snapshot(day, gateway, progress=lambda *_: None, refresh=False):
    ids = [a.qloo_id for a in day.acts if a.qloo_id]
    rows = {}
    raw = {}
    sources = []
    for i, seed in enumerate(ids):
        params = {
            "filter.type": "urn:entity:artist",
            "signal.interests.entities": seed,
            "filter.results.entities": ",".join(ids),
            "take": len(ids),
            "feature.explainability": "true",
        }
        payload, src = gateway.qloo("/v2/insights", params, refresh)
        raw[seed] = payload
        rows[seed] = score_row(payload, seed, ids)
        sources.append(src)
        progress(i + 1, len(ids) + 1)
    control = None
    if ids:
        params = {
            "filter.type": "urn:entity:artist",
            "signal.interests.entities": ids[0],
            "filter.results.entities": ",".join(reversed(ids)),
            "take": len(ids),
            "feature.explainability": "true",
        }
        payload, _ = gateway.qloo("/v2/insights", params, refresh)
        reverse = score_row(payload, ids[0], ids)
        control = {
            "seed": ids[0],
            "passed": reverse["complete"]
            and reverse["scores"] == rows[ids[0]]["scores"],
            "scope": "Candidate-order check on this seed only",
        }
    return graph(day, rows, "qloo_live_or_private_cache", control)
