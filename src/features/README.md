# Pulse features

Feature code lives in `src/features/`. Next.js route files in `app/api` are
thin adapters.

```text
src/features/
├── poller/
│   ├── route.ts          GET/POST /api/poll adapter
│   ├── poller.ts         5s probe loop, sync, webhooks
│   ├── stateMachine.ts   Last-3 window + PUBLIC/INTERNAL routing
│   ├── services.ts       Four monitored targets
│   ├── security.ts       Security header grading
│   ├── store.ts          globalThis runtime + incident store
│   ├── webhook.ts        HMAC-SHA256 webhook sender
│   └── schema.sql        Tables, RLS, realtime publication
├── metrics/
│   └── p95.ts            Rolling 1h P95, uptime, error budget
├── status/
│   ├── PublicStatus.tsx  Customer view
│   └── getStatus.ts      Snapshot + Supabase incident read
├── sre/
│   ├── SreConsole.tsx    Engineer view
│   └── resolve.ts        Admin-key manual resolve
├── shared/
│   ├── types.ts          Shared domain types
│   ├── ui.tsx            Badges + formatters
│   ├── supabase-server.ts
│   └── supabase-browser.ts
└── dashboard/
    └── PulseDashboard.tsx  Tab shell, polling, actions
```

## State + routing

| Window result | State | Incident |
| --- | --- | --- |
| 3/3 pass, avg <= 1000ms | `OPERATIONAL` | Auto-resolve |
| 1-2 fail or avg > 1000ms | `DEGRADED` | `INTERNAL` warning |
| 3/3 fail | `OUTAGE` | `PUBLIC` critical |

Only `PUBLIC` incidents appear on the customer status page. The public view
also renders `DEGRADED` services as operational until they become `OUTAGE`.

## Data flow

```text
instrumentation.ts
  -> poller/poller.ts
       -> probe services (services.ts)
       -> grade headers (security.ts)
       -> evaluate 3-check window (stateMachine.ts)
       -> route incident scope (INTERNAL / PUBLIC)
       -> persist + webhook (webhook.ts)
       -> return snapshot

metrics/p95.ts reads health_logs (rolling 1h) and feeds status/getStatus.ts.

app/api/poll             -> poller/route.ts
app/api/status           -> status/getStatus.ts
app/api/incidents/resolve -> sre/resolve.ts

PulseDashboard -> /api/poll every 5s + Supabase Realtime
```

## Change points

- Services: `poller/services.ts`
- Thresholds/window: `poller/stateMachine.ts`
- Incident scope: `poller/stateMachine.ts`
- Header scoring: `poller/security.ts`
- P95/error budget: `metrics/p95.ts`
- Customer view: `status/PublicStatus.tsx`
- Engineer view: `sre/SreConsole.tsx`
