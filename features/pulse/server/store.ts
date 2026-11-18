import { SERVICES } from "./services";
import type {
  HealthCheck,
  Incident,
  SecurityGrade,
  ServiceConfig,
  ServiceState,
} from "../types";

export type Runtime = {
  config: ServiceConfig;
  window: HealthCheck[];
  history: HealthCheck[];
  state: ServiceState;
  latency: number;
  grade: SecurityGrade;
  lastChecked: string | null;
};

export type Store = {
  runtimes: Map<string, Runtime>;
  incidents: Incident[];
  lastPoll: number;
  inFlight: Promise<void> | null;
};

const HISTORY_LIMIT = 720;

function seed(): Store {
  const runtimes = new Map<string, Runtime>();
  for (const config of SERVICES) {
    runtimes.set(config.id, {
      config,
      window: [],
      history: [],
      state: "OPERATIONAL",
      latency: 0,
      grade: "F",
      lastChecked: null,
    });
  }
  return { runtimes, incidents: [], lastPoll: 0, inFlight: null };
}

const pulseGlobal = globalThis as unknown as { __pulseStore?: Store };

/** Survives HMR and module reloads inside one server process. */
export function getStore(): Store {
  return (pulseGlobal.__pulseStore ??= seed());
}

export function recordCheck(runtime: Runtime, check: HealthCheck): void {
  runtime.window = [...runtime.window, check].slice(-3);
  runtime.history = [...runtime.history, check].slice(-HISTORY_LIMIT);
  runtime.latency = check.latency;
  runtime.grade = check.grade;
  runtime.lastChecked = check.checkedAt;
}

export function resolveOpenIncidents(serviceId: string, at: string): void {
  for (const incident of getStore().incidents) {
    if (incident.serviceId === serviceId && incident.status === "open") {
      incident.status = "resolved";
      incident.resolvedAt = at;
    }
  }
}

export function resetService(serviceId: string): Runtime | undefined {
  const runtime = getStore().runtimes.get(serviceId);
  if (!runtime) return undefined;
  runtime.window = [];
  runtime.state = "OPERATIONAL";
  return runtime;
}
