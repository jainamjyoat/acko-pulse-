import { resetUrl, SERVICES } from "./services";
import { gradeSecurity } from "./security";
import { evaluateWindow, routeIncident } from "./stateMachine";
import { getStore, recordCheck, resolveOpenIncidents } from "./store";
import { sendIncidentWebhook } from "./webhook";
import { appendAudit } from "../audit/hashChain";
import { getStatus } from "../status/getStatus";
import { supabaseAdmin } from "../shared/supabase-server";
import type {
  HealthCheck,
  Incident,
  ServiceConfig,
  StateChange,
  StatusPayload,
} from "../shared/types";

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
      grade: "B",
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "request failed",
    };
  }
}

async function persist(
  checks: HealthCheck[],
  changes: StateChange[],
  opened: Incident[],
  changedIncidents: Incident[],
  recovered: Incident[],
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
        scope: incident.scope,
        status: incident.status,
        title: incident.title,
        started_at: incident.startedAt,
      }),
    );
  }

  for (const incident of changedIncidents) {
    jobs.push(
      supabase
        .from("incidents")
        .update({ severity: incident.severity, scope: incident.scope, title: incident.title })
        .eq("id", incident.id),
    );
  }

  for (const incident of recovered) {
    jobs.push(
      supabase
        .from("incidents")
        .update({
          status: "resolved",
          resolved_at: incident.resolvedAt,
          resolution_method: incident.resolutionMethod ?? "auto",
        })
        .eq("id", incident.id),
    );
  }

  if (changes.length) {
    jobs.push(
      supabase.from("state_events").insert(
        changes.map((change) => ({
          service_id: change.serviceId,
          from_state: change.from,
          to_state: change.to,
          scope: change.scope,
          payload: change,
        })),
      ),
    );
  }

  await Promise.allSettled(jobs);
}

