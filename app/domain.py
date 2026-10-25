"""Typed producer-owned facts. All times are minutes from midnight, local festival time."""

from __future__ import annotations
import hashlib
import json
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


def digest(value):
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


# A programme can mix musicians, comedians, speakers and live podcasts. Each kind
# maps to one Qloo entity type; ranks are only ever compared inside one response.
QLOO_TYPES = {
    "artist": "urn:entity:artist",
    "comedian": "urn:entity:person",
    "speaker": "urn:entity:person",
    "podcast": "urn:entity:podcast",
}
Kind = Literal["artist", "comedian", "speaker", "podcast"]
Priority = Literal["fewest_acts", "least_time_shift"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Stage(Strict):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    opens: int = Field(ge=0, le=2880)
    closes: int = Field(ge=1, le=2880)

    @model_validator(mode="after")
    def window(self):
        if self.opens >= self.closes:
            raise ValueError("Stage opening must precede curfew")
        return self


class Placement(Strict):
    act_id: str
    stage_id: str
    start: int = Field(ge=0, le=2880)


class Act(Strict):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    kind: Kind = "artist"
    qloo_id: str | None = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    )
    duration: int = Field(ge=5, le=240)
    changeover: int = Field(default=10, ge=0, le=120)
    allowed_stages: list[str] = Field(min_length=1)
    earliest: int = Field(ge=0, le=2880)
    latest: int = Field(ge=1, le=2880)
    locked: bool = False
    genre: str = Field(default="unclassified", max_length=80)


class Pair(Strict):
    a: str
    b: str
    weight: int = Field(default=1, ge=1, le=100000)


class Outage(Strict):
    stage_id: str
    start: int = Field(ge=0, le=2880)
    end: int = Field(ge=0, le=2880)
    reason: str = Field(default="Stage hold", max_length=200)


class Day(Strict):
    name: str = Field(min_length=1, max_length=100)
    date: str = "2026-10-30"
    stages: list[Stage] = Field(min_length=1, max_length=8)
    acts: list[Act] = Field(min_length=2, max_length=50)
    draft: list[Placement]
    must_see: list[Pair] = []
    intentional: list[Pair] = []
    outages: list[Outage] = []
    grid: int = Field(default=15, ge=5, le=60)
    threshold: int = Field(default=10, ge=0, le=120)
    buffer: int = Field(default=0, ge=0, le=60)
    k: int = Field(default=3, ge=1, le=10)
    unknown_policy: Literal["report", "cautious"] = "report"
    repair_priority: Priority = "fewest_acts"

    @model_validator(mode="after")
    def references(self):
        ids = {a.id for a in self.acts}
        stages = {s.id for s in self.stages}
        if len(ids) != len(self.acts) or len(stages) != len(self.stages):
            raise ValueError("IDs must be unique")
        if len(self.draft) != len(ids) or {p.act_id for p in self.draft} != ids:
            raise ValueError("Exactly one draft placement per act")
        if len({a.qloo_id for a in self.acts if a.qloo_id}) != sum(
            bool(a.qloo_id) for a in self.acts
        ):
            raise ValueError("Duplicate resolved Qloo entity")
        for a in self.acts:
            if not set(a.allowed_stages) <= stages or a.earliest >= a.latest:
                raise ValueError(f"{a.name}: invalid stages or availability window")
        for p in self.draft:
            if p.stage_id not in stages:
                raise ValueError("Unknown draft stage")
        for p in self.must_see + self.intentional:
            if p.a not in ids or p.b not in ids or p.a == p.b:
                raise ValueError("Invalid conflict pair")
        for o in self.outages:
            if o.stage_id not in stages or o.end <= o.start:
                raise ValueError("Invalid stage hold")
        return self


def canonical_pair(a, b):
    return tuple(sorted((a, b)))


def reference_hash(day, evidence):
    return digest({"day": day.model_dump(), "evidence": evidence.get("id")})
