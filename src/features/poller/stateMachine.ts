import type {
  HealthCheck,
  IncidentScope,
  ServiceState,
  Severity,
} from "../shared/types";

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

export type IncidentRoute = {
  severity: Severity;
  scope: IncidentScope;
  title: string;
};

/** Internal degradation stays internal; only a full outage is customer-facing. */
export function routeIncident(
  serviceName: string,
  state: ServiceState,
): IncidentRoute | null {
  if (state === "OUTAGE") {
    return {
      severity: "critical",
      scope: "PUBLIC",
      title: `${serviceName} outage`,
    };
  }
  if (state === "DEGRADED") {
    return {
      severity: "warning",
      scope: "INTERNAL",
      title: `${serviceName} internal degradation`,
    };
  }
  return null;
}
