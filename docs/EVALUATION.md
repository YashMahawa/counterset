# Evaluation: what the evidence does and does not show

Three questions, kept apart:

1. **Software correctness.** Does Counterset do what it says? Yes, within the tested scope. See [validation](VALIDATION.md).
2. **Proxy validity.** Is Qloo a sensible signal for "these acts share a crowd"? The evidence is partial and mixed. Coverage is its clear advantage. The one test against press complaints did not support the claim.
3. **Usefulness.** Does it help a programmer or a fan? Not measured.

Optimising Qloo pairs and then counting Qloo pairs proves nothing about Qloo. The "0 clashes" in every rescue below is what the solver was told to achieve, so it shows the solver obeyed the signal, not that the signal is right. Every comparison names the measure it uses.

## The Bonnaroo replay

With the real timetable and the real closure, 27 of 28 sets fit if sets may shrink to 75%, against 17 played on the day. This shows what was open under stated assumptions. It does not show what the festival should have done, and it says nothing about attendance.

### Data sources

| Input | Source | Limit |
| --- | --- | --- |
| Timetable: 28 sets, five main stages | festiplannr, cross-checked against inmusicblog (`scripts/sources/bonnaroo-2026-sunday.txt`) | Published times, before the day |
| Cancellations: 11 sets | Stereogum, Pollstar, MTSU Sidelines | Press reports |
| Revised headliner times | Billboard | Three acts only |
| As-run grid | Reported cancellations, the three confirmed headliner times, and the reported one-hour push applied to the rest | Partly reconstructed: 16 played sets sit exactly 60 minutes after their published time, and Soupless stays at 12:30 |
| Who shares a crowd | Qloo `/v2/insights`, ranked within this exact bill | 17 of 28 acts identified. 17 shared-crowd pairs. 136 of 378 pairs ranked both ways, 242 unknown. The reversed-order check passed |
| Which set goes first | Qloo popularity from `/search` | A percentile from Qloo, not a crowd count. 11 acts have no usable identity |
| The message the agent reads | Written by us from press reports | The festival's radio traffic is not public |

The 11 unidentified acts: Role Model and Daily Bread matched acts whose tags do not fit the billed performer; Nat Myers, Buffalo Traffic Jam, Girl Tones, Audrey Hobert and A Hundred Drums had no exact match; Fcukers, Soupless, MOTIFV and LSZEE were not in the search results.

### Terms against results

