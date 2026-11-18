"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "../shared/supabase-browser";
import type { ServiceState, StatusPayload } from "../shared/types";
import PublicStatus from "../status/PublicStatus";
import SreConsole from "../sre/SreConsole";
import { stateDot, stateStyles } from "../shared/ui";

const EMPTY: StatusPayload = {
  services: [],
  incidents: [],
  sla: [],
  webhooks: [],
  audit: [],
  auditValid: true,
  slaMet: true,
  updatedAt: "",
  source: "memory",
};

function engineeringState(status: StatusPayload): ServiceState | "STARTING" {
  if (!status.services.length) return "STARTING";
  if (status.services.some((service) => service.state === "OUTAGE")) {
    return "OUTAGE";
  }
  if (status.services.some((service) => service.state === "DEGRADED")) {
    return "DEGRADED";
  }
  return "OPERATIONAL";
}

/** Customer view ignores internal degradation. */
function customerState(status: StatusPayload): ServiceState | "STARTING" {
  if (!status.services.length) return "STARTING";
  return status.services.some((service) => service.state === "OUTAGE")
    ? "OUTAGE"
    : "OPERATIONAL";
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
        <svg
          viewBox="0 0 32 32"
          className="size-5 text-emerald-300"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 18h6l3-9 5 17 4-12 3 4h7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div>
        <p className="font-semibold tracking-tight text-slate-100">Pulse</p>
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-600">
          Service monitor
        </p>
      </div>
    </div>
  );
}

export default function PulseDashboard() {
  const [status, setStatus] = useState<StatusPayload>(EMPTY);
  const [tab, setTab] = useState<"public" | "sre">("public");
  const [adminKey, setAdminKey] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [connError, setConnError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as StatusPayload);
    } catch {
      // The five-second poll below owns the connection error state.
    }
  }, []);

  useEffect(() => {
    let active = true;

    const tick = async () => {
      try {
        const response = await fetch("/api/poll", { cache: "no-store" });
        if (!response.ok) throw new Error("poll failed");
        const data = (await response.json()) as StatusPayload;
        if (!active) return;
        setStatus(data);
        setConnError(null);
      } catch {
        if (active) setConnError("Monitor API unreachable. Retrying...");
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), 5000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;

    const channel = supabase
      .channel("pulse-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "services" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "state_events" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "audit_logs" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "webhook_events" },
        () => void refresh(),
      )
      .on(
        "broadcast",
        { event: "state_transition" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incidents" },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const resolve = async (id: string) => {
    if (!adminKey) return;
    setBusyId(id);
    setResolveError(null);

    try {
      const response = await fetch("/api/incidents/manual-resolve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json()) as StatusPayload & {
        error?: string;
      };

      if (!response.ok) {
        setResolveError(data.error ?? "Unable to resolve incident");
        return;
      }
      await refresh();
    } catch {
      setResolveError("Resolve request failed");
    } finally {
      setBusyId(null);
    }
  };

  const rollback = async (id: string) => {
    if (!adminKey) return;
    setBusyId(id);
    setResolveError(null);
    try {
      const response = await fetch("/api/incidents/resolve", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setResolveError(result.error ?? "Rollback failed");
        return;
      }
      const expires = Date.now() + 180_000;
      while (Date.now() < expires) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const snapshot = await fetch("/api/poll", { cache: "no-store" });
        if (!snapshot.ok) continue;
        const next = (await snapshot.json()) as StatusPayload;
        setStatus(next);
        const incident = next.incidents.find((row) => row.id === id);
        if (incident?.status === "resolved") return;
      }
      setResolveError("Recovery not confirmed after 3 minutes; incident remains open");
    } catch {
      setResolveError("Rollback request failed");
    } finally {
      setBusyId(null);
    }
  };

  const overall =
    tab === "public" ? customerState(status) : engineeringState(status);
  const updatedAt = status.updatedAt
    ? new Date(status.updatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "waiting for first poll";

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Brand />
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] px-3 py-1.5 font-mono text-[10px] text-slate-500 sm:inline-flex">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              LIVE · 5s
            </span>
            <span className="font-mono text-[10px] text-slate-600">
              {status.source === "supabase" ? "supabase" : "in-process"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-600">
              Public reliability
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-100">
              System status
            </h1>
            <p className="mt-2 max-w-lg text-sm text-slate-500">
              Four microservices probed every five seconds. State is decided by
              the last three checks.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            {overall === "STARTING" ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[10px] font-semibold tracking-[0.14em] text-slate-400">
                <span className="size-1.5 animate-pulse rounded-full bg-slate-400" />
                STARTING
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold tracking-[0.14em] ${stateStyles[overall]}`}
              >
                <span
                  className={`size-1.5 rounded-full ${stateDot[overall]} ${
                    overall === "OPERATIONAL" ? "" : "animate-pulse"
                  }`}
                />
                {overall}
              </span>
            )}
            <span className="font-mono text-[10px] text-slate-600">
              updated {updatedAt}
            </span>
          </div>
        </div>

        <div className="mt-7 flex items-center gap-1 border-b border-white/[0.06]">
          {(
            [
              ["public", "Public status"],
              ["sre", "SRE console"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`-mb-px border-b px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === value
                  ? "border-emerald-400/60 text-slate-100"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {connError ? (
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-2.5 text-xs text-amber-300">
            {connError}
          </p>
        ) : null}

        <div className="mt-5">
          {status.services.length === 0 && !connError ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-56 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]"
                />
              ))}
            </div>
          ) : tab === "public" ? (
            <PublicStatus status={status} />
          ) : (
            <SreConsole
              status={status}
              adminKey={adminKey}
              setAdminKey={setAdminKey}
              onResolve={resolve}
              onRollback={rollback}
              busyId={busyId}
              error={resolveError}
            />
          )}
        </div>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 pb-8 text-[10px] text-slate-600">
        <span>HMAC-SHA256 webhooks fire on state transitions only.</span>
        <span className="font-mono">window 3 · threshold 1000ms</span>
      </footer>
    </div>
  );
}
