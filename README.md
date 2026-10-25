# Counterset

Keep the acts. Fix the grid.

Counterset audits and repairs a festival timetable after the lineup is booked. Qloo supplies association cues over exactly the contracted artist catalogue. A constraint solver proposes a repair, a separate validator recounts its objectives and checks production rules, and a programmer approves an immutable version.

## Run locally

Python 3.12 is tested. Create an isolated environment and install the pinned requirements:

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# Edit .env to reference your Qloo env file and existing free-project Gemini env file.
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8877
```

Open http://127.0.0.1:8877 and choose **Open studio**. The API contract is at `/api/docs`.

The server reads `GEMINI_FREE_API_KEY` from the configured `GEMINI_ENV_FILE`. The supported models are `gemma-4-31b-it` and `gemini-3.5-flash-lite`, using high thinking. There is no paid-key fallback. Model calls are optional: evidence, optimization, editing, validation and export work without a language model.

Raw Qloo data, provider caches, call ledgers, SQLite state and configuration are private and ignored by Git. This repository does **not** contain credentials or recorded Qloo payloads. On the original workstation, those recordings have been imported privately. A fresh clone must resolve its artists in Evidence, confirm each search match, and query the lineup with its own Qloo key. Missing identities stay unscored. The UI never manufactures a demonstration graph.

For the existing research workspace only, `scripts/import_private_evidence.py /path/to/Qloo` imports the twelve existing rows into `.private/recorded.json` without copying a key. The rehearsal festival, slots, production constraints and broad genre labels are illustrative; the artists and privately loaded Qloo responses are real.

## Working flow

- Create a rehearsal day or import a `Day` JSON document. All times are local minutes after midnight. Cross-midnight values up to 2880 are supported by the data/solver; the current clock editor is intended for a single calendar day.
- Confirm artist identities, then load recorded evidence or query the current lineup. Live evidence requires one request per resolved artist plus one order-control request, conservatively spaced at least thirteen seconds apart. Successful responses are cached so a repeated job can reuse them.
- Inspect complete/incomplete rows and reciprocal within-row top-three ranks. Scores from different rows are never compared directly. Unknown pairs remain separate. A failed order check disables association edges for that snapshot.
- Add actual attendee must-see pairs if available, then set a move budget and request a repair. After weighted attendee conflicts and association conflicts, choose **fewest changed acts** or **closest start times**. The latter prevents a single large delay from automatically beating several short shifts. Intentional clashes and the cautious unknown policy are editable in the JSON facts.
- Inspect the changed placements. **Keep original** pins the act to its current draft placement. Edit a constraint, then re-solve. A model can extract a proposed time/lock constraint from a note, with an exact source quote; it cannot apply it.
- Approve a validated proposal. Publishing checks the current version and evidence hash, revalidates, creates an immutable record and makes that schedule the next draft baseline. Export JSON or CSV.
- A stage hold creates a new outage constraint and locks sets already started. It can make the day infeasible; the application never silently shortens sets or extends curfews.

## Why this is more than an LLM schedule

The model does not invent cultural measurements, approve artist matches or publish operational changes. Qloo supplies bounded evidence; CP-SAT enforces time/stage/changeover constraints; a separate pure-Python validator checks the result and objective counts. A feasible schedule and an optimal schedule have different labels. “Fewest changes” is scoped to the achieved higher-priority objectives within the selected budget, never an unsupported global claim.

The Compare screen runs a no-change reference, a declared-genre solver, the Qloo solver and an LLM-only schedule with the same facts and move limit. It independently checks operational validity. **Qloo cue reduction evaluates the Qloo objective itself; it is not proof of better fan experience or superiority over public similar-artist data.** Actual attendee preferences and programmer review are the next value tests. See [evaluation](docs/EVALUATION.md).

## Tests

```sh
.venv/bin/python -m pytest -q
```

Tests compare a small solver instance with exhaustive enumeration, check locks and priority ordering, unknown/intentional-pair rules, malformed coverage, validator errors, stale publication, same-origin mutations and pending model constraints.

Optional browser test: install Playwright in your tooling environment and expose it via `NODE_PATH`, set `CHROME_PATH` to Chrome, then run `node scripts/browser_test.cjs` with the server running. It exercises real clicks from new day through recorded evidence, repair, graph inspection and publish, and captures the interface at desktop/mobile widths. The original workstation uses its bundled Playwright runtime.

`scripts/smoke_live.py` performs explicitly bounded live checks, writing private results. It may use one Qloo request if not cached, one model note and two model schedule comparisons, plus bounded retries/native JSON fallback. It never prints a key. Do not run it as a routine unit test.

## Deployment boundary

Localhost is the default. Set a long `COUNTERSET_ACCESS_TOKEN` before exposing the server; the studio's Access token control stores it for that browser session. Use TLS at the reverse proxy. This is one protected producer workspace, not a multi-tenant service. In-memory jobs are marked retryable after a server restart; the private provider cache avoids repeating successful evidence calls.

The successful-call cap includes `QLOO_PRIOR_SUCCESS`, which must reflect previous use of the same key. The original workstation is configured with the previous approximately 213 successes and a total ceiling of 5000. Set `MODEL_CALL_LIMIT` to bound all model attempts. Retry behavior is limited; an unavailable provider produces a visible failure and never changes the schedule.

## Project layout

`app/domain.py`: facts and schemas. `evidence.py`: coverage and graph. `solver.py`: lexicographic CP-SAT. `validator.py`: independent checks. `agent.py`: bounded model tasks. `providers.py`: server-only calls/cache/quota. `store.py`: SQLite records. `main.py`: API and versioned controller. `web/`: landing page and working studio.

The public page uses the taste skill's borrowed-category direction, seed 468507280: a concert poster carrying the actual timetable. The four interface images are genuine screenshots of this application. There are no invented customers, testimonials or audience results. Font credits and licenses are in `web/assets/`.

License: MIT for application source. Third-party fonts retain their own licenses. No claim is made to ownership of artist names or Qloo data.
