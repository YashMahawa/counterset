# Architecture and decision contract

## Who owns what

| Fact | Owner | Where it lives |
| --- | --- | --- |
| Bill, set lengths, stages, availability, changeovers, curfews, locks, intentional clashes | The programmer | `Day` (versioned) |
| Attendee must-see pairs | The programmer, from a real survey | `Day.must_see`, highest priority |
| Who each act is | A person confirms a Qloo search result | `Act.qloo_id`, `Act.kind` |
| How acts relate | Qloo responses, read as within-response ranks | Evidence snapshot (ranks only, no raw scores) |
| Which repair is feasible and best | CP-SAT, then an independent validator | Proposal (immutable) |
| What a production message says | A model proposes; the controller checks; a person ticks | Note with per-item status |
| What gets published | A person | Published version (immutable) |

## Evidence

Each act maps to one Qloo entity type: `artist` → `urn:entity:artist`; `comedian` and `speaker` → `urn:entity:person`; `podcast` → `urn:entity:podcast`. For every confirmed act (the seed) and every type on the bill, one `/v2/insights` request sets `filter.type` to that type, `signal.interests.entities` to the seed and `filter.results.entities` to every confirmed act of that type, with `take` equal to their number.

A row is complete only if it returns exactly the requested acts minus the seed, each with a finite affinity, with no duplicates, no self and no extras. Rank is 1 + the number of strictly higher scores, so ties expand a cutoff. Raw affinities from different requests are never compared, normalised or stored in the snapshot; the snapshot holds ranks, row sizes, coverage errors and provenance (live, cache or missing, and when each row was fetched).

A pair is a **cue** when each act ranks the other within the top *k* of the other's kind, where *k* (default 3) is capped at a quarter of the acts of that kind (`ceil(n/4)`). A cross-kind cue therefore means "her closest musician on this bill, and his closest comedian". A pair with any incomplete row is **unknown**. Unknown pairs are reported and, by default, not optimised; the cautious policy counts them, visibly. One reversed-candidate-order request per bill is a stability control; if it disagrees, every cue is disabled for that snapshot.

Changing any identity, kind or *k* clears the evidence. Evidence older than 30 days is marked stale and blocks publication until refreshed.

## Audit

For the current grid the validator lists every cue pair overlapping by more than the threshold (10 minutes) on different stages. `stats.random_fill` reassigns the same acts to the same slots 4,000 times with a fixed seed and reports the share of fills that clash as little or less, with the full distribution. It answers "is this grid more careful than chance?", not "will people attend".

## Repair

`solver.build` creates optional intervals per stage, a start variable on the time grid, and named guard literals for every relaxable rule: each act's availability, each lock, each stage hold and the move limit. Stage exclusivity with changeovers and stage hours are fixed. Curfew binds the set's end; changeover only separates consecutive sets.

`solver.solve` runs lexicographic passes, fixing each proven optimum before the next:

1. weighted attendee must-see conflicts
2. Qloo cue conflicts (plus unknown pairs under the cautious policy)
3. the programmer's preference, then tie-breaks: **fewest changed acts** orders changed acts → overlap minutes of remaining cue conflicts → total start shift; **closest start times** orders total start shift → changed acts → overlap minutes

If any pass is only FEASIBLE within the time limit, later passes stop and the option is labelled FEASIBLE, never minimal. UNKNOWN with no incumbent returns no schedule and says this is not a proof of infeasibility.

When the rules are infeasible, OR-Tools' sufficient assumptions are reduced by a deletion filter: each rule is dropped in turn and kept only if the remaining rules become satisfiable. The result is irreducible when every check was decided; otherwise it says so.

`repair.plan` solves both preferences, then solves each again with every Qloo cue removed under the same facts, budget and preference. `without_qloo.protected` lists cue pairs that the blind repair leaves clashing and the evidence-aware repair keeps apart. Identical blind and aware schedules are labelled "Qloo did not change this repair". Equal options are collapsed.

The validator imports no solver code. It recounts every rule, every conflict and every objective value; a disagreement with the solver raises instead of returning a proposal.

## Rescue

A rescue opens two more decisions for each act: how long it plays and whether it plays. Both stay off until a person chooses them for one repair, and the saved day does not change until approval.

