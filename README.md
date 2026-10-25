# Counterset

The clash desk for festival programmers. Counterset asks Qloo how every act on a bill relates to every other act, including comedians and live podcasts, then repairs the timetable around real production rules so acts that share a crowd stop playing against each other. When something breaks on the day, an agent reads the message, a solver proposes repairs, and Counterset shows exactly what the Qloo evidence changed before a person approves a numbered version.

- **Keeps the bill.** Only start times and stages move, inside availability, changeovers, stage hours, curfews and locks.
- **Ranks exactly your bill.** One Qloo request per act and kind of act ranks the other acts of that kind on the bill. Ranks are read inside one response and never compared across responses.
- **Shows its counterfactual.** Every repair is solved a second time with all Qloo cues removed. The difference is named pair by pair, or the app says Qloo changed nothing.
- **Never guesses.** Unconfirmed identities stay unresolved. Their pairs are unknown, not zero. Infeasible rule sets are reported, reduced to the rules that actually conflict.

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

Open http://127.0.0.1:8877 for the public page and http://127.0.0.1:8877/studio for the application. The API contract is at `/api/docs`.

### Worked examples

Raw Qloo responses must not be published, so the repository ships no Qloo data. The example days are rebuilt into the ignored `.private/` folder:

```bash
.venv/bin/python scripts/build_lolla.py
```

```bash
.venv/bin/python scripts/build_rehearsal.py
```

`build_lolla.py` reads the committed public timetable in `scripts/sources/`, resolves identities with `/search`, applies the identity decisions in `.private/lolla/identity_decisions.json`, and fetches the exact-bill rows (about 75 calls the first time; cached after). `build_rehearsal.py` builds the music, comedy and podcast rehearsal day (about 80 calls). `build_lenses.py` adds the independent MusicBrainz and ListenBrainz lenses used by the evidence comparison. Without these files the studio still works: open the blank rehearsal day, confirm identities and query your own bill.

## Models

The server uses the existing free-project Gemini key (`GEMINI_FREE_API_KEY`) with `gemma-4-31b-it` (reads production messages) and `gemini-3.5-flash-lite` (briefings and the LLM-only comparison), both with high thinking. There is no paid-key fallback and no silent model switch. Everything except reading messages and briefings works without a model.

## Tests

```bash
.venv/bin/python -m pytest -q
```

Real-click browser walkthrough (needs Playwright on `NODE_PATH` and Chrome at `CHROME_PATH`; uses cached rows and no model calls unless `COUNTERSET_MODEL=1`):

```bash
node scripts/browser_test.cjs
```

## Layout

`app/domain.py` facts and schemas · `evidence.py` exact-bill rows, ranks, unknowns · `solver.py` lexicographic CP-SAT and core reduction · `repair.py` options and the without-Qloo counterfactual · `stats.py` random-fill audit · `validator.py` independent recount · `agent.py` bounded model steps · `providers.py` server-only calls, cache, quotas · `main.py` versioned API · `web/` public page and studio.

Docs: [architecture](docs/ARCHITECTURE.md) · [validation](docs/VALIDATION.md) · [evaluation](docs/EVALUATION.md) · [landscape](docs/LANDSCAPE.md) · [design review](docs/DESIGN_REVIEW.md) · [submission text and demo script](docs/SUBMISSION.md).

## Deployment boundary

Localhost by default. Before exposing the server, set a long `COUNTERSET_ACCESS_TOKEN` and put TLS in front. It is one protected workspace in one process, not a multi-tenant service. The Qloo success counter includes `QLOO_PRIOR_SUCCESS` for earlier use of the same key and stops at `QLOO_SUCCESS_LIMIT` (5,000 maximum).

License: MIT for the application source. Public Sans keeps its own SIL Open Font License. No claim is made to artist names, festival data or Qloo data. Not affiliated with Lollapalooza, Pitchfork or any performer.
