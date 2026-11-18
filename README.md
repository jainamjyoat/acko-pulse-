# Pulse

Live status page + SRE console for four microservices. Built with Next.js App Router, TypeScript, Tailwind, and Supabase.

## Run

```bash
npm install
cp .env.example .env.local   # optional: app runs in-memory without Supabase
npm run services:up           # start four local service containers
npm run dev
```

Pulse polls local Docker services by default: Quotes (`4101`), Payments (`4102`), Claims (`4103`), and Notifications (`4104`). Each exposes `GET /health`, `POST /control/fail`, and `POST /control/reset`. Run `npm run services:down` to stop them. The SRE rollback action calls the affected container's `/control/reset` and waits for three successful checks before resolving the incident.

To test a failure, for example: `curl -X POST http://localhost:4102/control/fail`. The service will become an outage after three polls. Rollback from the SRE console or call `curl -X POST http://localhost:4102/control/reset`.

Apply `src/features/poller/schema.sql` in the Supabase SQL editor to enable persistence and realtime websockets.

The feature is grouped under `src/features/`; see `src/features/README.md` for the full file map. The dashboard's SRE Console includes a Test Lab for safe local failure, latency, security-header, rollback, and restore scenarios. Configure `ADMIN_KEY` to enable test controls.

## Behavior

- `GET /api/poll` returns the current snapshot; if the last probe is older than 4s it runs one. `POST /api/poll` forces a probe.
- A background poller in `instrumentation.ts` probes every 5s and uses `globalThis` for the last-3-check windows.
- `OUTAGE`: 3/3 checks fail. `DEGRADED`: 1-2 fail, or window latency averages over 1000ms. `OPERATIONAL`: 3/3 pass.
- Two-tier incidents: `DEGRADED` opens an `INTERNAL` warning (hidden publicly); `OUTAGE` opens a `PUBLIC` critical incident.
- `metrics/p95.ts` calculates rolling 1-hour P95, uptime, and error budget from Supabase `health_logs`, with an in-memory fallback.
- `WEBHOOK_URL` receives state changes only, signed with `X-Pulse-Signature: sha256=<hmac>` over the raw JSON body using `WEBHOOK_SECRET`.
- `POST /api/incidents/resolve` requires `x-admin-key: $ADMIN_KEY`, resolves the incident, and resets the service window to operational.
- Public tab shows a calm banner, 20-block history, and public incidents only. SRE tab shows full telemetry and amber P95 > 1000ms.
- Test Lab controls only the four local Docker mock services; it does not send attack traffic to external targets.

## Notes

`globalThis` state and `setInterval` are per server process. For multi-instance or serverless deployments, move the window state to Redis/Supabase and trigger polling from a cron job.
