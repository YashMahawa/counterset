"""Turn a pasted lineup into a festival day, and match its acts to Qloo.

A line reads: stage | act | start | end, with an optional fifth column for comedy, podcast or talk.
Commas and tabs work as well as bars, so a spreadsheet can be pasted or a CSV file read.
Times are 24-hour local times.
"""

import re
from .domain import Day, QLOO_TYPES
from .evidence import entities

KINDS = {"music": "artist", "artist": "artist", "comedy": "comedian", "comedian": "comedian", "podcast": "podcast", "talk": "speaker", "speaker": "speaker"}
MAX_SETS = 30
MAX_STAGES = 8


def minutes(text, line):
    m = re.fullmatch(r"(\d{1,2})[:.](\d{2})", text.strip())
    if not m or int(m[1]) > 29 or int(m[2]) > 59:
        raise ValueError(f"Line {line}: “{text.strip()}” is not a time. Use 24-hour time such as 20:30.")
    return int(m[1]) * 60 + int(m[2])


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "x"


def norm(text):
    return re.sub(r"[^a-z0-9]", "", text.lower().replace("&", "and").replace("$", "s"))


def parse(name, text):
    rows = []
    for n, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        parts = [p.strip() for p in re.split(r"\s*[|\t]\s*", raw.strip())] if ("|" in raw or "\t" in raw) else [p.strip() for p in raw.split(",")]
        if len(parts) not in (4, 5) or not parts[0] or not parts[1]:
            raise ValueError(f"Line {n}: use stage | act | start | end. For example: Main | Mitski | 20:30 | 21:30")
        if not rows and parts[2].lower() in {"start", "starts", "from", "begin"}:
            continue  # A spreadsheet's heading row.
        kind = KINDS.get(parts[4].lower()) if len(parts) == 5 else "artist"
        if kind is None:
            raise ValueError(f"Line {n}: the last column can be music, comedy, podcast or talk.")
        start, end = minutes(parts[2], n), minutes(parts[3], n)
        if end <= start:
            end += 1440
        rows.append((parts[0], parts[1], start, end, kind))
    if len(rows) < 2:
        raise ValueError("Add at least two sets.")
    if len(rows) > MAX_SETS:
        raise ValueError(f"This server takes up to {MAX_SETS} sets. Paste part of your day.")
    # A set just after midnight belongs to the same festival day as the set that opened the list.
    anchor = rows[0][2]
    rows = [(s, a, st + 1440, en + 1440, k) if anchor - st > 360 else (s, a, st, en, k) for s, a, st, en, k in rows]
    first = min(r[2] for r in rows)
    stages = list(dict.fromkeys(r[0] for r in rows))
    if len(stages) > MAX_STAGES:
        raise ValueError(f"This server takes up to {MAX_STAGES} stages.")
    if len({norm(r[1]) for r in rows}) != len(rows):
        raise ValueError("Each act can appear once. Remove the repeated name.")
    stage_id = {s: "stage-" + slug(s) for s in stages}
    if len(set(stage_id.values())) != len(stages):
        raise ValueError("Two stage names are too similar. Rename one.")
    closes = min(2880, max(r[3] for r in rows) + 60)
    # Changeover: the shortest gap the lineup itself leaves on a stage, up to 30 minutes.
    gaps = {}
    for s in stages:
        sets = sorted((r[2], r[3]) for r in rows if r[0] == s)
        between = [b[0] - a[1] for a, b in zip(sets, sets[1:])]
        if any(g < 0 for g in between):
            raise ValueError(f"Two sets overlap on {s}. Check their times.")
        gaps[s] = min([*between, 30]) if between else 15
    used, acts, draft = set(), [], []
    for s, a, start, end, kind in rows:
        aid = "act-" + slug(a)
        while aid in used:
            aid += "-x"
        used.add(aid)
        acts.append({"id": aid, "name": a[:120], "kind": kind, "duration": min(240, end - start), "changeover": gaps[s], "allowed_stages": list(stage_id.values()), "earliest": max(0, first), "latest": closes})
        draft.append({"act_id": aid, "stage_id": stage_id[s], "start": start})
    return Day.model_validate(
        {
            "name": (name or "Your lineup")[:100],
            "stages": [{"id": stage_id[s], "name": s[:100], "opens": first, "closes": closes} for s in stages],
            "acts": acts,
            "draft": draft,
            "grid": 5,
        }
    )


