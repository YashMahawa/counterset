# Validation, 25 October 2026

## Backend

Sixteen tests pass. They cover exhaustive small-instance optimality for both repair preferences, locks, attendee priority, zero move budgets, infeasibility, stage exclusivity, malformed coverage, rank ties, unknown/intentional policies, independent recounts, stale publication, same-origin mutation checks, pending quoted constraints, explicit free-key configuration and bounded same-model retries.

The test runner emits one non-failing upstream Starlette/httpx deprecation warning. This is a local single-process application; no load or multi-tenant deployment claim is made.

## Live providers

- One fresh exact-catalogue Qloo client preflight returned eleven scored peers for the twelve-act rehearsal universe.
- A real published fourteen-act day was then checked with a bounded additional twenty-eight Qloo requests. Thirteen artist identities resolved; Black Duck remained unscored. All thirteen resolved rows passed the exact resolved-universe coverage gate. Twelve reciprocal cues were derived. This is thirteen of fourteen acts, so the full day is labelled PARTIAL.
- Total new successful Qloo calls for this build: **29**. The configured cumulative total is **242 / 5000**, including approximately 213 earlier successes.
- Gemma 4 31B with high thinking extracted the explicit 17:00 constraint as minute 1020, with the source quote, and left it pending approval.
- Gemini 3.5 Flash Lite with high thinking returned a valid twelve-act schedule under the same move budget. Its output left two Qloo cue overlaps; the constrained Qloo repair left zero. Both passed the hard-rule validator. These cue counts evaluate the declared graph objective, not independent fan benefit.
- Gemma's full schedule-comparison attempts encountered provider failures/timeout. No schedule result is fabricated for that arm. Bounded retries and visible failures are implemented. No model or paid-key substitution occurred.

Six model attempts were recorded during validation, including provider failures. Provider response details and generated schedules stay in the ignored private validation file. Both configured models use the existing free-project credential file from Recast.

## Real timetable and disruption

The source is the organizer's [published 2024 Pitchfork schedule](https://pitchfork.com/news/pitchfork-music-festival-2024-schedule-all-the-set-times-you-need-to-know/), Friday 19 July, America/Chicago. Published artist/start/end/stage facts are kept distinct from hypothetical availability, changeovers, stage curfews and locks. Present-day associations make this a retrospective analysis, never a historical forecast.

The original timetable already has zero overlaps among the derived cues. The optimum leaves it unchanged. A hypothetical Blue-stage hold from 18:15–19:00, with already-started sets pinned, makes the old grid invalid. Under the declared hypothetical constraints:

| Programmer preference | Changed acts | Total absolute start shift | Cue overlaps | Independent validator |
| --- | ---: | ---: | ---: | --- |
| Fewest acts | 1 | 135 minutes | 0 | Pass |
| Closest start times | 2 | 45 minutes | 0 | Pass |

Both are proven optimal for their respective declared objective hierarchies and move budget. They are reviewable alternatives, not a claim that either would be accepted by the real festival. The example is available from **Historical day** on the original workstation; raw provider data remains outside the repository.

## Browser and design

Chrome exercised real clicks through rehearsal creation, recorded evidence, repair, graph inspection, approval and immutable publication. The studio has no horizontal overflow at 390px, both local fonts load, and no JavaScript page errors occurred in that flow. Historical disruption/alternative-preference clicks are also exercised by the browser script; final results are in `.private/browser-results.json`.

The taste inspector measured the public page at 1440, 768 and 390px with **zero FAIL findings**. Headlines fit two lines. Four images are genuine application screenshots. Reduced-motion behavior is defined. The remaining no-footage warning is deliberate: the moving visual is the actual timetable capture; unrelated concert footage would imply a setting/customer relationship the product does not have. The source lint's clock zero-padding warning is valid time formatting. Screenshot review and final design score are in DESIGN_REVIEW.md.

## Remaining product evidence

Qloo's incremental usefulness over strong genre/public-similarity inputs and actual programmer acceptance still need evaluation. The real-day check establishes coverage and working mechanics; it does not establish attendance benefit. No customers, testimonials, paid integrations or deployed-festival outcomes are claimed.
