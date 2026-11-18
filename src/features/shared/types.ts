export const STATES = ["OPERATIONAL", "DEGRADED", "OUTAGE"] as const;
export type ServiceState = (typeof STATES)[number];
export type SecurityGrade = "A" | "B";
export type Severity = "critical" | "warning";
export type IncidentStatus = "open" | "resolved";
export type IncidentScope = "PUBLIC" | "INTERNAL";

export type ServiceConfig = {
  id: string;
  name: string;
  url: string;
  description: string;
};

export type HealthCheck = {
  ok: boolean;
  latency: number;
  grade: SecurityGrade;
  checkedAt: string;
  error?: string;
};

export type ServiceSnapshot = {
  id: string;
  name: string;
  description: string;
  url: string;
  state: ServiceState;
  outageCycles: number;
  latency: number;
  p95: number;
  grade: SecurityGrade;
  lastChecked: string | null;
  history: { ok: boolean; latency: number }[];
  outageHistory: boolean[];
  uptime: number;
  checks: number;
  failures: number;
};

export type Incident = {
  id: string;
  serviceId: string;
  serviceName: string;
  severity: Severity;
  scope: IncidentScope;
  status: IncidentStatus;
  title: string;
  resolutionMethod?: "rollback" | "auto-heal" | "manual" | "auto";
  startedAt: string;
  resolvedAt: string | null;
};

export type SlaRow = {
  serviceId: string;
  serviceName: string;
  state: ServiceState;
  uptime: number;
  avgLatency: number;
  p95: number;
  errorBudget: number;
  checks: number;
  failures: number;
};

export type StatusPayload = {
  services: ServiceSnapshot[];
  incidents: Incident[];
  audit: AuditEntry[];
  auditValid: boolean;
  slaMet: boolean;
  webhooks: WebhookEvent[];
  sla: SlaRow[];
  updatedAt: string;
  source: "memory" | "supabase";
};

export type StateChange = {
  serviceId: string;
  serviceName: string;
  from: ServiceState;
  to: ServiceState;
  scope: IncidentScope | null;
  latency: number;
  grade: SecurityGrade;
  at: string;
};

export type AuditEntry = {
  id: number;
  actor: string;
  action: string;
  serviceId: string;
  incidentId: string;
  at: string;
  previousHash: string;
  hash: string;
};

export type WebhookEvent = { at: string; verified: boolean; body: unknown };
