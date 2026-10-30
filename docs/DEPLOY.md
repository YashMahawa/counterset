# Hosting the public demo

The rules require a public demo. Counterset is one Python process with a native solver (OR-Tools CP-SAT) and SQLite, so it needs a host that runs a container or a Python server: Render, Railway, Fly.io, Google Cloud Run or Cloudflare Containers. Standard Cloudflare Workers and static hosts cannot run the solver.

Give it at least 2 vCPU and 2 GB of memory. With less, rescues still return, but the solver proves less in its time limit.

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
| `COUNTERSET_PUBLIC=1` | Open to anyone: hides other visitors' workspaces, turns off live Qloo calls and caps live agent runs. The Dockerfile sets it. |
| `GEMINI_FREE_API_KEY` | Needed only for "Run it live". Without it, "Watch the agent" still works, because it replays recorded decisions and re-runs every tool. |
| `AGENT_RUNS_PER_VISITOR_HOUR`, `AGENT_RUNS_PER_DAY` | Live agent caps. Defaults: 3 and 40. |
| `COUNTERSET_SOLVER_WORKERS` | Solver threads for a rescue. Default: 8. Set it to the vCPU count. |
| `MODEL_CALL_LIMIT` | Hard limit on model attempts, kept in `calls.jsonl`. Raise it for a public demo: one agent run uses about 12. |
| `QLOO_API_KEY` | Not needed on the public demo, because the examples carry their Qloo evidence. |

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
