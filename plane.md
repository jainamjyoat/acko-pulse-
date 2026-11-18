# Pulse — Technical Implementation Plan

## 1. Project objective

Pulse is a Next.js App Router monitoring system for four HTTP services:
Quotes, Payments, Claims, and Notifications. The Next.js server runs probes,
calculates service state from a rolling window, records health and incident
events, and serves two views:

- **Public Status**: customer-safe availability and customer-facing incidents.
- **SRE Console**: full service state, latency/SLA metrics, internal incidents,
  and operator controls.

The application is local-first: Supabase can be added for persistence and
Realtime, while the dashboard and poller can also run with in-memory state.
The four sample services are Dockerized using one shared Node HTTP server.

## 2. Implementation modules

| Area | Code | Responsibility |
| --- | --- | --- |
| App integration | `app/page.tsx`, `instrumentation.ts` | Mount dashboard and start the Node poll timer. |
| Poll API | `app/api/poll/route.ts`, `src/features/poller/route.ts` | GET stale-aware poll, POST forced poll. |
| Poll engine | `src/features/poller/poller.ts` | Probe targets, update state, persist logs/incidents, dispatch events. |
| State policy | `src/features/poller/stateMachine.ts` | Three-check threshold and incident scope. |
| Process memory | `src/features/poller/store.ts` | Per-service runtime, incident and audit-compatible state. |
| Targets | `src/features/poller/services.ts` | Service IDs, names, URLs and reset URL derivation. |
| Metrics | `src/features/metrics/p95.ts` | Rolling one-hour P95, uptime, and error budget. |
| Status | `src/features/status/getStatus.ts` | Merge runtime snapshot with optional Supabase incidents. |
| Customer UI | `src/features/status/PublicStatus.tsx` | Public status, 2x2 service cards, history, public incident feed. |
| SRE UI | `src/features/sre/SreConsole.tsx` | Full state, metrics, incidents, rollback, audit/webhook panels. |
| Recovery | `src/features/sre/resolve.ts` | Admin-key validation, service reset, manual resolution. |
| Webhooks | `src/features/poller/webhook.ts`, `src/features/webhooks/verify.ts` | Timestamped HMAC sender and receiver verification. |
| Audit | `src/features/audit/hashChain.ts` | Append and validate hash-linked operator actions. |
| Supabase | `src/features/shared/supabase-server.ts`, `supabase-browser.ts`, `src/features/poller/schema.sql` | Server persistence, browser Realtime client, schema and publication. |
| Local services | `docker-compose.yml`, `services/mock/` | Four local service containers and test controls. |

## 3. Feature implementation plan and status

### Sliding-Window State Machine

- [x] Probe all four service endpoints from server-side code.
- [x] Retain a three-entry check window and larger display history in
  `globalThis.__pulseStore`.
- [x] Keep the existing state until the window has three samples.
- [x] Apply state transition rules and open/resolve incidents on transitions.
- [x] Render a 20-block public history and live 5-second polling.
- [x] Suppress duplicate incident/webhook opens while an open in-memory incident
  already exists for the service.

### Multi-Tier DEGRADED State + P95 Latency + Two-Tier Visibility

- [x] Measure each probe duration with `performance.now()`.
- [x] Mark one/two failures in the three-check window DEGRADED; mark all three
  failures OUTAGE; mark three healthy checks DEGRADED when average latency is
  over 1000ms.
- [x] Route DEGRADED incidents to INTERNAL and OUTAGE incidents to PUBLIC.
- [x] Mask DEGRADED service states in the customer view; retain the full state
  in the SRE view.
- [x] Calculate P95 and uptime/error budget from Supabase health logs, with a
  process-memory fallback.

### Event-Driven Auto Status + Supabase Realtime

- [x] Upsert service rows and insert health logs when an admin Supabase client
  is configured.
- [x] Insert incidents and state-event rows.
- [x] Send a Realtime broadcast on state changes and subscribe from the client.
- [x] Keep browser polling at five-second intervals as a fallback.
- [ ] Validate channel/database publication with real Supabase credentials in
  the target project.

### One-Click Service Rollback & Closed-Loop Auto-Heal

- [x] Validate the `x-admin-key` header server-side.
- [x] POST `/control/reset` on the affected service.
- [x] Mark rollback pending and wait for three consecutive successful checks
  before automatic recovery resolution.
- [x] Attempt automatic Payments/Claims reset at five outage polling cycles.
- [x] Expose an SRE action and recovery audit/webhook event.
- [ ] End-to-end test a rollback with the UI and actual `ADMIN_KEY` configured.

### Time-Window SLA & Error Budget Engine

- [x] Query up to 1000 health log rows per service from the last hour.
- [x] Calculate uptime, nearest-rank P95, and remaining error budget against
  99.9% SLO.
- [x] Render live SLA and P95 indicators in the SRE console.
- [ ] Test calculations with a known controlled sample set in Supabase.

### HMAC-SHA256 Signed Webhooks

- [x] Sign event body with `HMAC-SHA256(secret, timestamp + "." + rawBody)`.
- [x] Send `X-Pulse-Signature: sha256=<hex>` and `X-Pulse-Timestamp`.
- [x] Verify signature using a five-minute freshness window and constant-time
  compare at `/api/webhooks/receive`.
- [x] List received events in the Webhook Receiver UI.
- [ ] Verify against an external webhook endpoint in the target environment.

### Tamper-Proof Hash-Chained Audit Logs + Security Posture Grade

- [x] Grade A when `nosniff` and `X-Frame-Options` headers are present;
  otherwise grade B.
- [x] Hash audit fields plus the prior entry hash with SHA-256.
- [x] Validate the chain and show its status in the UI.
- [x] Reconcile older `globalThis` objects during Next.js HMR so newly added
  fields (such as `audit`) don't crash API requests.
- [ ] Confirm audit persistence and verify-chain behavior with Supabase data.

## 4. Local development sequence

1. `npm install`
2. `npm run services:up`
3. `npm run dev`
4. Open `http://localhost:3000` and monitor `/api/poll`.
5. Use `POST http://localhost:4102/control/fail` to test Payments failure.
6. Use SRE rollback or `POST http://localhost:4102/control/reset` to restore.
7. `npm run services:down` when finished.

## 5. Acceptance checks

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- All four `GET /health` endpoints return HTTP 200 when healthy.
- Three consecutive failure results produce OUTAGE and a PUBLIC incident.
- Degradation is internal and does not alarm the public page.
- A successful rollback is not resolved until the healthy three-check window
  has been observed.
- Browser calls use `/api/*`; server probe URLs resolve from the Next.js
  process/container network.

## 6. Operational boundary

The poll interval, deduplication state, windows, and audit fallback are process
memory. This is appropriate for a single-process college project demo. A
multi-replica deployment needs shared locking/state and one scheduled poller.
