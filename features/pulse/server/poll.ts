import { SERVICES } from "./services";
import { gradeSecurity } from "./security";
import { evaluateWindow } from "./state";
import { getStore, recordCheck, resolveOpenIncidents } from "./store";
import { getStatus } from "./status";
import { supabaseAdmin } from "./supabase";
import type {
  HealthCheck,
  Incident,
  ServiceConfig,
  StateChange,
  StatusPayload,
} from "../types";
import { sendStateWebhook } from "./webhook";

const POLL_MS = 5000;
const POLL_FRESH_MS = 4000;
const TIMEOUT_MS = 3500;

const pollGlobal = globalThis as unknown as {
  __pulseTimer?: ReturnType<typeof setInterval>;
};

async function probe(service: ServiceConfig): Promise<HealthCheck> {
  const started = performance.now();
  try {
    const response = await fetch(service.url, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "Pulse-Monitor/1.0" },
    });
    void response.body?.cancel();

    return {
      ok: response.ok,
      latency: Math.round(performance.now() - started),
      grade: gradeSecurity(response.headers),
      checkedAt: new Date().toISOString(),
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      ok: false,
      latency: Math.round(performance.now() - started),
      grade: "F",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "request failed",
    };
  }
}

async function persist(
  checks: HealthCheck[],
  changes: StateChange[],
  opened: Incident[],
  firstPoll: boolean,
): Promise<void> {
  const supabase = supabaseAdmin();
  if (!supabase) return;

  const store = getStore();

  // Services must exist before logs/incidents satisfy their foreign keys.
  await Promise.allSettled(
    [...store.runtimes.values()]
      .filter((runtime) => runtime.history.length > 0)
      .map((runtime) =>
        supabase.from("services").upsert({
          id: runtime.config.id,
          name: runtime.config.name,
          url: runtime.config.url,
          state: runtime.state,
          latency_ms: runtime.latency,
          grade: runtime.grade,
          last_checked_at: runtime.lastChecked,
        }),
      ),
  );

  const closes: PromiseLike<unknown>[] = [];

  for (const change of changes) {
    closes.push(
      supabase
        .from("incidents")
        .update({ status: "resolved", resolved_at: change.at })
        .eq("service_id", change.serviceId)
        .eq("status", "open"),
    );
  }

  if (firstPoll) {
    for (const runtime of store.runtimes.values()) {
      if (runtime.state !== "OPERATIONAL") continue;
      closes.push(
        supabase
          .from("incidents")
          .update({
            status: "resolved",
            resolved_at: new Date().toISOString(),
          })
          .eq("service_id", runtime.config.id)
          .eq("status", "open"),
      );
    }
  }

  // Close old incidents before inserting new ones so the update cannot match them.
  await Promise.allSettled(closes);

  const jobs: PromiseLike<unknown>[] = [];

  for (const [index, check] of checks.entries()) {
    jobs.push(
      supabase.from("health_logs").insert({
        service_id: SERVICES[index].id,
        ok: check.ok,
        latency_ms: check.latency,
        grade: check.grade,
        checked_at: check.checkedAt,
      }),
    );
  }

  for (const incident of opened) {
    jobs.push(
      supabase.from("incidents").insert({
        id: incident.id,
        service_id: incident.serviceId,
        severity: incident.severity,
        status: incident.status,
        title: incident.title,
        started_at: incident.startedAt,
      }),
    );
  }

  await Promise.allSettled(jobs);
}

async function runPoll(): Promise<void> {
  const store = getStore();
  const firstPoll = store.lastPoll === 0;
  const checks = await Promise.all(SERVICES.map(probe));
  const changes: StateChange[] = [];
  const opened: Incident[] = [];

  for (const [index, check] of checks.entries()) {
    const runtime = store.runtimes.get(SERVICES[index].id);
    if (!runtime) continue;

    const previous = runtime.state;
    recordCheck(runtime, check);
    runtime.state = evaluateWindow(runtime.window);

    const changed = runtime.state !== previous;
    if (changed) {
      const change: StateChange = {
        serviceId: runtime.config.id,
        serviceName: runtime.config.name,
        from: previous,
        to: runtime.state,
        latency: check.latency,
        grade: check.grade,
        at: check.checkedAt,
      };
      changes.push(change);
      resolveOpenIncidents(runtime.config.id, change.at);

      if (runtime.state !== "OPERATIONAL") {
        const incident: Incident = {
          id: crypto.randomUUID(),
          serviceId: runtime.config.id,
          serviceName: runtime.config.name,
          severity: runtime.state === "OUTAGE" ? "critical" : "warning",
          status: "open",
          title:
            runtime.state === "OUTAGE"
              ? `${runtime.config.name} outage`
              : `${runtime.config.name} performance degraded`,
          startedAt: change.at,
          resolvedAt: null,
        };
        opened.push(incident);
        store.incidents = [incident, ...store.incidents].slice(0, 60);
      }
    } else if (runtime.state === "OPERATIONAL") {
      resolveOpenIncidents(runtime.config.id, check.checkedAt);
    }
  }

  await persist(checks, changes, opened, firstPoll);
  await Promise.allSettled(changes.map(sendStateWebhook));
  store.lastPoll = Date.now();
}

export async function poll(force = false): Promise<StatusPayload> {
  const store = getStore();
  if (!force && Date.now() - store.lastPoll < POLL_FRESH_MS && store.lastPoll) {
    return getStatus();
  }
  if (store.inFlight) {
    await store.inFlight;
    return getStatus();
  }

  store.inFlight = runPoll()
    .catch(() => undefined)
    .finally(() => {
      store.inFlight = null;
      store.lastPoll = Date.now();
    });
  await store.inFlight;
  return getStatus();
}

export function startPoller(): void {
  if (pollGlobal.__pulseTimer) return;
  void poll(true);
  pollGlobal.__pulseTimer = setInterval(() => void poll(true), POLL_MS);
}
