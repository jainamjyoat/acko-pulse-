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

const pulseGlobal = globalThis as unknown as { __pulseStore?: Partial<Store> };

/** Reconcile state across Next.js HMR versions without discarding live checks. */
export function getStore(): Store {
  const existing = pulseGlobal.__pulseStore;
  if (!existing) {
    const fresh = seed();
    pulseGlobal.__pulseStore = fresh;
    return fresh;
  }

  const defaults = seed();
  const store = existing as Store;

  if (!(store.runtimes instanceof Map)) store.runtimes = defaults.runtimes;
  for (const [id, runtime] of store.runtimes) {
    const config = SERVICES.find((service) => service.id === id);
    if (!config || !runtime || typeof runtime !== "object") {
      store.runtimes.delete(id);
      continue;
    }
    runtime.config = config;
    runtime.window = Array.isArray(runtime.window) ? runtime.window.slice(-3) : [];
    runtime.history = Array.isArray(runtime.history)
      ? runtime.history.slice(-HISTORY_LIMIT)
      : [];
    runtime.outageHistory = Array.isArray(runtime.outageHistory)
      ? runtime.outageHistory.slice(-20)
      : [];
    runtime.outageCycles = Number.isFinite(runtime.outageCycles)
      ? runtime.outageCycles
      : 0;
    runtime.latency = Number.isFinite(runtime.latency) ? runtime.latency : 0;
    runtime.grade = runtime.grade === "A" ? "A" : "B";
    runtime.lastChecked ??= null;
  }
  for (const config of SERVICES) {
    if (!store.runtimes.has(config.id)) {
      store.runtimes.set(config.id, defaults.runtimes.get(config.id)!);
    }
  }

  store.incidents = Array.isArray(store.incidents) ? store.incidents : [];
  store.audit = Array.isArray(store.audit) ? store.audit : [];
  store.lastPoll = Number.isFinite(store.lastPoll) ? store.lastPoll : 0;
  store.inFlight ??= null;
  store.alertOpen = store.alertOpen instanceof Set ? store.alertOpen : new Set();
  store.pendingHealing =
    store.pendingHealing instanceof Map ? store.pendingHealing : new Map();
  store.receivedWebhooks = Array.isArray(store.receivedWebhooks)
    ? store.receivedWebhooks
    : [];
  store.lastRealtimePublish = Number.isFinite(store.lastRealtimePublish)
    ? store.lastRealtimePublish
    : 0;

  pulseGlobal.__pulseStore = store;
  return store;
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
