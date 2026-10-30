# Hosting the public demo

The rules require a public demo. Counterset is one Python process with a native solver (OR-Tools CP-SAT) and SQLite, so it needs a host that runs a container or a Python server: Render, Railway, Fly.io, Google Cloud Run or Cloudflare Containers. Standard Cloudflare Workers and static hosts cannot run the solver.

The live demo runs on Render's free tier, at a tenth of a CPU core and 512 MB, from a private copy of the code that includes `.private/examples`. Everything works there, tested at those limits: a small lineup takes about a minute and a live 28-set day about 4 minutes. With 2 vCPU the solver answers faster and proves more. Free services sleep after 15 idle minutes, so the first visit after that takes up to a minute.

## With Docker

Build on your own machine, because the image needs `.private/examples`:

```bash
docker build -t counterset .
```

```bash
docker run -p 8080:8080 -e GEMINI_FREE_API_KEY=your-key counterset
```

Keys go in the host's secret settings, never in the image or the repository.

## Hosts that build from a public repository

The repository holds no Qloo data, so a build from a clean clone has no worked examples. Upload `.private/examples` to the host as a mounted disk or secret file and set `COUNTERSET_PRIVATE_DIR` to its parent. Otherwise build the image locally and push that instead.

## Settings

| Setting | Meaning |
| --- | --- |
| `COUNTERSET_PUBLIC=1` | Open to anyone: hides other visitors' workspaces, and caps live Qloo calls and agent runs per visitor. Worked examples use their recorded rows. The Dockerfile sets it. |
| `COUNTERSET_SAVED_REPLAY=1` | For very small servers: “Watch the agent” shows the saved run and the validator rechecks its plan. |
| `AGENT_SOLVE_SECONDS` | Time for each agent solve. Default: 10. The small demo uses 20. |
| `QLOO_MIN_INTERVAL` | Seconds between Qloo calls. Default: 13. The demo uses 1. |
| `QLOO_CALLS_PER_VISITOR_HOUR`, `QLOO_CALLS_PER_DAY` | Live Qloo caps. Defaults: 90 and 1200. |
| `QLOO_PRIOR_SUCCESS`, `QLOO_SUCCESS_LIMIT` | Calls already used, and the total to stop at. Set these on a host with a temporary disk, because its ledger resets on restart. |
| `GEMINI_FREE_API_KEY` | Needed only for "Run it live". Without it, "Watch the agent" still works, because it replays recorded decisions and re-runs every tool. |
| `AGENT_RUNS_PER_VISITOR_HOUR`, `AGENT_RUNS_PER_DAY` | Live agent caps. Defaults: 3 and 40. |
| `COUNTERSET_UNLISTED=1` | Reachable by link only: sends `X-Robots-Tag: noindex` and a `robots.txt` that disallows everything. |
| `COUNTERSET_SOLVER_WORKERS` | Solver threads for a rescue. Default: 8. Set it to the vCPU count. |
| `MODEL_CALL_LIMIT` | Hard limit on model attempts, kept in `calls.jsonl`. Raise it for a public demo: one agent run uses about 12. |
| `QLOO_API_KEY` | Needed for “Try your own lineup”. Without it the worked examples still work from their recorded rows. |

## Check it before you submit

1. Open `/` in a private window and press a term in the replay: the timetable should move.
2. Open `/studio?day=bonnaroo-2026-sunday&watch=1` and let the agent finish, about a minute.
3. Press Approve, and download the CSV from the Approve tab.
4. Ask the MCP endpoint for its tools:

```bash
curl -s -X POST https://your-host/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

5. Make the repository public, and check that the licence and README show on its front page.

The server keeps state in `.private/counterset.sqlite3`. On a host with a temporary disk, workspaces reset on restart, which is fine for a demo because each visitor gets a fresh copy of the day.
