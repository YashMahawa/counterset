# Decision contract

## Ownership

The programmer owns lineup, windows, locks, stages, curfews, changeovers, intentional clashes and reported attendee pairs. Qloo owns returned aggregate associations. The application's declared reciprocal-rank rule produces conflict cues. The model owns no operational facts. Every proposed model extraction carries an exact note quote and awaits human approval.

## Durable objects

SQLite stores projects, evidence snapshots inside versioned projects, immutable proposals, notes, published versions, comparison reports and jobs. Mutations use a process lock and expected-version check. This is a single-process local deployment; multiple web workers are not supported. Publishing verifies the proposal's project, version and complete input hash, then independently validates placements and counts again.

## Evidence gate

Each seed queries the same resolved artist universe, capped at 50. The gate rejects missing, duplicate, extra, self and non-finite results. Ranks count strictly greater scores so ties at a cutoff expand the set. Reciprocal top-k creates an undirected cue from two directional observations; request-order invariance does not establish symmetry. One reversed-order seed is a limited stability control. Incomplete rows produce unknown relationships, never invented zeroes. Identity/k changes invalidate evidence. Other fact changes invalidate proposals through the project version.

## Optimization

Optional intervals assign each act to exactly one permitted stage. Start times sit on the declared grid. Availability, stage opening/curfew including changeover, locks, no-overlap and outages are hard constraints. Each paired overlap is separately reified. Attendee weights are aggregated by canonical unordered pair. The overlap buffer is applied once.

Lexicographic passes minimize: attendee conflicts; cues (including unknown only under an explicit cautious policy); changed acts; overlap minutes; absolute start displacement. Each proven objective is fixed before the next pass. If any pass is merely FEASIBLE, no later pass proceeds and the whole hierarchy is labelled FEASIBLE. UNKNOWN without an incumbent produces no proposal. Results include objective values/bounds by pass. Multiple equal optima can have different placements; deterministic output is not promised under wall-clock limits.

The operator can instead prioritize total start-time displacement before changed-act count, after the same attendee/cue objectives. This is an explicit versioned production preference, not a model-chosen weight. Both modes use identical constraints and independent recounts.

The independent validator imports no solver code. It recounts every published metric, checks all placement rules and compares the objective values with the solver's reported values. A mismatch stops the operation. An infeasibility core is sufficient, never called smallest. Fixed stage rules may contribute to infeasibility without appearing as relaxable assumptions.

## Finite agent workflow

`facts → identity confirmation → evidence job → coverage gate → audit → bounded solve → independent recount → proposal → human approval → versioned export`.

The model can propose one quoted constraint from a note. The controller validates its schema, identity, time range and source quote, persists it as pending and requires approval against the same input version. The model cannot call insights, approve a constraint, change solver priorities, relax locks or publish. The comparative LLM path returns a proposed placement list, which the independent validator can reject. No model-produced number is trusted as a measured count.

## Provider behavior

Requests are allowlisted by provider endpoint/model. Only the existing free-project credential variable/file is read for models. Server-side caches and logs omit keys. All requests are counted; Qloo successes are capped with a configured historical offset, and model attempts are capped separately. Temporary 500/502/503/429 responses have bounded retries with spacing; a Retry-After cooldown is respected. A failed job applies no schedule change. Restarted in-flight jobs become retryable failures; already successful Qloo responses remain cached.

## Boundaries

No ticketing integration, crowd-size prediction, automated outreach, real-time emergency command system or representative audience experiment is claimed. A common shared token protects one workspace when exposed beyond localhost. Multi-tenant authentication, a durable distributed queue and native production-platform integrations would require additional work.
