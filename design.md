# Pulse — Technical Design

## 1. System context

Pulse monitors four HTTP services. The Next.js server is both the API host and
the probe worker. The browser never probes service containers directly; it
calls Next.js endpoints on the same origin. Supabase is an optional persistence
and push-update layer; the in-memory implementation supports local development
without credentials.

```text
Browser (localhost:3000)
  ├── GET /api/poll             every 5 seconds
  ├── GET /api/status           snapshot refresh after Realtime/actions
  ├── POST /api/incidents/resolve         admin rollback
  ├── POST /api/incidents/manual-resolve  admin direct resolve
  └── Supabase browser Realtime (optional)
            │
            ▼
Next.js Node process
  ├── instrumentation.ts -> startPoller()
  ├── app/api/* -> feature route adapters
  ├── poller probes 4 service /health endpoints
  ├── globalThis store -> windows/incidents/recovery state
  ├── optional Supabase service-role writes and broadcasts
  └── status snapshot -> browser
            │
            ▼
Docker Compose network (services only in current compose)
  quotes:8080 / payments:8080 / claims:8080 / notifications:8080
  published on host ports 4101 / 4102 / 4103 / 4104
```

## 2. Source layout and module ownership

```text
app/
  api/
    poll/route.ts                     -> src/features/poller/route.ts
    status/route.ts                   -> src/features/status/getStatus.ts
    incidents/resolve/route.ts        -> src/features/sre/resolve.ts
    incidents/manual-resolve/route.ts -> src/features/sre/resolve.ts
    webhooks/receive/route.ts         -> src/features/webhooks/verify.ts
    webhooks/events/route.ts          -> src/features/webhooks/verify.ts
    audit/route.ts                    -> src/features/audit/hashChain.ts
src/features/
  dashboard/PulseDashboard.tsx
  poller/{poller,stateMachine,store,services,security,webhook,route}.ts
  metrics/p95.ts
  status/{getStatus,PublicStatus}.ts(x)
  sre/{resolve,SreConsole}.ts(x)
  webhooks/{verify,WebhookReceiver}.ts(x)
  audit/{hashChain,AuditTrail}.ts(x)
  shared/{types,ui,supabase-server,supabase-browser}
services/mock/{Dockerfile,server.mjs}
docker-compose.yml
```

App Router files are adapters so feature logic remains outside route directories.

## 3. Poll lifecycle

1. `instrumentation.ts` starts `startPoller()` in the Node runtime. A timer
   forces a poll every 5000ms.
2. Browser `PulseDashboard` independently calls `GET /api/poll` every 5000ms.
   `GET` runs a poll only if the most recent is older than 4000ms; `POST` always
   requests a forced poll. Concurrent requests share `store.inFlight`.
3. `poll()` concurrently calls `probe()` for the four entries in
   `SERVICES`. Probes use `fetch(..., cache: "no-store")`, a 3500ms timeout,
   and measure wall-clock duration using `performance.now()`.
4. `recordCheck()` adds the result to a three-sample window and bounded history.
5. `evaluateWindow()` calculates a state. The current runtime state is retained
   until three samples exist.
6. On state transition, `routeIncident()` chooses incident severity/scope.
   Existing open incidents are updated instead of creating a new duplicate.
7. Health checks and state changes are written to Supabase when configured;
   state events also trigger a Realtime broadcast.
8. An updated `StatusPayload` is returned. The browser replaces its state and
   updates both views.

The poller catches a failed `runPoll()` at the outer boundary so it can continue
serving subsequent poll requests; errors inside Supabase operations are mostly
handled via `Promise.allSettled`. For diagnosis, inspect the Next.js process
terminal and test service health endpoints independently.

## 4. State machine and visibility policy

Let `W` be the last 3 health checks, `F` the failed check count, and `L` their
average request latency:

| Condition | State | Incident scope | Severity |
| --- | --- | --- | --- |
| F = 3 | OUTAGE | PUBLIC | critical |
| F = 1 or F = 2 | DEGRADED | INTERNAL | warning |
| F = 0 and L > 1000ms | DEGRADED | INTERNAL | warning |
| F = 0 and L <= 1000ms | OPERATIONAL | resolve open incident | — |

Before `|W| = 3`, retain the previous state. Public UI maps both OPERATIONAL and
DEGRADED to an OPERATIONAL badge; only OUTAGE is shown as red. Public incident
feed filters `scope === "PUBLIC"`. SRE UI displays the actual service state and
internal incidents.

## 5. Runtime state and hot reload

