import { getRollingMetrics, type RollingMetrics } from "../metrics/p95";
import { getAuditTrail, verifyAuditTrail } from "../audit/hashChain";
import { getStore } from "../poller/store";
import { supabaseAdmin } from "../shared/supabase-server";
import type {
  AuditEntry,
  Incident,
  IncidentScope,
  SlaRow,
  StatusPayload,
} from "../shared/types";

const BAR_CHECKS = 20;

type IncidentRow = {
  id: string;
  service_id: string;
  severity: "critical" | "warning";
  scope: IncidentScope | null;
  status: "open" | "resolved";
  title: string;
  started_at: string;
  resolved_at: string | null;
  resolution_method: "rollback" | "auto-heal" | "manual" | "auto" | null;
};

export function buildStatus(rolling: RollingMetrics): StatusPayload {
  const store = getStore();
  const audit: AuditEntry[] = [];

  const services = [...store.runtimes.values()].map((runtime) => {
    const metric = rolling.metrics.get(runtime.config.id);
    const checks = metric?.checks ?? runtime.history.length;
    const failures =
      metric?.failures ?? runtime.history.filter((check) => !check.ok).length;

    return {
      id: runtime.config.id,
      name: runtime.config.name,
      description: runtime.config.description,
      url: runtime.config.url,
      state: runtime.state,
      outageCycles: runtime.outageCycles,
      latency: runtime.latency,
      p95: metric?.p95 ?? 0,
      grade: runtime.grade,
      lastChecked: runtime.lastChecked,
      history: runtime.history.slice(-BAR_CHECKS).map((check) => ({
        ok: check.ok,
        latency: check.latency,
      })),
      outageHistory: runtime.outageHistory,
      uptime: metric?.uptime ?? (checks ? ((checks - failures) / checks) * 100 : 100),
      checks,
      failures,
    };
  });

  const sla: SlaRow[] = services.map((service) => {
    const metric = rolling.metrics.get(service.id);
    return {
      serviceId: service.id,
      serviceName: service.name,
      state: service.state,
      uptime: service.uptime,
      avgLatency: metric?.avgLatency ?? 0,
      p95: service.p95,
      errorBudget: metric?.errorBudget ?? 100,
      checks: service.checks,
      failures: service.failures,
    };
  });

  return {
    services,
    incidents: [...store.incidents]
      .map((incident) => ({
        ...incident,
        scope:
          incident.scope ??
          (incident.severity === "warning" ? "INTERNAL" : "PUBLIC"),
      }))
      .sort(
        (a, b) =>
          Number(b.status === "open") - Number(a.status === "open") ||
          b.startedAt.localeCompare(a.startedAt),
      ),
    audit,
    auditValid: verifyAuditTrail(audit),
    slaMet: sla.every((row) => row.uptime >= 99.9),
    webhooks: store.receivedWebhooks,
    sla,
    updatedAt: new Date(store.lastPoll || Date.now()).toISOString(),
    source: rolling.source,
  };
}

export async function getStatus(): Promise<StatusPayload> {
  const rolling = await getRollingMetrics();
  const payload = buildStatus(rolling);
  payload.audit = await getAuditTrail();
  payload.auditValid = verifyAuditTrail(payload.audit);
  const webhookModule = await import("../webhooks/verify");
  payload.webhooks = await webhookModule.getWebhookEvents();
  const supabase = supabaseAdmin();
  if (!supabase) return payload;

  const { data, error } = await supabase
    .from("incidents")
    .select(
      "id, service_id, severity, scope, status, title, started_at, resolved_at, resolution_method",
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
      scope: row.scope ?? (row.severity === "warning" ? "INTERNAL" : "PUBLIC"),
      status: row.status,
      title: row.title,
      resolutionMethod: row.resolution_method ?? undefined,
      startedAt: row.started_at,
      resolvedAt: row.resolved_at,
    }),
  );
  payload.audit = await getAuditTrail();
  payload.auditValid = verifyAuditTrail(payload.audit);
  payload.source = "supabase";
  return payload;
}
