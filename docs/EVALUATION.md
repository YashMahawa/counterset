# Evaluation: what the evidence does and does not show

Three questions, kept apart:

1. **Software correctness.** Does Counterset do what it says? Yes, within the tested scope. See [validation](VALIDATION.md).
2. **Proxy validity.** Is Qloo a sensible signal for "these acts share a crowd"? There is partial, mixed evidence, set out below.
3. **Usefulness.** Does it help a programmer or a fan? Not measured.

Optimising Qloo cues and then counting Qloo cues proves nothing about Qloo. Every comparison below therefore names the measure it uses, and the open-data lenses are reported both as alternative inputs and as alternative measures.

## Data

| Day | Source | Acts | Qloo coverage |
| --- | --- | --- | --- |
| Lollapalooza 2024 Saturday, 7 stages | Time Out Chicago full listing; all 11 Uproxx highlights agree. Kidzapalooza excluded. | 42 | 32 confirmed, 10 unresolved; 26 cues; 496 of 861 pairs ranked both ways |
| Pitchfork 2024 Friday, 3 stages | Pitchfork's published schedule | 14 | 13 confirmed; 12 cues |
| Crosswinds multi-arts rehearsal | Real performers, invented grid | 20 (12 music, 5 comedy, 3 podcasts) | 20 of 20 complete; 31 cues, 14 across kinds |

Identity rule: confirm only an exact-name top match whose tags fit the billed performer. Dasha and Xandra matched names, but their tags contradict the billed performers, so they stay unresolved. "Future X Metro Boomin" uses the Metro Boomin entity, as declared.

Present-day Qloo associations are applied to 2024 timetables: this is a retrospective analysis, not a forecast. All production rules are hypothetical. They are listed in each example and shown in the app.

## Independent lenses

These come from open data and stay private:

- **MusicBrainz genres** (CC BY-NC-SA supplementary data): a weighted Jaccard over genre counts.
- **ListenBrainz similar artists** (CC0): the session-based top-100 list per artist.

Both use Qloo's reciprocal rule: each act must be in the other's top *k* within the bill, capped at a quarter of the ranked acts. Acts are matched by exact name only. One wrong MusicBrainz match (Romy → an author) is excluded.

### Coverage on the Lollapalooza bill

| Source | Acts it can rank | Pairs with any link | Reciprocal cues |
| --- | ---: | ---: | ---: |
| Qloo | 32 | 496 ranked both ways | 26 |
| MusicBrainz genres | acts with genre tags | n/a | 17 |
| ListenBrainz | 27 with lists | 11 of 861 (11 of the 351 pairs where both acts have lists) | 4 |

### Agreement

- **ListenBrainz:** three of its four reciprocal pairs are Qloo cues (TV Girl × Eyedress, Cannons × Leisure, Briston Maroney × Hippo Campus).
- **Genre:** only 4 of its 17 pairs are Qloo cues. The two signals mostly disagree.
- **A visible miss:** Qloo gives Four Tet and Skrillex no cues at all, although the genre lens pairs them (both electronic).
- **Popularity:** the number of cues per act is not driven by Qloo popularity on this bill (rank correlation −0.17 over 32 acts). On the small multi-arts bill, Taylor Swift has five cues, including #1 among three podcasts. With small kind groups the cap is 1, but a very popular act can still dominate a short list.

**Reading:** Qloo's distinctive advantage here is coverage. It ranks every confirmed pair, including small acts and other kinds of act, where public co-listening data is mostly silent. Where co-listening data does speak, it largely agrees. Accuracy against actual attendance is unknown.

## Do published grids already avoid these pairs?

A permutation test reassigns the same acts to the same published slots 20,000 times. If programmers deliberately separated a signal's pairs, the real grid should clash less than most random fills.

| Day | Signal | Pairs | Real-grid clashes | Random mean | Share of fills as good or better |
| --- | --- | ---: | ---: | ---: | ---: |
| Lollapalooza | Qloo | 26 | 3 | 2.82 | 69% |
| Lollapalooza | MusicBrainz genres | 17 | 2 | 1.83 | 73% |
| Lollapalooza | ListenBrainz | 4 | 1 | 0.43 | 94% |
| Pitchfork | Qloo | 12 | 0 | 0.66 | 49% |

