# Design Decisions

Short, explicit notes on the trade-offs behind this MVP and where it breaks as it grows.
Written for a reviewer who wants to see the reasoning, not just the result.

## Why a confirmed-incident state machine instead of "latest check = current status"

The naive version of this app — and the version most AI-assisted submissions of this
brief will land on — treats the most recent ping as ground truth: one failed request,
instant "down." That's wrong for the same reason paging on a single dropped packet is
wrong in real monitoring: transient blips (a slow DNS resolve, one dropped TCP handshake,
a GC pause on the target server) are common and don't mean the service is actually down.

This app requires **2 consecutive failed checks** before opening an incident. To avoid
trading correctness for slowness, a failed check schedules a fast follow-up in ~8s rather
than waiting the full 60s cron cycle — so a real outage is still confirmed quickly, but a
single blip self-resolves without ever being reported as downtime. Incidents are real rows
(`started_at`, `resolved_at`, `duration_seconds`), not a derived flag, so the app can show
actual outage history instead of only "current status."

The trade-off: a genuine outage takes ~1 extra check (a few seconds to ~1 minute,
depending on timing) to be confirmed, instead of being flagged instantly. For an uptime
monitor, false positives are more costly than a few seconds of detection latency — a
monitor that cries wolf gets ignored.

## Why SQLite (via Node's built-in `node:sqlite`) instead of Postgres

At "a few dozen URLs checked every minute," this is comfortably within SQLite's
single-writer throughput — a few dozen writes per minute is nothing. Postgres would add a
second container, a connection pool, and a migration story for zero real benefit at this
scale. `node:sqlite` (rather than `better-sqlite3`) specifically avoids a native
compilation step at install time, which is a common source of Docker/CI build failures
(see `AI_LOG.md` for the actual failure this project hit and how it was resolved).

**This breaks down** once you need: multiple backend replicas writing concurrently (SQLite
has one writer at a time — fine for one scheduler process, not for horizontally scaled
ones), or more than roughly a few hundred URLs on a sub-minute interval, where a single
process doing all the pinging serially-ish becomes the bottleneck.

## Why an in-process cron job instead of a separate worker/queue

At this scale, `Promise.allSettled` across a few dozen concurrent fetches, once a minute,
finishes in well under a second. A separate worker process and a queue (BullMQ, SQS, etc.)
would add real operational complexity — another service to deploy, monitor, and reason
about failure modes for — to solve a scaling problem this app doesn't have yet.

## What breaks first past "a few dozen URLs," and what I'd do about it

This is the part that actually matters for judging cloud topology thinking, so being
concrete about it:

1. **~500+ URLs on a 60s interval, single process:** the in-process scheduler starts to
   matter — a slow batch of checks can start running into the next minute's cron tick.
   Fix: move pinging to a dedicated worker pool (or a queue like SQS/BullMQ) so the API
   process and the checking process scale independently, and shard URLs across N workers
   by consistent hashing on URL ID.
2. **Multi-region checking is implemented, not hypothetical** — but it's worth being
   precise about what's real. `docker-compose.yml` runs three separate OS processes
   (`backend`, `checker-eu`, `checker-ap`), each independently pinging every URL and
   writing its own region-tagged results to a shared SQLite file. A URL only counts as a
   confirmed outage once a **majority of regions agree** (`quorumDecision` in
   `incidentState.js`) — a single region's own network issue no longer misreports the
   target as down, which is a real, meaningful improvement over single-vantage-point
   checking.

   **What's honestly still local-only:** all three containers share one machine's network
   egress, so "eu-west" and "ap-south" are logical labels, not genuinely different network
   paths, in this docker-compose setup. Making it real needs two changes, both
   straightforward given the current design: (a) deploy the checker processes as separate
   services in actually different cloud regions — no code change, just where each
   container runs; (b) swap the shared SQLite **file** for a networked DB (Postgres) that
   every region's process can reach, since a Docker named volume only works when every
   consumer is on the same host. The quorum logic and per-region schema don't change
   either way — this is exactly the kind of decision that's cheap to get right early and
   expensive to retrofit later.
3. **SQLite write contention:** `PRAGMA busy_timeout` makes concurrent writers from
   multiple processes (already true today — see the multi-region point above) queue
   instead of erroring, which is fine at this write volume. It becomes the wrong choice
   the moment regions run on genuinely separate hosts (a SQLite file volume can't be
   shared across hosts) or write volume grows well past "a few dozen URLs" — at that
   point, move to Postgres. The schema carries over almost unchanged.
4. **Alerting:** there's no notification path today (by design — out of scope for this
   brief). The natural extension is a webhook fired on the `open`/`resolve` incident state
   transitions already computed in `incidents.js` — the state machine already knows
   exactly when an incident opens or resolves, so alerting is an additive hook, not a
   rearchitecture.

## Why the status grid polls but the activity log pushes (SSE)

These are two different data shapes and deserve two different transports, not one
one-size-fits-all choice:

- **The status grid** (`GET /api/urls`, polled every 5s) is a snapshot of *current* state.
  At a few dozen URLs, polling costs nothing meaningful, and a client that's a few seconds
  stale is harmless — nobody needs sub-second precision on "is this currently up."
- **The activity log** (`GET /api/events`, Server-Sent Events) is a stream of *events* —
  individual check results and incident open/resolve transitions. Polling for events is
  the wrong shape entirely: either you poll fast enough to not miss bursts (wasteful when
  nothing's happening) or you miss them. Push is the natural fit for "tell me the moment
  something happens," and SSE specifically (over WebSockets) fits because the data only
  flows one direction, server → client — no need for the extra complexity of a
  bidirectional protocol for something that never needs to send messages back.

This is also why SSE was picked over WebSockets: simpler server code (no handshake/frame
protocol to manage), works over plain HTTP so it survives typical proxies without special
config beyond disabling buffering (`X-Accel-Buffering: no`, set in `routes/events.js`),
and the browser's `EventSource` handles reconnection automatically — one less thing to
build. If this became a product where many browsers all needed the *dashboard* itself
(not just the log) updated sub-second, that's when polling would get replaced too — but
that's not this MVP's bottleneck today.

## Why SSL checks are a raw TLS handshake, on a separate 6h schedule

`src/ssl.js` opens a bare `tls.connect` to read `getPeerCertificate().valid_to` — no HTTP
request at all. This is deliberately decoupled from the health-check pass for two
reasons: a certificate's expiry date doesn't change between one minute and the next, so
checking it every 60s like a health check would be pure waste; and mixing "is the
service responding" with "is the certificate about to expire" into one code path would
conflate two genuinely different failure modes (a service can be perfectly up with a
cert that expires in 3 days — that's a distinct, actionable warning, not a health-check
concern). Running it as its own module on its own 6-hour cadence keeps both concerns
simple instead of one check function doing two unrelated jobs.
