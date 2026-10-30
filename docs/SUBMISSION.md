# Submission text and demo script

## Tagline

On 14 June 2026 a storm cancelled 11 sets at Bonnaroo. Counterset is the agent for the programmer holding the radio: it rebuilds a broken day around what fans share, using Qloo, and a person approves.

## Description

### Inspiration

Bonnaroo lost its Sunday afternoon to lightning this year. The site closed for about three hours, 11 sets were cancelled, and most of the rest moved back an hour. Aly & AJ wrote: “We know so many of you were waiting in the mud to hear us play.” It was not unusual. In 2026, weather also disrupted Stagecoach, Welcome to Rockville, Primavera Sound, Governors Ball, Elements and Head Trip.

Whoever rebuilds that timetable has minutes, a radio and no way to see the options. We asked a plain question: with the real timetable and the real closure, how many of those sets could have played, and which fans would have had to choose?

### What it does

Counterset is a rescue desk for a festival day.

1. **It reads the message.** Paste what production said. The agent records each closure and limit, and every one must quote the message word for word.
2. **It tries the gentlest fix first.** Full-length sets with no drops, then shorter sets, then dropping sets. A constraint solver answers each try, and the agent relaxes one term at a time.
3. **It checks itself.** It solves the same rescue with all Qloo evidence removed and scores what the festival really did on the same terms. A separate validator recounts every rule.
4. **A person decides.** It writes a short recommendation and drafts a message to every affected act. It cannot approve or send anything.

Replaying Bonnaroo's Sunday with a midnight finish: 24 of 28 sets could have played at full length, against 17 on the day. With sets allowed to shrink to 75%, 27 of 28 could have played, with no shared-crowd clashes. With sets at half length, all 28. This assumes every act was still on site and willing to play less. It shows what was open, not what the festival should have done.

It is a working product, not a replay. Paste a lineup, and Qloo looks up and ranks it now. Drag sets and the audit answers at once. Tell the agent what went wrong and watch it work. Then approve, share the timetable and copy each act's message. The same desk audits a timetable before it is published, handles a single stage closing or a late flight, and works across musicians, comedians and live podcasts. It is also an MCP server, so another agent can call it.

### How we used Qloo

Qloo is what makes this a question about people rather than boxes. A solver treats every set alike. Qloo tells it who the sets are for, in three ways:

- **Who cannot be on at once.** Each act asks Qloo to rank exactly the other acts on the bill, through `/v2/insights` with `filter.results.entities`, one response per act and kind of act. Two acts that rank each other near the top share a crowd. Ranks are read only inside one response.
- **Which set to lose.** When a set must go, the lowest Qloo popularity goes first. In the recorded run, removing Qloo makes the same solver drop Japanese Breakfast (99%) in place of Little Stranger (48%), and leaves 1 more shared-crowd clash.
- **Why, in words a person can check.** `/v2/analysis/compare` gives the taste tags two crowds share.

Every option is solved a second time with Qloo removed, and the app names what changed, including when it changed nothing. An act Qloo cannot identify stays unknown, never zero: 11 of the 28 here, because a wrong match would mean a wrong answer.

### How we built it

- **Agent:** a model chooses tools one at a time in a bounded loop. It can only name terms; it cannot produce a schedule. Quotes must be exact, numbers in its summary must exist in the tool results, and it cannot finish until the comparisons have run. The recorded demo replays its decisions and re-runs every tool live.
- **Solver:** OR-Tools CP-SAT, solving in order of importance: sets dropped, which sets go, attendee must-sees, shared-crowd clashes, minutes shortened, sets moved. It reports what it proved and what is only the best found in the time allowed. When the rules cannot all hold, it names the ones in conflict.
- **Validator:** a separate pure-Python recount of every rule and objective. If it disagrees with the solver, the result is refused.
- **App:** FastAPI, SQLite versioning with stale-proposal checks, and vanilla JavaScript. 68 backend tests, including brute-force checks of the solver, and a real-click browser walkthrough at desktop and phone width.

### What we found, and what we didn't

- Reconstructing the day as it ran breaks none of the rules we model. That is a consistency check on our rules, not a verdict on the festival. The replay shows more options existed under our assumptions.
- On the published Lollapalooza 2024 Saturday, Counterset finds three shared-crowd clashes, and 70% of random fills of the same slots clash as little.
- Independent co-listening data mostly agrees with Qloo where it has anything to say, but Qloo covers far more: 496 pairs ranked, against 11 linked.
- A test we set in advance did not support Qloo as a predictor of complaints: of the clashes the press named at Outside Lands 2026, 3 of 8 testable pairs sit in the stronger half. It is a small sample from one article, and we report it anyway.
- Not measured: attendance, satisfaction, whether a real programmer prefers these plans, and whether acts would accept shorter sets. The largest assumption is that every act was still on site.

### What's next

A programmer reviewing these plans without being told which signal produced them, real attendee must-see data (which Counterset already ranks above Qloo when entered), and live availability from artist teams.

## Demo script (about 2 minutes)

1. **The storm (15 s).** Public page: “A storm took 11 sets.” Say the date and the place.
2. **Try it (25 s).** Press `00:00` and `Full`: 24 of 28. Press `75%`: 27 of 28. Press **Show what really happened**: 17. Read the sentence about assumptions aloud.
3. **Watch the agent (45 s).** Press **Or watch it rebuild that day**. Point at the first failures, then the relaxing. Each step is a real tool call, and the timetable moves.
4. **What Qloo changed (15 s).** Press **Without Qloo**. Name what it dropped, and the extra clashes.
5. **A person decides (10 s).** Open the drafted messages, then press **Approve**. Nothing changed until now.
6. **Your own lineup (20 s).** Press **Build my day**, keep the sample, and show Qloo finding the acts and ranking music against comedy live. Drag one set and read the audit change.

All production rules are assumed. No festival or performer is affiliated with the project.