None of the three signals shows evidence that these grids were arranged to keep the pairs apart. This could mean the programmers optimised other things (stage size, popularity, artist requests), or that none of these signals captures what they track. It does not validate Qloo, and it does not invalidate it. It does show that the earlier claim "the Pitchfork grid had zero clashes" was uninformative: half of random fills do as well.

## What the evidence changes in a repair

### Undisturbed Lollapalooza grid

Both repairs remove all three Qloo clashes within 4 changed acts:

- **Fewest changed acts:** 3 acts, 130 minutes of total shift.
- **Closest start times:** 4 acts, 45 minutes.

### Hold sweep

Every stage, holds starting on a 30-minute grid from 13:00 to 21:00, 45 and 60 minutes long. The setup:

- sets that began before the hold are locked;
- the fewest-changed-acts preference;
- at most 4 changed acts.

Each hold is solved with Qloo cues and again without them (`scripts/sweep_holds.py`, no network).

| Measure | Result |
| --- | --- |
| Holds that touch at least one set | 232 |
| Proven infeasible under the hypothetical rules | 174 (75%). Every non-optimal case was a proven contradiction, not a timeout. |
| Feasible, all proven optimal | 58 |
| Qloo changed the repair | 49 of 58 |
| Mean Qloo clashes left (with / without Qloo) | 1.34 / 2.95 |
| Mean changed acts (with / without Qloo) | 2.86 / 1.38 |
| Blind repair created a new cue clash (beyond those already in the grid) | 1 of 58 |

**Reading:**

- On this day, the evidence mostly works by also fixing clashes the published grid already had, which costs about 1.5 extra moved acts on average.
- Disruptions rarely create new cue clashes, because cues are sparse (26 of 496 ranked pairs).
- The infeasible share says the hypothetical rules (same-size stages, 22:00 curfew, packed lanes, 4-move budget) leave little slack. Real festivals answer this by shortening or dropping a set, which Counterset deliberately does not do without a person. That option is the main product gap.

### The demonstrated scenario

The scenario was chosen to illustrate the product and is disclosed as such: Bacardi hold 17:15–18:15, Ethel Cain no earlier than 18:00, at most 4 changed acts.

| Schedule | Valid | Changed acts | Total shift | Qloo clashes | Genre clashes | ListenBrainz clashes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Current grid | no (hold, Ethel Cain) | 0 | 0 | 3 | 2 | 1 |
| Qloo + solver | yes | 3 | 165 | 1 | 2 | 0 |
| No audience evidence | yes | 2 | 180 | 2 | 2 | 0 |
| MusicBrainz genres + solver | yes | 2 | 180 | 2 | 2 | 0 |
| ListenBrainz + solver | yes | 2 | 180 | 2 | 2 | 0 |
| LLM only (Gemini 3.5 Flash Lite, high thinking) | yes | 2 | 180 | 2 | 2 | 0 |

**Reading:**

- Qloo is the only input that changes this repair: it keeps Romy × Ethel Cain apart, each other's #1 of 31.
- Under the independent ListenBrainz measure every repaired schedule scores 0. ListenBrainz says nothing about Romy × Ethel Cain, so by that measure Qloo's extra move buys nothing measurable.
- The genre and ListenBrainz solvers tie "no evidence" because their pairs either were not at risk or could not be moved within the rules.
- The LLM-only schedule was valid but ended exactly where the no-evidence solver did, so it added no audience reasoning in this case.
- Infinity Song × Friko stays clashing in every repair because both had started before the hold.

## Kill or revise

- If programmers who review blind proposals do not prefer Qloo-protected moves over minimal moves, the default should become "closest start times without cues", with Qloo as an audit only.
- If attendee must-see data were available, it should replace Qloo cues. The solver already ranks it first.
- If a larger set of real grids shows co-listening data with similar coverage, the coverage argument weakens.

## Not measured

- Attendance or satisfaction.
- Acceptance by a real programmer.
- Grids larger than 42 acts. The cap is 50; rows of 31 candidates are verified.
- Cross-kind coverage beyond the five tested people and three podcasts.
- Stability over time. Six order controls passed on one day, which says nothing about drift.