def text_of(day):
    """The day as lines the parser reads back, so a person can edit it as text."""
    acts = {a.id: a for a in day.acts}
    stages = {s.id: s.name for s in day.stages}
    back = {v: k for k, v in KINDS.items() if k in {"comedy", "podcast", "talk"}}
    lines = []
    for p in sorted(day.draft, key=lambda x: ([s.id for s in day.stages].index(x.stage_id), x.start)):
        if p.cut:
            continue
        a = acts[p.act_id]
        end = p.start + (p.length or a.duration)
        line = [stages[p.stage_id], a.name, f"{p.start // 60 % 24:02}:{p.start % 60:02}", f"{end // 60 % 24:02}:{end % 60:02}"]
        if a.kind in back:
            line.append(back[a.kind])
        lines.append(" | ".join(line))
    return "\n".join(lines)


def revise(old, text):
    """Apply edited lines to a day. Acts that keep their name keep what a person confirmed."""
    new = parse(old.name, text)
    kept = {norm(a.name): a for a in old.acts}
    stages = {s.id for s in new.stages}
    data = new.model_dump()
    old_names = {s.id: s.name for s in old.stages}
    new_ids = {s.name: s.id for s in new.stages}
    moved = {}
    for a in data["acts"]:
        was = kept.get(norm(a["name"]))
        if was:
            moved[a["id"]] = was.id
            home = next(p["stage_id"] for p in data["draft"] if p["act_id"] == a["id"])
            allowed = [new_ids[old_names[s]] for s in was.allowed_stages if old_names.get(s) in new_ids]
            a.update(id=was.id, qloo_id=was.qloo_id, draw=was.draw, locked=was.locked, headliner=was.headliner, allowed_stages=allowed if home in allowed else a["allowed_stages"])
    for p in data["draft"]:
        p["act_id"] = moved.get(p["act_id"], p["act_id"])
    # A day that is still mostly the same keeps its curfew and its evidence settings.
    if len(moved) * 2 >= len(data["acts"]):
        curfew = max(s.closes for s in old.stages)
        if all(p["start"] + a["duration"] <= curfew for p in data["draft"] for a in data["acts"] if a["id"] == p["act_id"]):
            for s in data["stages"]:
                s["closes"] = curfew
            for a in data["acts"]:
                a["latest"] = curfew
    # What a person said about an act's hours still holds if the edited slot fits inside them.
    was_by_id = {a.id: a for a in old.acts}
    for a in data["acts"]:
        was = was_by_id.get(a["id"])
        p = next(x for x in data["draft"] if x["act_id"] == a["id"])
        if was and was.earliest <= p["start"] and p["start"] + a["duration"] <= was.latest:
            a.update(earliest=was.earliest, latest=was.latest)
    data.update(k=old.k, threshold=old.threshold)
    data["outages"] = [o.model_dump() for o in old.outages if o.stage_id in stages]
    names = {a["id"] for a in data["acts"]}
    data["intentional"] = [x.model_dump() for x in old.intentional if x.a in names and x.b in names]
    return Day.model_validate(data)


def same_lines(a, b):
    """Two lineups that read the same, however they were spaced."""
    clean = lambda text: [[p.strip() for p in re.split(r"\s*[|\t]\s*", line.strip())] for line in text.splitlines() if line.strip()]
    return sorted(clean(a)) == sorted(clean(b))


def match(day, gateway, progress=lambda *_: None):
    """Fill exact-name matches from Qloo for a person to check. Anything else stays unknown."""
    data = day.model_dump()
    taken = {a["qloo_id"] for a in data["acts"] if a.get("qloo_id")}
    found = [a["name"] for a in data["acts"] if a.get("qloo_id")]
    for i, a in enumerate(data["acts"]):
        if a.get("qloo_id"):
            continue
        payload, _ = gateway.qloo("/search", {"query": a["name"], "types": QLOO_TYPES[a["kind"]], "take": 5})
        hit = next((e for e in entities(payload)[:5] if norm(e.get("name", "")) == norm(a["name"]) and e["entity_id"] not in taken), None)
        if hit:
            a["qloo_id"] = hit["entity_id"]
            popularity = hit.get("popularity")
            a["draw"] = popularity if isinstance(popularity, (int, float)) and 0 <= popularity <= 1 else None
            taken.add(hit["entity_id"])
            found.append(a["name"])
        progress(i + 1, len(data["acts"]), f"{i + 1} of {len(data['acts'])} acts looked up in Qloo")
    return Day.model_validate(data), found
