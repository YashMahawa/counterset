# Validation, 25 October 2026

Three separate questions, answered separately:

1. **Does the software do what it says?** Tests, real browser runs, live provider checks. This page.
2. **Is Qloo good evidence for the decision?** Coverage, agreement with open data, sensitivity. See [evaluation](EVALUATION.md).
3. **Does it help programmers or fans?** Not yet measured. See [evaluation](EVALUATION.md).

## Backend: 28 tests pass

`pytest -q` covers:

- **Evidence:** the coverage gate (missing, duplicate, self, non-finite, extra), rank ties widening a cutoff, incomplete rows becoming unknown, a failed order check disabling cues, cross-kind ranks staying inside their own response, the quarter-of-the-kind cap.
- **Solver:** exhaustive comparison on small instances for both preferences, attendee priority, locks, zero move budget, the intentional-pair exclusion, the cautious unknown policy, buffer and hold recounts. An infeasible window is reduced to exactly the one conflicting rule.
- **Repair:** a deterministic counterfactual in which the blind repair leaves a named pair clashing and the evidence-aware repair keeps it apart, plus identical options collapsing.
- **Audit:** the random-fill share is deterministic and bounded.
- **API:**
  - repair options and publication;
  - stale proposals refused after publication or after an identity change;
  - stale evidence (older than 14 days) blocks publishing;
  - same-origin and version checks;
  - cache-only evidence with no rows fails visibly and changes nothing;
  - message items stay pending until reviewed, with bad items rejected by the controller (an unknown act, and an injected "publish" instruction ignored);
  - re-review is refused;
  - a provider 503 applies nothing;
  - briefing numbers not in the computed facts are rejected;
  - an infeasible day returns a reduced set of conflicting rules and nothing publishable;
  - private examples load only by safe id.
- **Providers:** no paid-key fallback, retry on 500 without switching model, offline cache mode never calls the network, malformed or ambiguous constraint times rejected, after-midnight times roll forward.

One upstream Starlette/httpx deprecation warning is emitted and does not affect results.

## Browser: real clicks, desktop and phone

`scripts/browser_test.cjs` opens a fresh copy of the Lollapalooza example and clicks through all six steps:

1. review the bill;
2. load evidence and open a pair;
3. audit;
4. add a stage hold through the dialog, or with `COUNTERSET_MODEL=1` read the message with Gemma and apply the ticked items;
5. find repairs and switch to "A without Qloo";
6. approve option A as v1.

| Width | Motion | Result |
| --- | --- | --- |
| 1440 | normal | passed, no page errors, no horizontal overflow, bundled font loaded |
| 390 | normal | passed, no page errors, no horizontal overflow |
| 1440 | reduced motion | passed |
| 1440 | normal, real Gemma | passed: Gemma read the message |

Gemma proposed three items from the message:

- Bacardi on hold 17:15–18:15;
- Ethel Cain starts no earlier than 18:00;
- "Please don't touch anything that has already started", returned as unsupported for a person.

All three carried exact quotes.

After the redesign the walkthrough passed again at 1440, 390 and with reduced motion. The taste-skill inspector reports 0 failures for the studio (app rules) and the public page at 1440, 768 and 390; see [design review](DESIGN_REVIEW.md).

## Live providers (this build)

**Qloo:** 165 new successful calls (cumulative 407 of 5,000, including about 242 before this build). No failed Qloo request. Calls were spaced at least 13 seconds apart and every response was cached privately.

| Purpose | Calls |
| --- | ---: |
| Cross-kind probe: 4 comedian searches, 1 podcast search, artist→person, person→artist, person→person, artist→podcast | 9 |
| Lollapalooza identity searches | 42 |
| Lollapalooza exact-bill rows and order control | 33 |
| Multi-arts rehearsal searches, rows and control | about 76 |
| Extra reversed-order controls | 5 |

**What the probe and rows showed:**

- Comedian↔musician and artist→podcast rows return complete, finite scores.
- Every Lollapalooza row passed the gate.
- All six reversed-order controls (one in the snapshot plus five extra) returned identical scores (maximum difference 0.0).
- The multi-arts rehearsal is complete (20 of 20 rows).

**Models:** 12 attempts in total, 6 of them in this build, all with high thinking on the free project key:

- **Gemma 4 31B** read the message successfully after two HTTP 500 retries, all logged.
- **Gemini 3.5 Flash Lite** produced:
  - a briefing that passed the number check;
  - one LLM-only schedule that stopped with an incomplete response at the old 12,288-token limit (reported as a failure);
  - after the limit was raised, a complete LLM-only schedule that passed every hard rule.

No paid key, no other model and no fabricated result was used.

## Bugs found and fixed during validation

- Curfew was required to fit the closing set's changeover, which flagged every headliner as invalid. Now curfew binds the set's end only.
- A set starting exactly when a hold began was treated as already started and locked. Now only sets that began before the hold are locked.
- Infeasibility cores were OR-Tools' unreduced assumption sets (75 rules). They are now reduced by deletion to the rules that conflict.
- The hold block animated diagonally because its animation overrode its position transform. Holds are now positioned with left/top.
- The strict CSP blocked inline style attributes. Geometry is now applied through the CSSOM, and the CSP was kept.
- The LLM-only comparison failed at the token limit. The limit was raised, and incomplete responses now report their finish reason.

No customer, festival deployment, attendance effect or paid integration is claimed.
