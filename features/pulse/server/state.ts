import type { HealthCheck, ServiceState } from "../types";

export const WINDOW_SIZE = 3;
export const LATENCY_BUDGET_MS = 1000;

/** Last-3 sliding window: 3/3 fail -> OUTAGE; 1-2 fail or avg > 1s -> DEGRADED. */
export function evaluateWindow(window: HealthCheck[]): ServiceState {
  const failures = window.filter((check) => !check.ok).length;
  const avgLatency =
    window.reduce((sum, check) => sum + check.latency, 0) / window.length;

  if (window.length === WINDOW_SIZE && failures === WINDOW_SIZE) return "OUTAGE";
  if (failures > 0 || avgLatency > LATENCY_BUDGET_MS) return "DEGRADED";
  return "OPERATIONAL";
}
