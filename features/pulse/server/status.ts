import { getStore } from "./store";
import { supabaseAdmin } from "./supabase";
import type { Incident, SlaRow, StatusPayload } from "../types";

const SLO_TARGET = 99.9;
const BAR_CHECKS = 30;

type IncidentRow = {
  id: string;
  service_id: string;
  severity: "critical" | "warning";
  status: "open" | "resolved";
  title: string;
  started_at: string;
  resolved_at: string | null;
};

export function buildMemoryStatus(): StatusPayload {
  const store = getStore();

  const services = [...store.runtimes.values()].map((runtime) => {
    const checks = runtime.history.length;
    const failures = runtime.history.filter((check) => !check.ok).length;

    return {
      id: runtime.config.id,
      name: runtime.config.name,
      description: runtime.config.description,
      url: runtime.config.url,
      state: runtime.state,
      latency: runtime.latency,
      grade: runtime.grade,
      lastChecked: runtime.lastChecked,
      history: runtime.history.slice(-BAR_CHECKS).map((check) => ({
        ok: check.ok,
        latency: check.latency,
      })),
      uptime: checks ? ((checks - failures) / checks) * 100 : 100,
      checks,
      failures,
    };
  });

  const sla: SlaRow[] = services.map((service) => {
    const failureRate = service.checks
      ? (service.failures / service.checks) * 100
      : 0;
    const budgetUsed = (failureRate / (100 - SLO_TARGET)) * 100;

    return {
      serviceId: service.id,
      serviceName: service.name,
      state: service.state,
      uptime: service.uptime,
      avgLatency: service.history.length
        ? service.history.reduce((sum, row) => sum + row.latency, 0) /
          service.history.length
        : 0,
      errorBudget: Math.max(0, 100 - budgetUsed),
      checks: service.checks,
      failures: service.failures,
    };
  });

  return {
    services,
    incidents: [...store.incidents].sort(
      (a, b) =>
        Number(b.status === "open") - Number(a.status === "open") ||
        b.startedAt.localeCompare(a.startedAt),
    ),
    sla,
    updatedAt: new Date(store.lastPoll || Date.now()).toISOString(),
    source: "memory",
  };
}

export async function getStatus(): Promise<StatusPayload> {
  const payload = buildMemoryStatus();
  const supabase = supabaseAdmin();
  if (!supabase) return payload;

  const { data, error } = await supabase
    .from("incidents")
    .select(
      "id, service_id, severity, status, title, started_at, resolved_at",
    )
    .order("started_at", { ascending: false })
    .limit(30);

  if (error || !data) return payload;

  const names = new Map(
    [...getStore().runtimes.values()].map((runtime) => [
      runtime.config.id,
      runtime.config.name,
    ]),
  );

  payload.incidents = (data as IncidentRow[]).map(
    (row): Incident => ({
      id: row.id,
      serviceId: row.service_id,
      serviceName: names.get(row.service_id) ?? row.service_id,
      severity: row.severity,
      status: row.status,
      title: row.title,
      startedAt: row.started_at,
      resolvedAt: row.resolved_at,
    }),
  );
  payload.source = "supabase";
  return payload;
}
