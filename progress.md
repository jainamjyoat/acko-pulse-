# Pulse — Implementation Progress

This file records what exists in the current repository, how the parts are
implemented, and what still depends on environment setup or integration tests.

## Runtime architecture implemented

The browser renders `src/features/dashboard/PulseDashboard.tsx`. It sends a
same-origin `GET /api/poll` every five seconds, updates its local `StatusPayload`,
and subscribes to Supabase database/broadcast events if the browser Supabase
client can be configured. The Next.js server—not the browser—probes the service
URLs. This means browser fetches do not need `NEXT_PUBLIC_API_URL` or direct
access to Docker DNS names.

`instrumentation.ts` dynamically imports `src/features/poller/poller.ts` under
the Node runtime and starts an interval. The API route also calls the poller,
which prevents a missing startup interval from making the endpoint permanently
stale. A single in-flight promise avoids concurrent probes inside that process.

## Implemented feature detail

### 1. Sliding-Window State Machine

- `src/features/poller/poller.ts` concurrently probes all services using
  `Promise.all` and an abort timeout.
- `src/features/poller/store.ts` stores each service's `window` (last 3 checks),
  history (up to 720 checks), current state, latest latency, grade, and outage
  count on `globalThis`.
- `src/features/poller/stateMachine.ts` retains the prior state until there are
  three checks, then evaluates all three.
- The public cards render a 20-block strip from `outageHistory`; the dashboard
  polls every five seconds.
- In-memory open incidents are reused/updated rather than reopened for every
  poll, reducing duplicate opens and alert sends.

### 2. Multi-Tier DEGRADED State + P95 Latency + Two-Tier Visibility

- Each request duration is measured using `performance.now()`.
- State rules: three failed checks => OUTAGE; one or two failures => DEGRADED;
  all healthy with three-check average latency > 1000ms => DEGRADED; otherwise
  OPERATIONAL.
- `routeIncident()` maps OUTAGE to a critical PUBLIC incident and DEGRADED to a
  warning INTERNAL incident.
- `PublicStatus.tsx` presents degraded services as OPERATIONAL and filters the
  feed to PUBLIC incidents. `SreConsole.tsx` shows the unmasked engineering
  state, P95 and internal incidents.
- `src/features/metrics/p95.ts` loads rows from the rolling hour and computes
  nearest-rank P95, uptime, and budget. If Supabase is absent or its query fails,
  it uses the in-memory check history.

### 3. Event-Driven Auto Status + Supabase Realtime

- `poller.ts` upserts `services`, inserts `health_logs`, `incidents` and
  `state_events` through `supabaseAdmin()`.
- State transitions are also sent over a Supabase channel broadcast.
- The dashboard subscribes to services, incidents, state events, audit logs,
  webhook events, and the broadcast event; it refreshes status when notified.
- Five-second HTTP polling remains enabled as a fallback.
- Schema and publication setup live in `src/features/poller/schema.sql`.
- Real-time behavior requires correctly configured Supabase credentials and a
  schema/publication setup that has actually run in the target project.

### 4. One-Click Service Rollback & Closed-Loop Auto-Heal

- `POST /api/incidents/resolve` dispatches to `rollbackIncident()`.
- The route checks `ADMIN_KEY` against `x-admin-key`, finds the open incident,
  marks the service's pending-heal mode, and POSTs to that service's
  `/control/reset` endpoint.
- Polling does not immediately mark the incident resolved. It waits until the
  three-entry window contains three successful checks, then closes the incident,
  writes an audit action, and sends a recovery webhook.
- Payments and Claims attempt an automatic reset after five OUTAGE polling
  cycles.
- The SRE view waits for the incident to become resolved and displays the
  recovery method.
- Separate manual resolution route exists at
  `POST /api/incidents/manual-resolve`; unlike rollback it explicitly closes
  immediately, so rollback is the closed-loop recovery path.

### 5. Time-Window SLA & Error Budget Engine

- `p95.ts` queries health logs newer than one hour ago, up to 1000 rows per
  service, and caches metrics briefly in process memory.
- Uptime is successful checks divided by all checks; error-budget remaining
  derives from the 99.9% target.
- `SreConsole.tsx` shows availability/SLA met status, remaining budget, P95,
  average latency, and service-level state.
- When no metrics exist for a service, its initial fallback is zero observed
  P95 and default healthy uptime; this is a cold-start display, not measured
  historical availability.

### 6. HMAC-SHA256 Signed Webhooks

- `src/features/poller/webhook.ts` sends transition/incident/recovery events
  only when `WEBHOOK_URL` and `WEBHOOK_SECRET` are configured.
- Signature input is the timestamp, a dot, and the exact serialized body.
- `src/features/webhooks/verify.ts` verifies signature format, five-minute
  timestamp freshness, and constant-time HMAC equality.
- Valid/invalid events are stored in memory and optionally in the
  `webhook_events` table; `WebhookReceiver.tsx` polls the receiver event API.
- A receiver is for incoming events directed to this app; outgoing webhook
  delivery still needs a destination URL that accepts Pulse's POST.

### 7. Tamper-Proof Hash-Chained Audit Logs + Security Posture Grade

- `security.ts` grants A when both `X-Content-Type-Options: nosniff` and
  `X-Frame-Options` are present, otherwise B.
- `audit/hashChain.ts` hashes normalized action data including the prior hash,
  and verifies chronological entries against the chain.
- Audit entries use Supabase when available and in-memory fallback otherwise.
- `store.ts` now reconciles pre-existing `globalThis.__pulseStore` properties
  after hot reload. This fixed the observed exception
  `getStore.audit is not iterable` from `/api/poll`.

## Local Docker services

`docker-compose.yml` defines four containers from `services/mock/Dockerfile`.
The shared `services/mock/server.mjs` implements `/health`, `/control/fail`,
and `/control/reset`. Host ports are 4101–4104. The latest observed direct
health checks and a fresh production `/api/poll` returned all four services as
healthy/OPERATIONAL.

The Compose project does not include a `pulse-app` container. Host-run Next.js
uses `localhost:4101`–`localhost:4104`. If Next.js is later containerized in the
same Compose project, configure its server-side service URLs using Compose
DNS (`http://quotes:8080/health`, etc.).

## Verification performed

- `npm run lint` passed after store migration work.
- `npx tsc --noEmit` passed after store migration work.
- `npm run build` passed in the prior implementation verification.
- Live `GET /api/poll` on the fresh production server returned all four services
  as OPERATIONAL.
- The development server that reported the HMR exception must be restarted to
  load current module code; `npm run dev` then uses the store migration path.

## Remaining work / known limits

- Set real Supabase environment values and apply the SQL schema to validate
  persistence/Realtime against the user's Supabase project.
- Test the UI rollback from failure through the three healthy checks with
  `ADMIN_KEY` configured.
- Validate webhook payloads against the actual destination and receiver.
- The poll/store/timer are process-local; they are not suitable as-is for
  horizontal scaling.
- Audit chain concurrency across multiple app instances is not coordinated;
  use a transaction/locking strategy for a multi-writer deployment.
