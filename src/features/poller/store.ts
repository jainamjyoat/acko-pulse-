import { SERVICES } from "./services";
import type {
  HealthCheck,
  Incident,
  SecurityGrade,
  ServiceConfig,
  ServiceState,
} from "../shared/types";

export type Runtime = {
  config: ServiceConfig;
  window: HealthCheck[];
  history: HealthCheck[];
  outageHistory: boolean[];
  state: ServiceState;
  outageCycles: number;
  latency: number;
  grade: SecurityGrade;
  lastChecked: string | null;
};

export type Store = {
  runtimes: Map<string, Runtime>;
  incidents: Incident[];
  audit: import("../shared/types").AuditEntry[];
  lastPoll: number;
  inFlight: Promise<void> | null;
  alertOpen: Set<string>;
  pendingHealing: Map<string, "rollback" | "auto-heal">;
  receivedWebhooks: { at: string; verified: boolean; body: unknown }[];
  lastRealtimePublish: number;
};

const HISTORY_LIMIT = 720;

function seed(): Store {
  const runtimes = new Map<string, Runtime>();
  for (const config of SERVICES) {
    runtimes.set(config.id, {
      config,
      window: [],
      history: [],
      outageHistory: [],
      state: "OPERATIONAL",
      outageCycles: 0,
      latency: 0,
      grade: "B",
      lastChecked: null,
    });
  }
  return {
    runtimes,
    incidents: [],
    audit: [],
    lastPoll: 0,
    inFlight: null,
    alertOpen: new Set(),
    pendingHealing: new Map(),
    receivedWebhooks: [],
    lastRealtimePublish: 0,
  };
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
  getStore().alertOpen.delete(serviceId);
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
  runtime.outageHistory = [];
  runtime.state = "OPERATIONAL";
  runtime.outageCycles = 0;
  getStore().alertOpen.delete(serviceId);
  return runtime;
}
