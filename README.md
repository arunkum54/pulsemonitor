# Pulse — Uptime Monitor

A small full-stack app that periodically pings a list of URLs and shows whether each one
is up or down, along with response time and a short history trace.

```
/backend          Express API — registers URLs, pings them, confirms incidents, stores history
/frontend         React (Vite) dashboard — live status grid, polls the API every 5s
docker-compose.yml  Orchestrates both containers with a single command
DECISIONS.md      Trade-off reasoning and what breaks first past MVP scale
AI_LOG.md         AI collaboration log (tools, prompts, course corrections)
```

## 1-line setup

```bash
docker compose up --build
```

Then open:
- **Dashboard:** http://localhost:3000
- **API:** http://localhost:4000/api/urls

That's it — no `.env` files or manual DB setup required. The backend creates its SQLite
file automatically in a named Docker volume (`backend-data`) on first boot.

## How it works

- **Backend** (`/backend`) — Node.js + Express. A `node-cron` job pings every registered
  URL once a minute, with a 5-second timeout per request. Each check's HTTP status code,
  response time, region, and timestamp are stored in SQLite (Node's built-in `node:sqlite`
  module — no native compilation step, so it builds reliably in any container).

  Raw pings feed a two-layer **incident state machine** (`src/incidentState.js`, unit
  tested in `test/`):
  - **Per-region debounce** — a region only calls a URL "down" after 2 consecutive
    failures, so one slow response or dropped packet doesn't misreport a healthy service.
    A failed check schedules a fast follow-up in ~8s instead of waiting the full 60s cron
    cycle, so a real outage is still confirmed quickly.
  - **Cross-region quorum** — a URL-level incident only opens once a *majority* of
    reporting regions independently agree it's down. This also means one region's own
    network hiccup doesn't misreport the target as down. With a single region reporting
    (e.g. a single-instance deploy on a free tier), this correctly degrades to that
    region's own confirmed state — same function, no special-casing.

  **SSL expiry checking** (`src/ssl.js`) opens a raw TLS handshake (no HTTP request) to
  every `https://` URL and reads the certificate's expiry date, refreshed every 6 hours
  (certs don't change minute to minute) plus once immediately on registration.

  **Live activity feed** (`GET /api/events`, Server-Sent Events) pushes check results and
  incident open/resolve events to connected clients as they happen — see `DECISIONS.md`
  for why this uses push while the status grid uses polling.

- **Frontend** (`/frontend`) — React dashboard that polls `GET /api/urls` every 5 seconds
  and renders each monitored URL as a card: status dot (green/amber/red — amber means
  "confirming," not yet a reported outage), response time, rolling 24h uptime %, a
  sparkline, per-region status chips, an SSL-expiry badge, and a recent-incident summary.
  Below the grid, a live terminal-style **activity log** streams events from the SSE feed
  in real time. A read-only **public status page** at `/status` shows the same data
  without the add/remove controls, plus an overall "All systems operational" banner.

### Multi-region monitoring — what's real here vs. simulated

`docker-compose.yml` runs three genuinely separate OS processes sharing one database:
`backend` (region `us-east`, serves the API) plus `checker-eu` and `checker-ap`
(checker-only, no HTTP server — see the `ROLE=checker` branch in `src/index.js`). The
quorum logic, the per-region data model, and the process architecture are all real and
directly deployable as-is.

**What's honestly simulated in local dev:** all three containers still egress through
this one machine's network, so they don't see genuinely different regional network paths
the way real geographically-distributed checkers would. To make it real: deploy
`checker-eu`/`checker-ap` as separate services in actual different cloud regions (e.g.
Fly.io machines in `lhr`/`syd`, or Render/Railway services in different regions) — the
code doesn't change, only where it runs. The one thing that *would* need to change:
a Docker named volume only works because all containers share one host, so genuine
multi-host deployment means swapping the shared SQLite file for a networked DB (Postgres)
that every region's process can reach — see `DECISIONS.md`.

### API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/urls` | List all monitored URLs — confirmed state, per-region breakdown, 24h uptime %, incidents, SSL expiry |
| `POST` | `/api/urls` | Register a URL — body: `{ "url": "https://example.com" }` |
| `GET` | `/api/urls/:id/history` | Full recent raw check history for one URL (per region) |
| `GET` | `/api/urls/:id/incidents` | Confirmed outage history for one URL |
| `GET` | `/api/events` | Server-Sent Events stream of live check/incident events |
| `DELETE` | `/api/urls/:id` | Stop monitoring a URL |
| `GET` | `/api/health` | Backend liveness check |

### Running the tests

```bash
cd backend && npm install && npm test
```

Unit tests (Node's built-in test runner, no extra dependencies) cover the per-region
debounce logic, cross-region quorum consensus, and URL validation — the places where
getting the logic subtly wrong would be easy and hard to notice.

## Verifying up/down detection

This is the core thing to check — that the monitor correctly tells apart a healthy site
from an unreachable one.

1. Start the stack: `docker compose up --build` (this boots the API, two additional
   region checkers, and the frontend — four containers total)
2. Open http://localhost:3000
3. **Add a healthy URL:** paste `https://example.com` into the input and click **Add
   signal**. Within a few seconds it should show a **green pulsing dot**, label **up**,
   an HTTP 200 badge, a response time, and (since it's https) an SSL-expiry badge once the
   first SSL check completes. Watch the **activity log** panel below the grid — you'll see
   a live `check` line stream in as each region pings it.
4. **Add a broken URL:** paste something unreachable, e.g.
   `https://this-domain-does-not-exist-xyz123.com`, and click **Add signal**. It first
   shows **amber / "confirming"** — that's per-region debounce, not a bug (see
   `DECISIONS.md`). The `us-east` region confirms within ~10s; the `eu-west`/`ap-south`
   checkers confirm on their own next cron pass (up to ~60s) since they discover new URLs
   independently rather than being pushed one. Once at least 2 of the 3 regions agree,
   the card flips to a confirmed **red / down**, an "Ongoing incident" line appears, and
   you'll see an `incident_open` line in the activity log.
5. **Optional — reachable but unhealthy:** add a URL that returns a 4xx/5xx
   (e.g. `https://httpstat.us/500`) to see the monitor distinguish "server responded, but
   with an error" from "couldn't reach it at all."
6. **Public status page:** open http://localhost:3000/status — same data, read-only, with
   an overall "All systems operational" / "Partial system outage" banner at the top.

You can also verify directly against the API:

```bash
curl -X POST http://localhost:4000/api/urls -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

curl http://localhost:4000/api/urls
```

## Deployment sketch

For an MVP at this scale, the pragmatic path is a git-push deploy on **Render** or
**Railway** rather than managing cloud infra by hand:

- **Backend** → a Render **Web Service** (or Railway service) built from `/backend`'s
  Dockerfile, with a small persistent disk (Render) or volume (Railway) mounted at
  `/app/data` for the SQLite file. Scheduler runs in-process, so no separate worker is
  needed at this scale.
- **Frontend** → a Render **Static Site** (or Railway static deploy) built from
  `/frontend`, with `VITE_API_URL` pointed at the backend's public URL.
- Both platforms deploy straight from the GitHub repo on push — no IaC required for an
  MVP this size.

For teams that want infra managed as code instead, here's a hypothetical Terraform sketch
for AWS (illustrative only — not meant to be applied as-is):

```hcl
resource "aws_ecs_cluster" "pulse" {
  name = "pulse-uptime-monitor"
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "pulse-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  container_definitions = jsonencode([{
    name  = "backend"
    image = "<ecr-repo-url>/pulse-backend:latest"
    portMappings = [{ containerPort = 4000 }]
    mountPoints  = [{ sourceVolume = "data", containerPath = "/app/data" }]
  }])
}

resource "aws_ecs_service" "backend" {
  name            = "pulse-backend"
  cluster         = aws_ecs_cluster.pulse.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 1
  launch_type     = "FARGATE"
}

# Frontend: S3 + CloudFront for the static Vite build
resource "aws_s3_bucket" "frontend" {
  bucket = "pulse-frontend-static"
}
```

At this scale, swap SQLite for RDS Postgres only if you outgrow a single-instance
deployment — for "a few dozen URLs checked every minute," SQLite on a persistent volume
is genuinely enough.

## Local development (without Docker)

```bash
# backend
cd backend && npm install && npm run dev   # http://localhost:4000

# frontend
cd frontend && npm install && npm run dev  # http://localhost:5173
```

Requires Node.js 22.13+ (for the built-in `node:sqlite` module).
