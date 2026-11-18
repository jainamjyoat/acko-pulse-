# Pulse — Technical Readme and Runbook

## What is implemented

Pulse is a Next.js App Router application that monitors Quotes, Payments,
Claims, and Notifications. It combines a server-side polling engine, Docker
service targets, a public status view, an SRE console, optional Supabase
persistence/Realtime, metrics, recovery actions, signed webhooks, and an audit
trail.

This guide explains the actual module flow and gives commands for developing
and testing the current implementation.

## 1. Requirements

- Node.js/npm compatible with the installed Next.js version.
- Docker Desktop or Docker Engine with Compose.
- Optional Supabase project for persistent service/health/incident data and
  Realtime updates.
- Optional webhook destination and a long random `WEBHOOK_SECRET`.

## 2. Start from Windows PowerShell

```powershell
npm install
Copy-Item .env.example .env.local
npm run services:up
npm run dev
```

Open `http://localhost:3000`. To stop the app use `Ctrl+C`; stop service
containers with:

```powershell
npm run services:down
```

`.env.local` values are optional for the in-memory path. Add actual secrets
before testing admin actions, outgoing webhooks, or Supabase integration. Never
commit `.env.local` or expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.

## 3. Docker service implementation

The root `docker-compose.yml` creates four containers from the same
`services/mock/Dockerfile`. The server implementation is
`services/mock/server.mjs`; each container gets a distinct `SERVICE_NAME`, and
all listen on container port 8080.

| Container service | Published port | Next.js host probe URL |
| --- | ---: | --- |
| `quotes` | 4101 | `http://localhost:4101/health` |
| `payments` | 4102 | `http://localhost:4102/health` |
| `claims` | 4103 | `http://localhost:4103/health` |
| `notifications` | 4104 | `http://localhost:4104/health` |

Each container exposes:

- `GET /health`: responds HTTP 200 when healthy or 503 after failure is toggled.
- `POST /control/fail`: toggles the in-memory service into failing mode.
- `POST /control/reset`: clears failing mode and responds HTTP 200.
- `GET /`: returns service identity and available endpoint names.

Check containers and service logs:

```powershell
docker compose ps
docker compose logs --tail 100 quotes payments claims notifications
```

The Compose file does not define `pulse-app`; Next.js normally runs on the host.
So logs for the app are in the terminal running `npm run dev`, not in
`docker compose logs pulse-app`.

## 4. Request/data flow through the implementation

1. `app/page.tsx` renders `src/features/dashboard/PulseDashboard.tsx`.
2. The dashboard calls `GET /api/poll` every five seconds using a relative URL.
   The browser therefore contacts the same-origin Next.js server.
3. `app/api/poll/route.ts` re-exports handlers from
   `src/features/poller/route.ts`.
4. The route calls `poll(false)`. A stale-aware request only starts work when
   the prior poll is older than four seconds; `POST /api/poll` forces a poll.
5. `poller.ts` probes the four server-side URLs concurrently, records latency,
   inspects response headers, and advances each runtime's three-check window.
6. `stateMachine.ts` calculates state. Incident changes are stored in memory;
   configured Supabase writes and webhooks run after transition processing.
7. The poll route returns a `StatusPayload`. React state updates the customer or
   SRE tab without a page navigation.
8. `instrumentation.ts` also starts a Node timer to poll every five seconds.

## 5. State rules and UI behavior

State is held until the service has three samples in its sliding window:

| Last three checks | State | Customer visibility | Incident |
| --- | --- | --- | --- |
| All 3 fail | OUTAGE | Red outage | PUBLIC critical |
| 1 or 2 fail | DEGRADED | Green/operational presentation | INTERNAL warning |
| 3 pass, average latency > 1000ms | DEGRADED | Green/operational presentation | INTERNAL warning |
| 3 pass, average latency <= 1000ms | OPERATIONAL | Green/operational | Existing incident auto-resolves |

Public service cards show a sliding 20-block outage history and only PUBLIC
incidents. The SRE console shows full service state, SLA table, P95, security
grade, public/internal incident scope and recovery controls.

## 6. Exercise a failure and rollback

Start Payments failing:

```powershell
Invoke-RestMethod -Method Post http://localhost:4102/control/fail
```

Wait for three poll cycles (approximately 15 seconds when the background poller
is running), then inspect:

```powershell
Invoke-RestMethod http://localhost:3000/api/poll | ConvertTo-Json -Depth 6
```

The service should become OUTAGE after three consecutive failures. To use
one-click SRE rollback, set `ADMIN_KEY` in `.env.local`, restart Next.js, enter
the exact key in the SRE UI, then click **Trigger Rollback / Heal**. The server
POSTs to `/control/reset`; the incident is kept pending until three successful
probes confirm recovery.

Direct service recovery for test cleanup:

