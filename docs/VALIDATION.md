# Validation, 30 October 2026

Three separate questions, answered separately:

1. **Does the software do what it says?** Tests, offline recounts, browser runs and provider logs. This page.
2. **Is Qloo good evidence for the decision?** See [evaluation](EVALUATION.md).
3. **Does it help programmers or fans?** Not measured. See [evaluation](EVALUATION.md).

## Backend: 53 tests pass

`.venv/bin/python -m pytest -q` reports `53 passed, 1 warning`. The warning is an upstream Starlette/httpx deprecation and does not affect results.

| File | Tests |
| --- | ---: |
| `tests/test_agent.py` | 17 |
| `tests/test_engine.py` | 21, of which 8 cover rescues |
| `tests/test_api.py` | 10 |
| `tests/test_providers.py` | 5 |

### The rescue agent (`tests/test_agent.py`)

Real tools with a scripted model. Nothing in this file calls a provider.

- **Proposal only:** a run produces a validated proposal and leaves the saved day untouched. Nothing changes until a person approves, including a closure, which stays on the proposal until then.
- **Refusals:** a quote that is not an exact part of the message; an unknown tool; finishing before both comparisons have run; extending past the message's hard stop; closing the site on a day with no recorded closure.
- **Invented numbers:** a summary with a number not in the tool results is replaced by a computed one, and the rejected text is kept.
- **Bad calls:** three in a row stop the run. A text `"false"` does not open dropping sets.
- **Replay:** recorded decisions re-run every tool, then a person approves and a new version is saved. A changed message is refused.
- **Failure:** a provider 503 fails the job visibly and applies nothing.
- **Public mode:** workspaces are hidden, live Qloo is blocked and the agent is rate-capped.
- **Rescue terms:** they work through the repair endpoint and can be approved. An earlier finish time really applies, and one before the stages open is refused.
- **Export:** in the CSV a dropped set has no slot, and only real changes are marked.
- **MCP:** all four tools list and run, and bad input returns an error.

### Rescues in the solver (`tests/test_engine.py`)

- Shortening every set is preferred to dropping one, with the expected minutes.
- A set is dropped only when the shortest allowed sets still do not fit.
- Without permission to drop, the result is a reported conflict and no silent cut.
- The validator refuses unapproved drops, unapproved shortening, and lengths below what the act accepts.
- A headliner is never shortened or dropped.
- Dropped sets and shortened minutes match a brute-force search of every start, length and drop combination on a small day. The brute force is scored by the validator alone.
- A dropped set can never count as shortened minutes.
- Scenario terms do not touch the saved day.

### Everything else

- **Evidence:** the coverage gate, rank ties widening a cutoff, incomplete rows becoming unknown, a failed order check disabling pairs, cross-kind ranks staying inside their own response, the quarter-of-the-kind cap.
- **Solver:** exhaustive comparison on small instances for both preferences, attendee priority, locks, zero move budget, the intentional-pair exclusion, the cautious unknown policy, buffer and hold recounts, and reduction of an infeasible window to the rule in conflict.
- **Repair and audit:** a counterfactual in which the blind repair leaves a named pair clashing; a deterministic, bounded random-fill share.
- **API:** publication, stale proposals, stale evidence, same-origin and version checks, cache-only evidence failing visibly, message items pending until reviewed, a provider 503 applying nothing, briefing numbers checked against computed facts, infeasible days returning conflicting rules, safe example ids.
- **Providers:** no paid-key fallback, retry without switching model, offline cache mode never calling the network, malformed times rejected, after-midnight times rolling forward.

## Offline checks of the Bonnaroo replay

Run on 30 October against the stored example, with no Qloo or model call.

| Check | Result |
| --- | --- |
| Each of the 15 stored rows recounted by the validator under its own terms | All 15 pass, and the counts match |
| As-run grid under the closure, midnight curfew and drops allowed | No errors. 11 cancelled, 1 clash, 16 overlaps unknown |
| Full length no drops, and 75% no drops | Both `INFEASIBLE`, with the conflict named |
| Six replays of the recorded decisions, 10 seconds per solve, three on each side of a solver change | All finish in about 50 seconds and refuse no step. 24, 25, 27 and 27 of 28 each time |
| Summary check on those replays | Before the change, all three kept the model's summary. After it, all three replaced it with a computed one, because the recording says 13 sets shortened and the rerun shortens 12 |

