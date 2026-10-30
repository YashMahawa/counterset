# Counterset

**The rescue desk for festival days.** On 14 June 2026 a storm closed Bonnaroo for hours and 11 sets were cancelled. Counterset is an agent for the programmer holding the radio at that moment. It reads the message, works the timetable with a solver, uses Qloo to decide whose crowd is at stake, and hands a person a plan to approve.

Replaying that Sunday on the real timetable, with a midnight finish and sets allowed to shrink to 75%:

| | Sets played | Cancelled or dropped | Shared-crowd clashes |
| --- | ---: | ---: | ---: |
| What really happened (reconstructed from press reports) | 17 of 28 | 11 | 1 |
| Counterset, same closure, full-length sets only | 24 of 28 | 4 | 0 |
| **Counterset, sets may shrink to 75%** | **27 of 28** | **1** | **0** |
| Counterset, sets may shrink to 50% | 28 of 28 | 0 | 0 |
| The same 75% rescue with Qloo removed, in the recorded run | 27 of 28 | 1, a far bigger draw | 1 |

This shows what was open, not what the festival should have done. It assumes every act was still on site and willing to play a shorter set, and the people there knew things this cannot, such as crew hours, mud and flights. The full list of assumptions is below and in the app.

## Use it

**https://counterset-5e45c193.agichaos.dev** (no sign-in). If it has been idle, the first visit takes up to a minute to wake.

1. **Bring your day.** Press **Start with your lineup** and paste a festival day, or keep the sample and press **Build my day**. CSV files and spreadsheet rows work too. Qloo finds each act live and you check the matches.
2. **Read the crowds.** Press **These look right**. Qloo ranks your bill live, and the timetable shows who shares a crowd and who clashes.
3. **Fix it by hand.** Drag a set to another time or stage. The audit answers as soon as you drop it, and **Undo** puts it back. Press **Edit the lineup** to change the bill as text.
4. **Break the day.** Open **The agent**, say what went wrong, such as “Sutro stage is closed 17:30 to 18:30”, and press **Run it live**. The real model chooses tools and the solver answers each try, in about a minute on a small lineup.
5. **Decide and send.** Press **Without Qloo** to see the same rescue with Qloo removed. Press **Approve**: the validator rechecks the plan and saves a numbered version. You then get a timetable link to share, a CSV and a drafted message for each affected act.
6. **Come back later.** **Your days** lists your days in this browser. Every day has its own link.
7. **See the real storm.** On the public page, make the two choices under **Could more sets have played that Sunday?**, or press **What really happened** to compare. **Run it live** works on that day too, in about 4 minutes on this small server. **Watch the agent** shows one saved run in about 20 seconds, labelled as saved.
8. **From any MCP client,** add `/mcp` and call `rescue_day`.

### How the API keys are protected

- The Qloo and Gemini keys are secret settings on the host. They are not in the code, the browser, the logs or any response. Calls send them in headers, so they never appear in a URL.
- The browser only ever talks to this server, and the server only calls an allowlist of Qloo paths and two named Gemini models.
- Every route that spends a key has an hourly limit per visitor and a daily limit across all visitors. A visitor is identified by the address Cloudflare reports, because `X-Forwarded-For` can be forged.
- Worked examples carry their recorded rows, so they do not read Qloo again. Other websites cannot make a visitor's browser call the API, because writes need a custom header and a matching origin.
- The Gemini key is a free-tier key, so it cannot run up a bill, and Google may use what it receives to improve its products. The interface says not to paste anything confidential.
- If a limit is reached, the visitor is told and the solver and audit keep working.

This free server is small: a tenth of a CPU core, and it restarts after 15 idle minutes. A restart clears the server's disk, including approved versions and its running totals of calls. Your browser keeps a copy of your own lineup and brings it back, and a shared timetable link holds its own data, so it keeps working. For lasting use, run it on your own server.

## What judges are scoring