```powershell
Invoke-RestMethod -Method Post http://localhost:4102/control/reset
```

The dashboard's **Test lab** tab also runs failure, 1200ms latency,
security-header regression, rollback verification, and restore scenarios
against a selected local service. Configure `ADMIN_KEY` and enter it in the SRE
UI. The test API only allows the configured localhost Docker ports and refuses
external targets; these are controlled failure simulations, not real attack
traffic.

## 7. Supabase setup and exact responsibilities

Set these values in `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<public-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
```

Apply `src/features/poller/schema.sql` in the Supabase SQL editor. The schema
contains services, health logs, incidents, state events, audit logs, and
webhook events. Server-side writes use the admin client; the browser uses the
public anon key for Realtime. Supabase is optional: missing credentials result
in an in-memory mode, not a probe HTTP error.

If Supabase is configured but not working, check key/URL correctness, schema
application, RLS, and Realtime publication. Service probes can work even while
database persistence fails.

## 8. Environment variable reference

| Variable | Use | Required for local polling? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Realtime client / server fallback | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database writes | No |
| `ADMIN_KEY` | Protect rollback/manual-resolve routes | No, required for those actions |
| `WEBHOOK_URL` | Destination for outgoing event POSTs | No |
| `WEBHOOK_SECRET` | HMAC signing and receiver verification | No |
| `SERVICE_QUOTES_URL` | Override Quotes probe URL | No; defaults to host port 4101 |
| `SERVICE_PAYMENTS_URL` | Override Payments probe URL | No; defaults to host port 4102 |
| `SERVICE_CLAIMS_URL` | Override Claims probe URL | No; defaults to host port 4103 |
| `SERVICE_NOTIFICATIONS_URL` | Override Notifications probe URL | No; defaults to host port 4104 |

Target URLs are read by server code. `NEXT_PUBLIC_API_URL` is not used by the
dashboard; it intentionally calls relative `/api/poll` and `/api/status`.

## 9. Webhook behavior

Outgoing events are skipped unless both `WEBHOOK_URL` and `WEBHOOK_SECRET` are
set. The request contains `X-Pulse-Timestamp` and
`X-Pulse-Signature: sha256=<hex>`. The signature is HMAC-SHA256 over the exact
raw JSON request body prefixed by `<timestamp>.`.

The in-app receiver endpoint is `POST /api/webhooks/receive`; it verifies
freshness within five minutes and signature equality. `GET /api/webhooks/events`
feeds the Webhook Receiver panel. The receiver URL is separate from the
outgoing destination URL: configure `WEBHOOK_URL` to the endpoint you want
Pulse to notify.

## 10. Audit and security posture

- Probe responses get grade A only when `X-Content-Type-Options` is `nosniff`
  and `X-Frame-Options` is present; otherwise they get B.
- Manual rollback/resolution and confirmed recovery append audit entries.
- Each entry contains the previous entry's hash and a SHA-256 digest. The SRE
  panel displays chain verification status and recent actions.
- Next.js dev hot reload may keep old objects on `globalThis`; `getStore()` now
  normalizes them. If upgrading modules, restart `npm run dev` if API behavior
  remains stale.

## 11. Docker URL/network rule

Current development runs Next.js on the host. It must use mapped host URLs like
`http://localhost:4101/health`.

If Next.js is moved into Docker, add it to the same Compose project/network as
the four services and set its server probe URLs to Compose DNS names, e.g.
`http://quotes:8080/health`. Never use `localhost:4101` from inside the app
container: container-local `localhost` points back to the app container.
Conversely, browser code must not call `http://quotes:8080`; the browser is
outside the Docker network and should call the same-origin `/api/*` endpoints.

## 12. Troubleshooting `/api/poll` 500

1. Read the exception in the terminal running Next.js. Current code catches
   probe/persist failures in several places, but status construction failures
   may still return a 500.
2. Directly test all service health routes on ports 4101–4104.
3. Open `http://localhost:3000/api/poll`; inspect the HTTP status and JSON.
4. Check `docker compose ps` and logs for the four containers.
5. If the stack trace says `getStore.audit is not iterable`, restart dev server
   and ensure current `src/features/poller/store.ts` migration logic is loaded.
6. If it mentions service URL fetch failures, distinguish host-run Next.js
   (`localhost:410x`) from container-run Next.js (service DNS names).
7. If Supabase is configured, verify credentials/schema separately; a missing
   Supabase setup should use memory fallback and does not require keys to poll.

## 13. Quality checks

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

## 14. Known limitations

The `globalThis` store and timer exist in a single Node process. They do not
coordinate multiple Next.js replicas and may reset when the process restarts.
For a production/multi-instance system, use shared state (such as Redis or a
database with transactions), distributed poll locking, and an external
scheduler/worker.