Each row comes from solves of up to 20 seconds, stored in the example and served to the public page. "Saved" counts the 11 sets cancelled on the day that now play. "Clashes" counts ranked shared-crowd pairs overlapping by more than 10 minutes. "Without Qloo" solves the same terms with the shared-crowd pairs removed and popularity kept; see [Qloo's effect](#qloos-effect).

| Finish | Shortest set | Played | Saved | Dropped | Minutes shortened (sets) | Moved | Clashes | Clashes without Qloo |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 00:00 | full | 24 | 8 | Little Stranger, Spacey Jane, Fcukers, MOTIFV | 0 (0) | 14 | 0 | 3 |
| 00:00 | 85% | 25 | 8 | Little Stranger, Spacey Jane, MOTIFV | 40 (8) | 17 | 0 | 2 |
| 00:00 | 75% | 27 | 10 | Little Stranger | 145 (12) | 26 | 0 | 2 |
| 00:00 | 60% | 27 | 10 | Little Stranger | 145 (12) | 25 | 0 | 0 |
| 00:00 | 50% | 28 | 11 | none | 235 (11) | 27 | 0 | 1 |
| 00:30 | full | 25 | 8 | Little Stranger, Spacey Jane, MOTIFV | 0 (0) | 16 | 0 | 2 |
| 00:30 | 85% | 27 | 10 | Spacey Jane | 30 (6) | 21 | 0 | 4 |
| 00:30 | 75% | 28 | 11 | none | 130 (10) | 23 | 0 | 3 |
| 00:30 | 60% | 28 | 11 | none | 105 (7) | 26 | 0 | 2 |
| 00:30 | 50% | 28 | 11 | none | 105 (6) | 25 | 0 | 0 |
| 01:00 | full | 27 | 10 | Little Stranger | 0 (0) | 19 | 0 | 3 |
| 01:00 | 85% | 28 | 11 | none | 30 (6) | 22 | 0 | 3 |
| 01:00 | 75% | 28 | 11 | none | 30 (2) | 22 | 0 | 3 |
| 01:00 | 60% | 28 | 11 | none | 30 (2) | 22 | 0 | 2 |
| 01:00 | 50% | 28 | 11 | none | 30 (1) | 22 | 0 | 3 |
| As run | | 17 | | 11 cancelled | 0 (0) | 16 | 1 | |

Every row's schedule was passed back through the independent validator under that row's terms on 30 October. All 15 passed and the counts matched.

**Reading the table:**

- **The cost is large.** The 75% rescue moves 26 of 28 sets and shortens 13. The day as run moved 16 and shortened none. A plan this disruptive may not be workable on a radio in minutes.
- **"Full length, 24 of 28" hides one swap.** That plan saves 8 of the 11 cancelled sets and drops Fcukers, which played on the day.
- **Zero clashes covers known pairs only.** Overlaps involving an unidentified act count as unknown, never as zero: 29 in the published grid, 16 as run, 33 in the 75% rescue. More sets playing means more overlaps nobody can score.
- **Identical rows are carried.** A schedule that fits stricter terms also fits looser ones, so the build carries the better result forward, along with its without-Qloo figure. At 01:00 and 50%, for example, the solve itself found 65 minutes shortened and no clash without Qloo. The row shows the carried 30 and 1.

Rows are time-limited, so minutes, moves and without-Qloo counts vary a little between runs. Rebuilt on the final solver on 30 October. Each row is recounted by the validator, and a looser row takes a stricter row's schedule if its own search did worse, because that schedule also fits the looser terms.

Without rescue terms the day does not fit. Full-length sets with no drops, and 75% with no drops, are both proven infeasible. This matches the earlier [hold sweep](#hold-sweep), where 75% of Lollapalooza holds had no solution by moving sets alone. That finding is why rescue terms exist.

### The agent's recorded run

Model: `gemini-3.5-flash-lite`, 12 model calls, 50,914 tokens, recorded on the final solver on 30 October. It closes the site, audits (16 of 28 sets break a rule, and 2 shared-crowd pairs clash in the published grid), then:

1. Full length, no drops: no schedule fits.
2. 75%, no drops: no schedule fits.
3. With drops at full length, 85%, 75% and 60%: 24, 25, 27 and 27 of 28.
4. It stops because 60% saves nothing more, and recommends 75%: 145 minutes shortened across 12 sets.
5. Without Qloo: 1 more clash, and Japanese Breakfast dropped in place of Little Stranger.
6. As run: 11 cancelled and 1 clash.

The recording holds the model's decisions, not the results, and every tool runs again on replay. Sets played held at 24, 25, 27 and 27 across six offline replays. The without-Qloo clash count and which set it drops can change between runs, because without popularity nothing decides between sets. In those replays the summary check also worked: when a solver change moved a figure, the model's stale summary was refused and a computed one shown.

This is one recorded run of one model on one message. Live runs have not been sampled.

### Qloo's effect

Qloo does two jobs here, and there are two ways of removing it.

| Counterfactual | Removes | Used by |
| --- | --- | --- |
| Pairs only | Shared-crowd pairs. Popularity still ranks drops. | The "Clashes without Qloo" column above (`scripts/precompute_rescue.py`) |
| Full | Shared-crowd pairs and popularity | The agent's `compare_without_qloo` and the studio's "Without Qloo" view (`app/repair.py`) |

Pairs only, across the 15 rows: the same number of sets plays in every row, and between 1 and 4 clashes appear where the Qloo plan has none.

Full removal at midnight, one 20-second solve each on the current solver:

| Shortest set | Dropped with Qloo | Dropped without | Clashes with / without | Minutes shortened with / without |
| --- | --- | --- | ---: | ---: |
| full | Little Stranger, Spacey Jane, Fcukers, MOTIFV | the same | 0 / 1 | 0 / 0 |
| 85% | Little Stranger, Spacey Jane, MOTIFV | the same | 0 / 2 | 40 / 40 |
| 75% | Little Stranger | Trombone Shorty | 0 / 2 | 145 / 130 |
| 60% | Little Stranger | Tedeschi Trucks Band | 0 / 3 | 145 / 130 |
| 50% | none | none | 0 / 1 | 235 / 235 |

Minutes at 75% and below are the best found, not proven.

**Reading:**

- Qloo changes which set goes only where one drop could fall on many acts. At full length and 85%, the same acts go either way.
- With Qloo, the 75% plan loses Little Stranger (popularity 48%) in every run. Those are Qloo's numbers, not crowd sizes.
- Without popularity every act ties, so the drop at 75% is arbitrary. It was Japanese Breakfast (99%) in the recording and all six 10-second replays, and in a 20-second solve before the solver change. It was Trombone Shorty (96%) in the 20-second solve after it. The recorded swap is one real outcome, not a stable result.
- Little Stranger goes first partly by construction. Unidentified acts count as 50%, so it sits two points below them. A different default could change the answer.
- Keeping pairs apart appears to cost minutes at 75% and 60%: 145 against 130. Neither figure is proven.
- A without-Qloo clash count is one sample, not a stable property. With nothing keeping the pairs apart, their overlap is whatever the search leaves. On the same terms at full length, pairs-only gives 3 and full removal gives 1. At 75% the replays gave 2, then 1.

### What is proven and what is best found

The solver works in order: sets dropped, popularity of what is dropped, must-sees (none entered), clashes, minutes shortened, sets moved, clash minutes, start shift. Each later step holds the earlier results fixed. "Proven" means proven inside this model and these assumptions.

Fresh 20-second solves at midnight, on the current solver:

| Shortest set | Proven | Best found, with the solver's lower bound |
| --- | --- | --- |
| full | everything | nothing left open |
| 85% | 3 dropped, the choice of drops, 0 clashes, 40 minutes, 17 moved | start shift 4,205 (bound 1,620) |
| 75% | 1 dropped, Little Stranger, 0 clashes | minutes 145 (bound 45). Time ran out before sets moved and start shift were searched, so 26 moved is simply what that plan has |
| 60% | 1 dropped, Little Stranger, 0 clashes | minutes 145 (bound 45), moved 25 (bound 15), start shift 4,735 (bound 1,960) |
| 50% | 0 dropped, 0 clashes | minutes 235 (bound 45), moved 27 (bound 16), start shift 5,070 (bound 2,215) |

So at 75%, "no plan under these rules plays more than 27 sets, and that plan need not clash" is proven. "145 minutes is the least shortening" is not, and a much smaller figure has not been ruled out. "26 sets moved" is not optimised in this run at all.

The stored table does not keep per-objective proof for the 00:30 and 01:00 rows. All but one of the 15 rows reads `FEASIBLE`, meaning at least one objective stayed unproven. Only midnight at full length reads `OPTIMAL`.

### Why solver runs differ

- **Rescues search with 8 workers under a time limit.** The seed is fixed, but a parallel search stopped by the clock does not repeat exactly. Ordinary repairs use one worker, which keeps them repeatable.
- **Only unproven objectives can move.** At midnight the sets dropped and the clashes were the same in every with-Qloo run we made. Minutes can move: before the solver change, three 10-second replays at 85% gave 40, 50 and 40, and a 20-second solve proved 40.
- **Time differs by surface.** The table solves for up to 20 seconds, the desk's agent for 10 per step. At 60% on the current solver, 10 seconds gave 150 minutes and 20 seconds gave 145. A busy machine has the same effect as less time.
- **Stored and live figures can disagree.** The public page reads the stored table and the desk solves live. A recorded summary is checked against the live results. If its numbers no longer appear there, a computed summary replaces it and the reason is shown.
- **Changing the solver changes the search,** even where the rules stay the same, as the replays above show.
- **Without-Qloo figures vary most,** because nothing in the search holds them still, and because the two counterfactuals differ.

### The as-run check

The audit passes: `site_hold` at 13:00–17:15, then `apply_scenario` with a midnight curfew and drops allowed, then `as_run_audit`, returns no errors (rerun 30 October). It counts 11 cancelled and 1 clash. No played set starts before its published time or inside the closure.

The clash is Tedeschi Trucks Band × Big Gigantic, 60 minutes, ranks 2 and 3. Both were already published at 17:30, and the one-hour push kept them together.

This is a consistency check, not independent support. The terms were read from the same reconstruction:

- A reopening one minute later, at 17:16, breaks San Holo, who opens the reconstructed evening at 17:15.
- A finish at 23:55 breaks Noah Kahan, whose revised set sets the curfew.
- Without the replay's terms, the same grid reports 12 errors: 11 sets dropped without permission and Noah Kahan outside the published stage hours.

So the reconstruction does not contradict our rules. It cannot show whether the festival's decisions were sound or unsound, and the people there knew things this model cannot.

### Assumptions

- Site closed 13:00–17:15. Reports put the evacuation at 14:00–14:15, about three hours before reopening, but sets due from 12:30 were also cancelled, so the replay treats them as unplayed and closes the site earlier.
- Soupless is not on the reported cancelled list, so it counts as played.
- Midnight finish, because Noah Kahan's revised set ended at midnight.
- Changeover per stage equals its shortest published gap: What and Which 45 minutes, This and That 30, Other 15.
- Acts move only between stages of a similar size: What and Which, This and That, Other alone.
- Every act was still on site and willing to play a shorter set. This is the largest assumption.
- No set starts earlier than its published time.
- Noah Kahan starts no earlier than 22:30. At midnight every plan starts him at 22:30, as on the day. With a later finish the plans start him between 22:45 and 23:30, so "still closes at 22:30" holds only for the midnight rows.
- Noah Kahan, Kesha and Modest Mouse play in full.
- If a set must go, the lowest Qloo popularity goes first. An unidentified act counts as 50%, except Role Model, whose evening What Stage slot carries a programmer's estimate of 95%.
- Times move on a 5-minute grid. Two acts count as clashing when they overlap by more than 10 minutes on different stages.
- A shared-crowd pair needs each act in the other's top 3 within the bill.

## Press-clash test: Outside Lands 2026

**The claim, written into `scripts/press_clash_test.py` before any Qloo row for these bills was fetched:** among pairs of acts whose sets overlap by more than 10 minutes, the pairs [SFist named as painful](https://sfist.com/2026/07/30/outside-lands-set-times-revealed/) sit in the stronger half by Qloo's mutual rank. Mutual rank is the worse of the two within-bill ranks.

**Result: 3 of the 8 pairs that could be tested sit in the stronger half. The other 3 of the 11 named pairs could not be tested. This sample does not support the claim.**

| Day | Named pair | Mutual rank | Stronger pairs | Of | Percentile | Stronger half |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Fri | Charli xcx × Modest Mouse | 11 | 11 | 13 | 15 | no |
| Fri | Charli xcx × Subtronics | 8 | 5 | 13 | 62 | yes |
| Sat | The Strokes × The xx | 1 | 0 | 13 | 100 | yes |
| Sat | The Strokes × PinkPantheress | 9 | 8 | 13 | 38 | no |
| Sat | The xx × PinkPantheress | 11 | 11 | 13 | 15 | no |
| Sat | The Strokes × Lane 8 | 11 | 11 | 13 | 15 | no |
| Sat | The xx × Lane 8 | 6 | 4 | 13 | 69 | yes |
| Sat | PinkPantheress × Lane 8 | 10 | 10 | 13 | 23 | no |
| Sun | RÜFÜS DU SOL × Death Cab for Cutie | | | | not tested | |
| Sun | RÜFÜS DU SOL × Baby Keem | | | | not tested | |
| Sun | Death Cab for Cutie × Baby Keem | | | | not tested | |

**Why Sunday is empty.** Qloo returned no usable affinity for RÜFÜS DU SOL, and no other Sunday row returned that act. All 12 Sunday rows therefore fail the completeness gate, which removes Death Cab for Cutie × Baby Keem as well. We did not rerun Sunday without RÜFÜS DU SOL: that would change the test after seeing the result.

**Caveats:**

- The sample is small and comes from one article by one outlet. It can show a tendency at most, and this one shows none.
- The six Saturday pairs share four acts, so they are not independent.
- Ties count in the named pair's favour, because only strictly stronger pairs lower its percentile. The result is below half even so.
- Identity here is an automatic exact-name top match, with no person confirming it. KI/KI, Malcolm Todd, it's murph, kwn, Kingfishr and Not for Radio went unresolved. None is in a named pair.
- The bills cover evening sets on five stages.
- The script's header says six named pairs. Its list holds eleven, and all eleven are reported here.

**Reading:** a writer's painful clash may mean two big names at once, or the writer's own taste, rather than a shared crowd. So this does not disprove Qloo as a crowd signal. It does mean we have no press evidence for it, and the strongest named result, The Strokes × The xx at rank 1 of 13, is one pair.

## Lollapalooza and the earlier evidence

Present-day Qloo associations are applied to 2024 timetables: this is a retrospective analysis, not a forecast. All production rules are hypothetical. "Cue" below means a shared-crowd pair.

| Day | Source | Acts | Qloo coverage |
| --- | --- | --- | --- |
| Lollapalooza 2024 Saturday, 7 stages | Time Out Chicago full listing; all 11 Uproxx highlights agree. Kidzapalooza excluded. | 42 | 32 confirmed, 10 unresolved; 26 cues; 496 of 861 pairs ranked both ways |
| Pitchfork 2024 Friday, 3 stages | Pitchfork's published schedule | 14 | 13 confirmed; 12 cues |
| Crosswinds multi-arts rehearsal | Real performers, invented grid | 20 (12 music, 5 comedy, 3 podcasts) | 20 of 20 complete; 31 cues, 14 across kinds |

Identity rule: confirm only an exact-name top match whose tags fit the billed performer. Dasha and Xandra matched names, but their tags contradict the billed performers, so they stay unresolved.

### Independent lenses

These come from open data and stay private. **MusicBrainz genres** (CC BY-NC-SA) uses a weighted Jaccard over genre counts. **ListenBrainz similar artists** (CC0) uses the session-based top-100 list per artist. Both follow Qloo's reciprocal rule, and acts are matched by exact name only.

| Source | Acts it can rank | Pairs with any link | Reciprocal cues |
| --- | ---: | ---: | ---: |
| Qloo | 32 | 496 ranked both ways | 26 |
| MusicBrainz genres | acts with genre tags | n/a | 17 |
| ListenBrainz | 27 with lists | 11 of 861 | 4 |

- **ListenBrainz:** three of its four reciprocal pairs are Qloo cues (TV Girl × Eyedress, Cannons × Leisure, Briston Maroney × Hippo Campus).
- **Genre:** only 4 of its 17 pairs are Qloo cues. The two signals mostly disagree.
- **A visible miss:** Qloo gives Four Tet and Skrillex no cues, although the genre lens pairs them.
- **Popularity:** cues per act are not driven by Qloo popularity on this bill (rank correlation −0.17 over 32 acts). On the small multi-arts bill, Taylor Swift has five cues, so a very popular act can still dominate a short list.

**Reading:** Qloo's advantage is coverage. It ranks every confirmed pair, including small acts and other kinds of act, where co-listening data is mostly silent. Where that data speaks, it largely agrees. Accuracy against attendance is unknown.

### Do published grids already avoid these pairs?

A permutation test reassigns the same acts to the same published slots 20,000 times. The app runs 4,000 fills with the same seed, so it shows 70% for the Lollapalooza Qloo row (69.7%) where this table shows 69% (69.5%).

| Day | Signal | Pairs | Real-grid clashes | Random mean | Share of fills as good or better |
| --- | --- | ---: | ---: | ---: | ---: |
| Lollapalooza | Qloo | 26 | 3 | 2.82 | 69% |
| Lollapalooza | MusicBrainz genres | 17 | 2 | 1.83 | 73% |
| Lollapalooza | ListenBrainz | 4 | 1 | 0.43 | 94% |
| Pitchfork | Qloo | 12 | 0 | 0.66 | 49% |

None of the three signals shows that these grids were arranged to keep the pairs apart. Programmers may have optimised other things, or none of these signals captures what they track. This neither validates nor invalidates Qloo.

### Repairing the undisturbed grid

Both repairs remove all three Qloo clashes within 4 changed acts. Fewest changed acts: 3 acts, 130 minutes of total shift. Closest start times: 4 acts, 45 minutes. Rechecked on 30 October.

### Hold sweep

Every stage, holds starting on a 30-minute grid from 13:00 to 21:00, 45 and 60 minutes long. Sets that began before the hold are locked, and at most 4 acts may change. Each hold is solved with and without Qloo cues (`scripts/sweep_holds.py`). Measured on 25 October, before rescue terms existed, and not rerun since.

| Measure | Result |
| --- | --- |
| Holds that touch at least one set | 232 |
| Proven infeasible under the hypothetical rules | 174 (75%) |
| Feasible, all proven optimal | 58 |
| Qloo changed the repair | 49 of 58 |
| Mean Qloo clashes left (with / without Qloo) | 1.34 / 2.95 |
| Mean changed acts (with / without Qloo) | 2.86 / 1.38 |
| Blind repair created a new cue clash | 1 of 58 |

**Reading:**

- Three in four holds could not be repaired by moving sets alone. Real festivals answer this by shortening or dropping sets, so we added those as rescue terms. Each is stated openly, and nothing changes until a person approves.
- The evidence mostly works by also fixing clashes the published grid already had, at about 1.5 extra moved acts on average.
- Disruptions rarely create new clashes on this day, because cues are sparse (26 of 496 ranked pairs).

### A disclosed scenario

Chosen to illustrate the product: Bacardi hold 17:15–18:15, Ethel Cain no earlier than 18:00, at most 4 changed acts. Qloo + solver: 3 changed acts, 165 minutes of shift, 1 Qloo clash, rechecked on 30 October. No audience evidence: 2 changed acts, 180 minutes, 2 Qloo clashes, also rechecked. The genre lens, the ListenBrainz lens and the LLM-only comparison measured earlier all matched the no-evidence result.

Qloo was the only input that changed this repair, keeping Romy × Ethel Cain apart, each other's #1 of 31. Under the ListenBrainz measure every repaired schedule scored 0, because ListenBrainz says nothing about that pair. By that measure Qloo's extra move bought nothing.

## Kill or revise

- If programmers reviewing blind proposals do not prefer Qloo-protected moves, the default should become closest start times, with Qloo as an audit only.
- If acts or production say a 75% set is rarely workable, the headline should move to the full-length row: 24 of 28.
- If attendee must-see data were available, it should replace Qloo pairs. The solver already ranks it first.
- If a larger press sample also finds no tendency, "shared crowd" should be described as Qloo's listening affinity and not as what fans feel about clashes.
- If a larger set of real grids shows co-listening data with similar coverage, the coverage argument weakens.

## Not measured

- Attendance or satisfaction.
- Whether a real programmer prefers these plans, or could use them in the time available.
- Whether acts would accept shorter sets, or were still on site.
- Crew hours, mud, flights and everything else the people there knew.
- Crowd overlap for the 11 unidentified acts at Bonnaroo.
- Whether 145 minutes is the least shortening at 75%. It is the best found.
- How live model runs vary. One recorded run was replayed; live runs were not sampled.
- Other storm days, or other closure times for this one.
- Whether press-named clashes track Qloo beyond one article and 8 testable pairs.
- Grids larger than 42 acts. The cap is 50.
- Cross-kind coverage beyond the five tested people and three podcasts.
- Stability over time. Order controls passed, which says nothing about drift.
