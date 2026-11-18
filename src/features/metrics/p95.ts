import { getStore } from "../poller/store";
import { SERVICES } from "../poller/services";
import { supabaseAdmin } from "../shared/supabase-server";

const HOUR_MS = 60 * 60 * 1000;
const CACHE_MS = 5_000;
const SLO_TARGET = 99.9;

export type MetricPoint = {
  serviceId: string;
  latency: number;
  ok: boolean;
  checkedAt: string;
};

export type ServiceMetrics = {
  serviceId: string;
  p95: number;
  avgLatency: number;
  uptime: number;
  errorBudget: number;
  checks: number;
  failures: number;
};

export type RollingMetrics = {
  metrics: Map<string, ServiceMetrics>;
  source: "supabase" | "memory";
};

/** Nearest-rank P95. */
export function p95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

export function computeMetrics(points: MetricPoint[]): Map<string, ServiceMetrics> {
  const grouped = new Map<string, MetricPoint[]>();
  for (const point of points) {
    const rows = grouped.get(point.serviceId) ?? [];
    rows.push(point);
    grouped.set(point.serviceId, rows);
  }

  const metrics = new Map<string, ServiceMetrics>();
  for (const [serviceId, rows] of grouped) {
    const checks = rows.length;
    const failures = rows.filter((row) => !row.ok).length;
    const uptime = checks ? ((checks - failures) / checks) * 100 : 100;
    const failureRate = 100 - uptime;
    const budgetUsed = failureRate / (100 - SLO_TARGET);
    const latencies = rows.map((row) => row.latency);

    metrics.set(serviceId, {
      serviceId,
      p95: p95(latencies),
      avgLatency: latencies.reduce((sum, value) => sum + value, 0) / checks,
      uptime,
      errorBudget: Math.max(0, 100 - budgetUsed * 100),
      checks,
      failures,
    });
  }
  return metrics;
}

function memoryPoints(since: number): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const runtime of getStore().runtimes.values()) {
    for (const check of runtime.history) {
      if (new Date(check.checkedAt).getTime() < since) continue;
      points.push({
        serviceId: runtime.config.id,
        latency: check.latency,
        ok: check.ok,
        checkedAt: check.checkedAt,
      });
    }
  }
  return points;
}

async function supabasePoints(since: string): Promise<MetricPoint[] | null> {
  const supabase = supabaseAdmin();
  if (!supabase) return null;

  const queries = await Promise.all(
    SERVICES.map((service) =>
      supabase
        .from("health_logs")
        .select("latency_ms, ok, checked_at")
        .eq("service_id", service.id)
        .gte("checked_at", since)
        .order("checked_at", { ascending: false })
        .limit(1000),
    ),
  );

  if (queries.some((query) => query.error)) return null;

  return queries.flatMap((query, index) =>
    (query.data ?? []).map((row) => ({
      serviceId: SERVICES[index].id,
      latency: row.latency_ms,
      ok: row.ok,
      checkedAt: row.checked_at,
    })),
  );
}

const metricsGlobal = globalThis as unknown as {
  __pulseMetrics?: { at: number; value: RollingMetrics };
};

/** Rolling 1-hour P95 + uptime/error budget, cached for 30s. */
export async function getRollingMetrics(): Promise<RollingMetrics> {
  const cached = metricsGlobal.__pulseMetrics;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const since = new Date(Date.now() - HOUR_MS).toISOString();
  const remote = await supabasePoints(since);
  const source = remote?.length ? "supabase" : "memory";
  const points = remote?.length ? remote : memoryPoints(Date.now() - HOUR_MS);

  const value: RollingMetrics = {
    metrics: computeMetrics(points),
    source,
  };
  metricsGlobal.__pulseMetrics = { at: Date.now(), value };
  return value;
}