| Criterion | Where to look |
| --- | --- |
| **Technological implementation** | A tool-calling agent over a constraint solver (OR-Tools CP-SAT), with a separate pure-Python validator that recounts every rule and objective. 68 tests, including brute-force checks of the solver. Qloo is used through three endpoints: see [Exactly how Qloo is used](#exactly-how-qloo-is-used). |
| **Design** | One flow, from a pasted lineup to an approved version and a shared timetable. One look across the site, with a single top bar and logo. The timetable moves as the agent works. Plain language throughout, with the technical detail one click away. Works at phone width and with reduced motion. |
| **Potential impact** | A specific person (the festival programmer) and a recurring problem: [seven festivals were hit by weather in 2026 that we found in the press](#why-this-problem). A real day, real timetable and real cancellations, with the limits stated. |
| **Quality of the idea** | Taste data used to schedule, not to recommend. Qloo decides which sets must not play at once and which set to lose first, across music, comedy and podcasts. Every result can be compared with the same solver without Qloo, and the app says when Qloo changed nothing. |

## Why this problem

Clashes are the complaint every festival programmer knows, and a storm forces the whole timetable to be redone in minutes. In 2026 alone, weather disrupted [Stagecoach](https://www.billboard.com/music/music-news/stagecoach-evacuation-high-winds-resume-1236231566/), [Welcome to Rockville](https://sflinsider.com/2026/05/16/lightning-delays-late-nights-and-a-legendary-weekend-at-welcome-to-rockville-2026/), [Primavera Sound and Governors Ball](https://www.pastemagazine.com/music/bonnaroo/11-sets-canceled-on-final-day-of-bonnaroo-2026-due-to-adverse-weather-conditions), [Bonnaroo](https://stereogum.com/2502293/bonnaroo-2026-weather-wipes-out-11-sunday-sets-including-aly-aj-for-a-second-straight-year/news), [Elements](https://edmidentity.com/2026/08/07/elements-festival-2026-lightning/) and [Head Trip](https://kesq.com/news/top-stories/2026/10/10/head-trip-adjusts-set-times-due-to-expected-lightning/). When Bonnaroo lost its Sunday afternoon, Aly & AJ wrote: “We know so many of you were waiting in the mud to hear us play.”

The same desk also audits a timetable before it is published. [Promoters are already advised](https://www.ticketfairy.com/blog/2025/08/24/fairness-in-festival-scheduling-protecting-fans-from-painful-clashes/) to avoid scheduling shared followings against each other, and press coverage of [Outside Lands](https://sfist.com/2026/07/30/outside-lands-set-times-revealed/) and [Riot Fest](https://lambgoat.com/news/54213/riot-fest-share-daily-schedules-for-2026-fans-complain/) shows fans notice when they don't. On the published Lollapalooza 2024 Saturday, Counterset finds three shared-crowd clashes and removes them all by moving three acts.

## How the agent works

A model reads the message and chooses tools. Code decides what is true.

| Tool | What it does | Who computes the answer |
| --- | --- | --- |
| `close_site`, `close_stage`, `limit_act` | Record a closure or an act's limit. Each must quote the message word for word, or it is refused. | Controller |
| `audit` | Which sets now break a rule, and which shared-crowd pairs clash. | Validator |
| `try_rescue` | Solve the day under stated terms: finish time, how far sets may shrink, whether sets may drop. | CP-SAT, rechecked by the validator |
| `compare_without_qloo` | Solve the same rescue with all Qloo signals removed, and name what changed. | CP-SAT and the validator |
| `compare_as_run` | Score what really happened, on the same terms. | Validator |
| `why_they_share_a_crowd` | Qloo's ranks for a pair and the taste tags their crowds share. | Qloo evidence |
| `finish` | Hand over a recommendation. Refused until the comparisons above have run. | Controller |

In the recorded run, the model tries full-length sets with no drops and is told no schedule fits. It tries 75% and fails again, so it allows drops and works down from full length to 85%, 75% and 60%. It stops when a further step saves nothing, checks itself, and recommends.

**What the model cannot do:**

- Invent a schedule. It names terms; only the solver produces placements.
- State a number that was not computed. Its summary is checked against the tool results, and a failing summary is replaced by a computed one, with the reason shown.
- Extend a hard stop, or follow an instruction hidden in the message.
- Change anything. A finished run is a proposal. A person approves it, and the validator runs again first.

If the model fails, nothing is applied and the app says why. “Watch the agent” needs no model at all, so the demo survives an exhausted quota.

## Exactly how Qloo is used

Every Qloo call is server-side, spaced, counted, capped per visitor and cached. A visitor's lineup is looked up and ranked live; the worked examples keep only derived ranks and tag names. Raw responses are never published, and the repository holds no Qloo data.

| Endpoint | Parameters | What it decides |
| --- | --- | --- |
| `GET /search` | `query`, `types` (`urn:entity:artist`, `urn:entity:person` or `urn:entity:podcast`), `take` | Who each billed act is, and Qloo's `popularity` for it. A person confirms each identity; an act that cannot be confirmed stays **unknown, never zero** (11 of the 28 acts on this bill). |
| `GET /v2/insights` | `filter.type`, `signal.interests.entities` (one act), `filter.results.entities` (exactly the bill), `take` | One response per act and kind of act ranks the rest of the bill. Two acts that each rank the other in their top *k* share a crowd. Ranks are read inside one response and never compared across responses. One reversed-order request is a stability check. |
| `GET /v2/analysis/compare` | `a.signal.interests.entities`, `b.signal.interests.entities`, `take` | The taste tags two crowds share, so a person can see why a pair counts and overrule it. |

**Remove Qloo and the behaviour changes.** Shared-crowd pairs disappear, so the solver no longer keeps those acts apart, and popularity disappears, so a dropped set is whichever its search reaches. Every option in the app is solved a second time this way, so a judge can see the difference. In the recorded run, the rescue without Qloo has 1 more clash and drops Japanese Breakfast (Qloo popularity 99%) in place of Little Stranger (48%).

## What is measured and what is not

Full method in [docs/EVALUATION.md](docs/EVALUATION.md).

- **The Bonnaroo replay.** Published set times from two sources, reported cancellations from Stereogum and Pollstar, and revised headliner times from Billboard. The as-run grid is partly reconstructed, and it breaks none of the rules we model, which is a consistency check on those rules, not a verdict on the day.
- **Proof.** The solver reports what it proved. In the 75% rescue, sets dropped and shared-crowd clashes are proven best; minutes shortened and sets moved are the best found in the time allowed. The app says which is which.
- **Independent data.** On Lollapalooza, three of ListenBrainz's four reciprocal pairs are also Qloo pairs, and Qloo ranks 496 pairs where that data links 11. Genre tags mostly disagree with it.
- **Press clashes.** We set a test before fetching any data: do the clashes the press named at Outside Lands 2026 rank high on Qloo? They did not stand out: 3 of 8 testable pairs sit in the stronger half, in a small sample from one article. So Qloo's strength here is coverage, not proof that it matches what fans complain about. See [docs/EVALUATION.md](docs/EVALUATION.md).
- **Not measured.** Attendance or satisfaction, whether a real programmer prefers these plans, and whether acts would accept shorter sets.

### What the Bonnaroo replay assumes

- Site closed 13:00–17:15. Reports put the evacuation at 14:00–14:15, but sets due from 12:30 were also cancelled, so the replay treats them as unplayed.
- Soupless is not on the reported cancelled list, so it counts as played.
- Midnight finish, because Noah Kahan's revised set ended at midnight.
- Changeover per stage equals its shortest published gap: What and Which 45 minutes, This and That 30, Other 15.
- Acts may move only between stages of a similar size: What and Which, This and That, Other alone.
- Every act was still on site and willing to play a shorter set. This is the largest assumption.
- No set starts earlier than its published time, and Noah Kahan starts no earlier than 22:30, his revised start on the day.
- Noah Kahan, Kesha and Modest Mouse play in full.
- If a set must go, the lowest Qloo popularity goes first. An act Qloo cannot identify counts as middling, except Role Model, whose Qloo entity is a different act: that evening What Stage slot carries a programmer's estimate.
- The sample message is written from press reports. The festival's own radio traffic is not public.

## Run locally

Python 3.12 is tested.

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.lock.txt
```

```bash
cp .env.example .env
```

Edit `.env` so `QLOO_ENV_FILE` and `GEMINI_ENV_FILE` point at files holding your keys. Keys are read server-side only and are never sent to the browser, logged or cached.

```bash
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8877
```

Open http://127.0.0.1:8877. The API contract is at `/api/docs`.

### Worked examples

Qloo's raw responses are not published, so a fresh clone has no worked days. Rebuild them into the ignored `.private/` folder:

```bash
.venv/bin/python scripts/build_bonnaroo.py
```

```bash
.venv/bin/python scripts/precompute_rescue.py
```

```bash
.venv/bin/python scripts/record_agent.py
```

`build_bonnaroo.py` needs `.private/bonnaroo/search.json`, written by the identity search it documents, and uses about 60 Qloo calls. `build_lolla.py`, `build_pitchfork.py` and `build_rehearsal.py` build the other days. Without any of these, the studio still works: open the blank rehearsal day, confirm identities and query your own bill.

To host it, see [docs/DEPLOY.md](docs/DEPLOY.md).

### Models

`gemini-3.5-flash-lite` runs the agent and `gemma-4-31b-it` is selectable for reading messages, both through the Gemini API with high thinking. There is no silent model switch. Everything except the live agent, message reading and briefings works without a model.

## Use it from another agent

Counterset is an MCP server at `POST /mcp`, with four tools: `list_days`, `audit_day`, `rescue_day` and `why_share_a_crowd`. They read recorded Qloo evidence, run the real solver, and change nothing.

```bash
curl -s -X POST http://127.0.0.1:8877/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"rescue_day","arguments":{"day_id":"bonnaroo-2026-sunday","closed_from":780,"closed_until":1035,"curfew":1440,"shortest_percent":75,"allow_drop":true}}}'
```

## Tests

```bash
.venv/bin/python -m pytest -q
```

Real-click browser walkthrough at desktop and phone width (needs Playwright on `NODE_PATH`, Chrome at `CHROME_PATH` and a running server):

```bash
node scripts/browser_test.cjs
```

## Layout

`app/domain.py` facts and schemas · `evidence.py` exact-bill rows, ranks, unknowns · `solver.py` lexicographic CP-SAT and conflict reduction · `repair.py` rescue terms, options and the without-Qloo run · `validator.py` independent recount · `desk_agent.py` the rescue agent · `agent.py` message reading and briefings · `mcp.py` the MCP server · `providers.py` server-only calls, cache, quotas · `main.py` versioned API · `web/` public page and studio.

Docs: [architecture](docs/ARCHITECTURE.md) · [evaluation](docs/EVALUATION.md) · [validation](docs/VALIDATION.md) · [hosting](docs/DEPLOY.md) · [other entries](docs/LANDSCAPE.md) · [design review](docs/DESIGN_REVIEW.md) · [submission text and demo script](docs/SUBMISSION.md).

License: MIT for the application source. Albert Sans keeps its SIL Open Font License, and the photographs keep their CC BY-SA 4.0 licences, credited on the page. No claim is made to artist names, festival data or Qloo data. Not affiliated with Bonnaroo, Lollapalooza, Pitchfork, Qloo or any performer.