async function runPoll(): Promise<void> {
  const store = getStore();
  const checks = await Promise.all(SERVICES.map(probe));
  const changes: StateChange[] = [];
  const opened: Incident[] = [];
  const changedIncidents: Incident[] = [];
  const recoveries: Incident[] = [];

  for (const [index, check] of checks.entries()) {
    const runtime = store.runtimes.get(SERVICES[index].id);
    if (!runtime) continue;

    const previous = runtime.state;
    recordCheck(runtime, check);
    runtime.state = evaluateWindow(runtime.window, runtime.state);
    runtime.outageHistory = [
      ...runtime.outageHistory,
      runtime.state === "OUTAGE",
    ].slice(-20);
    runtime.outageCycles =
      runtime.state === "OUTAGE" ? runtime.outageCycles + 1 : 0;

    if (
      runtime.state === "OPERATIONAL" &&
      runtime.window.length === 3 &&
      runtime.window.every((row) => row.ok)
    ) {
      const pendingMethod = store.pendingHealing.get(runtime.config.id);
      const recovered = store.incidents.find(
        (incident) =>
          incident.serviceId === runtime.config.id && incident.status === "open",
      );
      if (pendingMethod && recovered) {
        recovered.resolutionMethod = pendingMethod;
        store.pendingHealing.delete(runtime.config.id);
        store.alertOpen.delete(runtime.config.id);
        resolveOpenIncidents(runtime.config.id, check.checkedAt);
        recovered.resolutionMethod = pendingMethod;
        recovered.resolvedAt = check.checkedAt;
        recoveries.push(recovered);
        void appendAudit(
          pendingMethod === "auto-heal" ? "system" : "engineer",
          `incident.recovered.${pendingMethod}`,
          runtime.config.id,
          recovered.id,
        ).catch(() => undefined);
        void sendIncidentWebhook({
          event: "incident.recovered",
          incidentId: recovered.id,
          serviceId: runtime.config.id,
          method: pendingMethod,
          at: check.checkedAt,
        });
      }
    }

    if (
      runtime.state === "OUTAGE" &&
      runtime.outageCycles >= 5 &&
      ["payments", "claims"].includes(runtime.config.id) &&
      !store.pendingHealing.has(runtime.config.id)
    ) {
      const active = store.incidents.find(
        (incident) =>
          incident.serviceId === runtime.config.id && incident.status === "open",
      );
      if (active) {
        store.pendingHealing.set(runtime.config.id, "auto-heal");
        void fetch(resetUrl(runtime.config), {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        }).then(async (response) => {
          if (!response.ok) throw new Error(`reset failed: ${response.status}`);
          void appendAudit("system", "incident.rollback.auto-heal", runtime.config.id, active.id).catch(() => undefined);
        }).catch(() => {
          store.pendingHealing.delete(runtime.config.id);
        });
      }
    }

    const changed = runtime.state !== previous;
    if (!changed) {
      if (runtime.state === "OPERATIONAL") {
        resolveOpenIncidents(runtime.config.id, check.checkedAt);
      }
      continue;
    }

    const route = routeIncident(runtime.config.name, runtime.state);
    const change: StateChange = {
      serviceId: runtime.config.id,
      serviceName: runtime.config.name,
      from: previous,
      to: runtime.state,
      scope: route?.scope ?? null,
      latency: check.latency,
      grade: check.grade,
      at: check.checkedAt,
    };
    changes.push(change);

    if (!route) {
      const recovered = store.incidents.find(
        (incident) =>
          incident.serviceId === runtime.config.id && incident.status === "open",
      );
      if (recovered) {
        resolveOpenIncidents(runtime.config.id, change.at);
        recovered.resolutionMethod = "auto";
        recoveries.push(recovered);
      }
      continue;
    }

    const hasOpen = store.incidents.some(
      (incident) =>
        incident.serviceId === runtime.config.id && incident.status === "open",
    );
    if (hasOpen) {
      const current = store.incidents.find(
        (incident) =>
          incident.serviceId === runtime.config.id && incident.status === "open",
      )!;
      current.severity = route.severity;
      current.scope = route.scope;
      current.title = route.title;
      changedIncidents.push(current);
      continue;
    }

    const incident: Incident = {
      id: crypto.randomUUID(),
      serviceId: runtime.config.id,
      serviceName: runtime.config.name,
      severity: route.severity,
      scope: route.scope,
      status: "open",
      title: route.title,
      startedAt: change.at,
      resolvedAt: null,
    };
    opened.push(incident);
    store.incidents = [incident, ...store.incidents].slice(0, 60);
    store.alertOpen.add(runtime.config.id);
  }

  await persist(checks, changes, opened, changedIncidents, recoveries);
  await Promise.allSettled([
    ...opened.map((incident) =>
      sendIncidentWebhook({ event: "incident.opened", ...incident }),
    ),
    ...recoveries.map((incident) =>
      sendIncidentWebhook({
        event: "incident.recovered",
        incidentId: incident.id,
        serviceId: incident.serviceId,
        method: incident.resolutionMethod,
        at: incident.resolvedAt,
      }),
    ),
  ]);
  const supabase = supabaseAdmin();
  if (
    supabase &&
    (changes.length > 0 || opened.length > 0 || recoveries.length > 0) &&
    Date.now() - store.lastRealtimePublish >= 1000
  ) {
    store.lastRealtimePublish = Date.now();
    await supabase.channel("pulse-state-events").send({
      type: "broadcast",
      event: "state_transition",
      payload: { changes, opened, recoveries },
    });
  }
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
      const metrics = globalThis as unknown as {
        __pulseMetrics?: { at: number; value: unknown };
      };
      delete metrics.__pulseMetrics;
    });
  await store.inFlight;
  return getStatus();
}

export function startPoller(): void {
  if (pollGlobal.__pulseTimer) return;
  void poll(true);
  pollGlobal.__pulseTimer = setInterval(() => void poll(true), POLL_MS);
}
