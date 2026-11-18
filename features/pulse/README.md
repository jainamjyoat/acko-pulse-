# Pulse feature

Everything specific to the service monitor lives here. Next.js route files in
`app/api` are thin adapters so the feature stays easy to find.

```text
features/pulse/
├── types.ts                 Shared domain types
├── client/
│   └── supabase.ts          Browser Supabase client for Realtime
├── components/
│   ├── PulseDashboard.tsx   Header, tabs, polling, resolve actions
│   ├── PublicStatus.tsx     Service cards, uptime bars, incident feed
│   ├── SreConsole.tsx       SLA table, error budget, admin resolve
│   └── ui.tsx               Badges and formatting helpers
├── db/
│   └── schema.sql           Tables, RLS, indexes, realtime publication
└── server/
    ├── services.ts          The four monitored targets
    ├── state.ts             Last-3-check state machine
    ├── security.ts          Security header grading
    ├── store.ts             globalThis runtime + incident store
    ├── poll.ts              5s poller, persistence, webhooks
    ├── status.ts            Snapshot builder + Supabase incident read
    ├── resolve.ts           Admin-key protected manual resolve
    ├── webhook.ts           HMAC-SHA256 webhook sender
    └── supabase.ts          Server Supabase client
```

## Data flow

```text
instrumentation.ts
  └─ server/poll.ts
       ├─ probe 4 services (services.ts)
       ├─ grade headers (security.ts)
       ├─ update 3-check window (state.ts + store.ts)
       ├─ sync Postgres (supabase.ts + db/schema.sql)
       ├─ send transitions only (webhook.ts)
       └─ return snapshot (status.ts)

app/api/poll      → server/poll.ts
app/api/status    → server/status.ts
app/api/.../resolve → server/resolve.ts

PulseDashboard → /api/poll every 5s + Supabase Realtime
```

## Change points

- Add/remove a service: `server/services.ts`
- Change thresholds/window: `server/state.ts`
- Change header scoring: `server/security.ts`
- Change incident titles/persistence: `server/poll.ts`
- Change UI tabs: `components/PulseDashboard.tsx`