The recording and the stored table were then rebuilt on the final solver. Details and meaning are in [evaluation](EVALUATION.md#the-agents-recorded-run).

## Browser

Final run on 30 October against the live site, with `LIVE=1`: 66 of 66 checks pass, across 1440 and 390 pixels wide. The test browser was pinned to one Render edge address, because the other one resets connections from the test machine's network. From outside that network the site loaded on 3 of 3 checks. This run pastes a lineup and uses real Qloo calls and the real model through the real interface. It found a bug that API tests could not: the review dialog closed itself. It also checks that the top bar stays solid over each section, because a colour-changing bar once hid itself over the black one, and it drags a set, undoes the move, reloads, approves and opens the share link. The container is built by Render from the Dockerfile.

`scripts/browser_test.cjs` drives real clicks at 1440 and 390 wide. It needs a running server, Playwright on `NODE_PATH` and Chrome at `CHROME_PATH`, and it uses recorded decisions with no model. It covers:

- the public page: terms change the count, "what really happened" shows 17, the stage steps respond, and there is no sideways scroll;
- the desk: the agent's steps appear and finish, nothing changes before approval, the as-run view shows 11 cancelled sets, the without-Qloo view opens, and approval publishes a version;
- the CSV export, an ordinary repair on another day, and no console or page errors.

**Result on this build: NOT RECORDED HERE. To be filled in from a real run of `scripts/browser_test.cjs` on the final build.**

Earlier walkthroughs passed on previous designs. They say nothing about this page.

## Live providers

Counts from the private call log for 30 October, after the press test finished. Every call returned HTTP 200.

| Provider | Endpoint or model | Calls |
| --- | --- | ---: |
| Qloo | `/search` | 70 |
| Qloo | `/v2/insights` | 57 |
| Qloo | `/v2/analysis/compare` | 17 |
| Model | `gemini-3.5-flash-lite` | 60 |

That is 144 Qloo calls, including the Outside Lands press test and the Bonnaroo build. With the 407 of 5,000 recorded here on 25 October, this page's running count is 551. Calls are spaced at least 13 seconds apart, and responses are cached privately. The recorded agent run accounts for 12 of the model calls and 52,247 tokens.

**The press test hit one data gap:** Qloo returned no usable affinity for RÜFÜS DU SOL, so the completeness gate rejected all 12 Sunday rows and reported those pairs as not tested. The gate worked as designed. See [evaluation](EVALUATION.md#press-clash-test-outside-lands-2026).

**Earlier, on 25 October:**

- All six reversed-order controls returned identical scores on Lollapalooza. The Bonnaroo order control also passes.
- Comedian↔musician and artist→podcast rows returned complete, finite scores.
- Gemma 4 31B read a production message after two HTTP 500 retries, all logged. Its three items carried exact quotes, and one was returned as unsupported for a person to judge.
- One LLM-only schedule stopped at the old token limit and was reported as a failure. After the limit was raised, a complete one passed every hard rule.

No paid key, no other model and no fabricated result was used.

## Bugs found and fixed during validation

- Curfew was required to fit the closing set's changeover, which flagged every headliner as invalid. Curfew now binds the set's end only.
- A set starting exactly when a hold began was treated as already started and locked. Now only sets that began before the hold are locked.
- Infeasibility cores were OR-Tools' unreduced assumption sets. They are now reduced by deletion to the rules that conflict.
- An earlier finish time did not apply because stage hours could only extend. It now applies, and one before the stages open is refused.
- A model sending `"false"` as text could have opened dropping sets. Only a real yes opens it now.
- The strict CSP blocked inline style attributes. Geometry is now applied through the CSSOM, and the CSP was kept.
- The LLM-only comparison failed at the token limit. The limit was raised, and incomplete responses now report their finish reason.

No customer, festival deployment, attendance effect or paid integration is claimed.

## The four days to try

`scripts/build_templates.py` builds three of them from published set times and real Qloo rows. Before any of them shipped, a closure sweep and live agent runs confirmed that each one shows real clashes and that the example problem has a clean answer. In live runs with `gemini-3.5-flash-lite`:

| Day | Example problem | Result | Without Qloo |
| --- | --- | --- | --- |
| Outside Lands 2026, Saturday | Sutro closed 16:20–17:20 | 14 of 14 play, 3 clashes to 0, 4 sets move | All 3 clashes stay |
| Lollapalooza 2024, Saturday evening | Ethel Cain not before 18:30 | 21 of 21 play, 4 clashes to 0, 4 sets move | 4 pairs clash |
| Outside Lands 2026, Friday | Twin Peaks closed 17:10–17:55 | All sets play, 2 clashes to 0 | Subtronics × Odd Mob stays |

These are single runs on an assumed set of stage sizes and artist hours. The first trial runs had no such limits, and one sent a small band five hours later onto a main stage. That is why the limits exist. An agent run also stopped once on a broken reply from the free model, so a broken reply is now asked again up to twice.