- **Shortening.** An act's `min_duration` is its shortest acceptable set. `apply_scenario` sets it from a chosen percentage. Headliners and locked sets are never shortened.
- **Dropping.** A dropped act takes a sentinel stage index, leaves every interval and clash term, and keeps its old slot on file. Headliners and locked sets are never dropped.
- **Order.** Sets dropped, then which sets go (lowest Qloo popularity first; an act Qloo cannot rate counts as middling), attendee must-sees, shared-crowd clashes, minutes shortened, then the programmer's preference. Crowd evidence ranks after sets saved, so it never costs an act its slot.
- **Proof.** Each pass is labelled OPTIMAL or FEASIBLE, and the next pass starts from that schedule. The app says which objectives are proven.
- **Site closure.** `site_hold` closes every stage, and any set still to play can only start after the site reopens.

## Agent

`desk_agent.py` is a bounded loop. On each turn the model returns `{thought, tool, args}` and the controller runs the tool. The model is told what happened and chooses again, for at most 16 turns.

```
message → close_site / close_stage / limit_act (exact quote required) → audit
→ try_rescue (gentlest first; relax one term) → compare_without_qloo → compare_as_run
→ why_they_share_a_crowd → finish → a person approves
```

Controller rules: a quote must be an exact part of the message; a curfew may not pass the stated hard stop; `finish` is refused until the comparisons have run; three refused calls in a row stop the run with nothing applied; a summary containing a number absent from the tool results is replaced by a computed one, with the reason recorded.

A finished run is a proposal carrying its own day (the closures and rescue terms) and the hash of the day it started from. Publishing re-checks the hash and re-runs the validator. Models cannot call Qloo, produce placements, approve or publish.

**Saved runs.** `record_agent.py` runs the agent live once on an example with `gemini-3.8-flash`, checks the plan with the validator and stores the whole run: every step, the plan and the Qloo comparison. An untouched example plays it back with no model, solver or Qloo call, and the page says so. Changing the words, an option or the lineup makes the run live. The landing page plays the Bonnaroo run the same way.

**Questions.** `ask_agent.py` is a second bounded loop over an existing plan: it can look up why a set moved, ask Qloo for the crowd two acts share or for similar acts, and re-solve with new rules. A new plan is a new proposal that a person still approves, and the last plan stays reachable. Numbers in its answers are checked against tool results.

The older message reader in `agent.py` is still the “Something changes” step: it proposes typed items, each with an exact quote, for a person to tick.

## MCP

`mcp.py` serves `initialize`, `tools/list` and `tools/call` at `POST /mcp`, with `list_days`, `audit_day`, `rescue_day` and `why_share_a_crowd`. Tools read recorded evidence, run the real solver and change nothing. Requests are rate limited per client.

## Public mode

`COUNTERSET_PUBLIC=1` hides other visitors' workspaces, turns off live Qloo calls and caps live agent runs per visitor and per day. Each visitor gets a fresh copy of a worked day.

## State and versions

SQLite stores projects, proposals, notes, published versions, benchmarks and jobs. Every mutation checks the expected project version under a process lock. A proposal stores its input version and a hash of the day plus evidence id; publishing re-checks both, re-validates the placements and refuses stale or mismatched input. Approving creates an immutable version (with the previous placements and the counterfactual summary), makes it the new draft and marks the project published. Jobs run in a small thread pool; a restart marks in-flight jobs failed with nothing applied, and fetched Qloo rows remain cached.

## Providers

Requests are allowlisted (`/search`, `/v2/insights`, `/v2/analysis/compare`; one Gemini model and up to three free keys, in turn). Qloo calls are spaced at least 13 seconds apart under a file lock, counted against a durable ledger with the prior-use offset, and cached privately by request digest. Model attempts are capped. 429/500/502/503 responses retry with backoff; a 400 drops the JSON MIME hint once; incomplete responses report their finish reason. A failed job applies nothing.

## Interface

The studio is one page over the same API. Seven steps (The agent, The bill, Shared crowds, Audit the grid, Something changes, Choose a repair, Approve) are underline tabs; each step shows its own finding, its own primary action, and one work card under the timetable whose side column holds the evidence for the current selection. Every step reads its state from the server and performs real actions; Desk mode hides the guidance lines and the Next buttons. Sets are absolutely positioned tiles keyed by act, so switching between the draft, an option and its without-Qloo counterfactual slides the same elements to their new slots, leaves an outline where each moved set was, and redraws the clash threads. Holds drop into their lane. Reduced-motion users get the same states without travel. The strict CSP (`style-src 'self'`) is kept by applying geometry through the CSSOM.