`src/features/poller/store.ts` stores `__pulseStore` on `globalThis`. It holds:

- runtime per service: configuration, 3-check window, bounded health history,
  20-entry outage history, state, latency, grade, and outage-cycle count;
- open/resolved in-memory incidents;
- last poll time and in-flight promise;
- pending rollback/auto-heal modes;
- received webhook events and audit entries.

Next.js development HMR can preserve `globalThis` while replacing module code.
Therefore `getStore()` migrates missing properties, refreshes service configs,
normalizes collections, and creates newly added fields instead of trusting an
old object to match the current TypeScript type. This addresses the observed
`getStore.audit is not iterable` crash.

## 6. Metrics algorithms

`metrics/p95.ts` selects health logs within the prior hour, up to 1000 rows per
service. P95 uses nearest-rank indexing:

```text
sorted = latencies ascending
index = min(n - 1, ceil(0.95 * n) - 1)
p95 = sorted[index]
```

Uptime is `(successful checks / total checks) * 100`. Error budget remaining is
derived from the configured 99.9% SLO and observed failure rate. Metrics are
cached in process memory for approximately five seconds and use in-memory
history if Supabase is unavailable or returns no usable rows.

## 7. Supabase data and security

`src/features/poller/schema.sql` defines `services`, `health_logs`, `incidents`,
`state_events`, `webhook_events`, and `audit_logs`, plus indexes, read policies,
and Realtime publication additions. The server client uses
`SUPABASE_SERVICE_ROLE_KEY` (or falls back to anon key); the service-role key
must remain server-only. The browser client uses public URL/anon credentials.

Without configured Supabase URL/key, `supabaseAdmin()` returns `null` and
polling falls back to memory. With a bad schema or credentials, health probing
can still run but persistence/realtime won't work; inspect Supabase errors/logs
separately from service probe results.

## 8. Rollback and auto-heal sequence

### Operator-triggered rollback

1. UI POSTs incident ID to `/api/incidents/resolve` with `x-admin-key`.
2. Server compares header to `ADMIN_KEY`; request fails closed if missing or
   incorrect.
3. Resolve module finds an open in-memory incident and service config.
4. Server POSTs the derived URL `/control/reset`.
5. Pending mode is retained; it does **not** immediately mark the incident
   resolved.
6. Subsequent polls must produce 3/3 successful checks. Then the incident is
   marked resolved, an audit record is appended, and a recovery webhook is sent.

### Automatic reset

Payments and Claims can invoke `/control/reset` after five polling cycles while
in OUTAGE. The same healthy-window confirmation path is intended to complete
recovery.

## 9. Webhook signature protocol

Outgoing body is JSON serialized once. Timestamp is Unix seconds. Signature is
hex HMAC-SHA256 over:

```text
timestamp + "." + exact_raw_request_body
```

Headers:

```text
X-Pulse-Timestamp: <unix-seconds>
X-Pulse-Signature: sha256=<hex>
```

The receiver at `/api/webhooks/receive` reconstructs the same message, rejects
stale timestamps older than five minutes, validates hex format, and compares
buffers using `timingSafeEqual`. The UI fetches `/api/webhooks/events` for its
event list.

## 10. Audit-chain model

Each audit entry contains actor, action, service ID, incident ID, timestamp,
and `previousHash`. The genesis previous hash is 64 zero characters. SHA-256 is
computed from deterministic JSON fields; verification recomputes each hash and
checks that each `previousHash` equals the prior entry's hash. Supabase stores
the fields and a unique hash. A single process is assumed for append order;
multi-instance writers require transactional serialization.

## 11. Docker and URL resolution

The current `docker-compose.yml` contains only four services, each exposing
container port 8080 on host 4101–4104. The local Node process uses the host
addresses configured by `src/features/poller/services.ts`.

If adding Next.js as a Compose service later, attach it to the same network and
override server-only target URLs to Compose DNS names (`http://quotes:8080/health`,
etc.). `localhost` inside the app container refers to that same app container,
not the service containers. Conversely, the browser should continue using
relative Next.js URLs such as `/api/poll`; it cannot resolve Docker service DNS.

## 12. Known design boundaries

- Store and interval are per Node process; not cluster-wide or serverless-safe.
- DB persistence errors are not currently surfaced as probe failure; the health
  state and persistence state are distinct.
- Supabase tables/read policies must match the SQL schema before full sync.
- Rollback and auto-heal require services that implement the `/control/reset`
  contract; the included mock does.
- Hash-chain ordering is not transactionally locked across multiple writers.
