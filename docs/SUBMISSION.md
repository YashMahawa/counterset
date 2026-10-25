# Submission text and demo script

## Tagline

Every festival has clashes. Counterset uses Qloo to find the ones that split a crowd, and repairs the timetable around real production rules.

## Description (for Devpost)

### Inspiration

Clashes are the complaint every festival programmer knows: two acts whose fans overlap, on different stages at the same time. Programmers avoid them by memory and instinct, and on the day a storm hold or a late flight forces changes in minutes. Public music data barely helps: on the Lollapalooza 2024 Saturday bill, ListenBrainz's similar-artist lists connect 11 of 861 pairs. And no music dataset can say whether the comedian in the tent shares a crowd with the band on the main stage.

### What it does

Counterset is a clash desk for a booked festival day. The bill is fixed; only times and stages move.

1. **The bill.** Each act is matched to a Qloo entity and confirmed by a person. Acts that cannot be confirmed stay unresolved, and every pair involving them is reported as unknown, never as zero.
2. **Shared crowds.** Every act asks Qloo to rank exactly the other acts on the bill, one request per kind of act (musicians, comedians, podcasts). When two acts rank each other near the top, that pair is a cue. Select any thread to see both ranks, where each came from, and whether open data agrees.
3. **Audit the grid.** Counterset shows which cued pairs clash in the current grid, and compares the grid with 4,000 random fills of the same slots.
4. **Something changes.** Paste production's message. Gemma proposes typed constraints, each quoted word for word from the message. Nothing changes until you tick it; anything it cannot handle safely is handed back to a person.
5. **Choose a repair.** A constraint solver keeps every production rule and offers two options, fewest changed acts or closest start times. Each is solved a second time with all Qloo evidence removed, so you see exactly which pairs the evidence kept apart, or that it changed nothing. When nothing fits, Counterset lists the rules that conflict.
6. **Approve.** An independent validator recounts everything, and the schedule becomes a numbered, exportable version.

Each step is its own calm screen over the real workspace; Desk mode hides the guidance for returning users.

### How we built it

- **Qloo:** `/search` for identities; `/v2/insights` with `filter.type`, `signal.interests.entities` and `filter.results.entities` set to the bill, once per act and kind. Rows must return exactly the requested acts. Ranks are read only within a response and capped at a quarter of the acts of that kind. Reversed candidate order is the stability check. All calls are server-side, spaced, cached and counted.
- **Solver:** OR-Tools CP-SAT with lexicographic passes (attendee must-sees, Qloo cues, the chosen preference). Results are labelled OPTIMAL or FEASIBLE. Infeasible rule sets are reduced to an irreducible conflict.
- **Validator:** a separate pure-Python recount of every rule and objective. If it disagrees with the solver, the proposal is refused.
- **Agent:** Gemma 4 31B reads messages into at most five typed, quoted items. Gemini 3.5 Flash Lite writes optional briefings; any number not in the computed options replaces the briefing with a plain summary. Models cannot call Qloo, solve, approve or publish.
- **App:** FastAPI, SQLite versioning with stale-proposal checks, and vanilla JS with no build step. Strict CSP, 28 backend tests and a real-click Playwright walkthrough at desktop and phone widths.

### What we found

- On the published Lollapalooza 2024 Saturday grid, Qloo flags three cued pairs playing at the same time. TV Girl and Eyedress are each other's #1 of 31 and overlap for 45 minutes, and ListenBrainz co-listening links them too.
- The published grid is no more careful than chance: 70% of random fills clash as little. That says the slot pattern explains the grid, not that the festival ignored audiences.
- In a hypothetical lightning hold with a late artist, Counterset's fewest-changes repair moves 3 acts by 165 minutes in total. The closest-times repair moves 4 acts by 140. Without Qloo, the same repair would leave Romy and Ethel Cain head to head.
- On a rehearsal bill of musicians, comedians and live podcasts, 14 of 31 cues cross kinds of act.

### What's next

A festival programmer reviewing proposed moves without being told which signal produced them, and real attendee must-see pairs, which Counterset already ranks above Qloo when entered. Accuracy against attendance is not yet measured.

## Demo script (about 3 minutes)

1. **Public page (15 s).** Switch the hero timetable between Published, Option A and Without Qloo; the readout shows TV Girl × Eyedress and Romy × Ethel Cain apart or clashing. Open the clash desk.
2. **The bill (15 s).** Lollapalooza 2024 Saturday, 42 published sets on 7 stages. 32 identities confirmed, 10 left unresolved rather than guessed. Point to a dashed set: "unknown, never zero".
3. **Shared crowds (30 s).** Red threads join the clashing pairs. Select TV Girl × Eyedress: #1 of 31 both ways, from two separate responses, and ListenBrainz agrees. Mention the coverage: 496 pairs ranked, versus 11 linked by public co-listening data.
4. **Audit (20 s).** Three clashes in the published grid. Show the histogram: 70% of random fills do as well. "So the grid is not obviously careful, and there is room to repair."
5. **Something changes (35 s).** Read the hypothetical message with Gemma. Show three items: the Bacardi hold, Ethel Cain not before 18:00, and "don't touch what has started" handed back as needing a person. Tick two and apply. Eyedress turns hatched where it breaks the hold.
6. **Choose a repair (40 s).** Find repairs. Sets slide; outlines show where they were. Option A: 3 changed acts, 165 minutes. Option B: 4 acts, 140 minutes. Click "A without Qloo": Romy and Ethel Cain clash again. "That pair is the evidence's contribution here." Optionally ask for the briefing.
7. **Approve (20 s).** Approve A as v1. The validator re-runs and the CSV shows old and new slots.
8. **Cross-domain (15 s).** Open the multi-arts rehearsal: comedians and podcasts in the same graph as musicians. Note that it is illustrative.
9. **Close (10 s).** Desk mode for returning users. State what is not claimed: attendance effects are not measured yet.

All Lollapalooza production rules and the message are hypothetical. The festival and performers are not affiliated with the project.
