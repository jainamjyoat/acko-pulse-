import type { StatusPayload } from "../shared/types";
import AuditTrail from "../audit/AuditTrail";
import WebhookReceiver from "../webhooks/WebhookReceiver";
import {
  GradeBadge,
  ms,
  pct,
  ScopeBadge,
  StateBadge,
  timeAgo,
} from "../shared/ui";

type Props = {
  status: StatusPayload;
  adminKey: string;
  setAdminKey: (key: string) => void;
  onResolve: (id: string) => void;
  onRollback: (id: string) => void;
  busyId: string | null;
  error: string | null;
};

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-600">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl text-slate-100">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

export default function SreConsole({
  status,
  adminKey,
  setAdminKey,
  onResolve,
  onRollback,
  busyId,
  error,
}: Props) {
  const openIncidents = status.incidents.filter(
    (incident) => incident.status === "open",
  );
  const totalChecks = status.sla.reduce((sum, row) => sum + row.checks, 0);
  const totalFailures = status.sla.reduce((sum, row) => sum + row.failures, 0);
  const availability = totalChecks
    ? ((totalChecks - totalFailures) / totalChecks) * 100
    : 100;
  const budget = status.sla.length
    ? status.sla.reduce((sum, row) => sum + row.errorBudget, 0) /
      status.sla.length
    : 100;
  const worstP95 = status.sla.length
    ? Math.max(...status.sla.map((row) => row.p95))
    : 0;
  const grades = new Map(
    status.services.map((service) => [service.id, service.grade]),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-600">Availability</p>
          <p className="mt-2 font-mono text-2xl text-slate-100">{pct(availability)}</p>
          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold ${status.slaMet ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>
            {status.slaMet ? "SLA MET" : "BREACHED"}
          </span>
          <p className="mt-1 text-[11px] text-slate-500">{totalChecks} checks in 1h sample</p>
        </div>
        <Metric
          label="Error budget"
          value={pct(budget, 1)}
          detail="Remaining against 99.9% SLO"
        />
        <Metric
          label="Open incidents"
          value={String(openIncidents.length)}
          detail="Public + internal"
        />
        <Metric
          label="Worst P95"
          value={ms(worstP95)}
          detail="Rolling 1-hour latency"
        />
      </div>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              SLA / error budget
            </h2>
            <p className="mt-1 text-[11px] text-slate-500">
              Rolling 1-hour metrics · target 99.9%
            </p>
          </div>
          <span className="rounded-full border border-white/[0.08] px-2.5 py-1 font-mono text-[10px] text-slate-500">
            win: 3 · cadence: 5s
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-[0.14em] text-slate-600">
              <tr className="border-b border-white/[0.06]">
                <th className="px-5 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Uptime</th>
                <th className="px-4 py-3 font-medium">P95 latency</th>
                <th className="px-4 py-3 font-medium">Error budget</th>
                <th className="px-5 py-3 text-right font-medium">Security</th>
              </tr>
            </thead>
            <tbody>
              {status.sla.map((row) => (
                <tr
                  key={row.serviceId}
                  className="border-b border-white/[0.04] last:border-0"
                >
                  <td className="px-5 py-3.5">
                    <span className="font-medium text-slate-200">
                      {row.serviceName}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-600">
                      {row.failures} failed / {row.checks} checks
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <StateBadge state={row.state} />
                  </td>
                  <td className="px-4 py-3.5 font-mono text-slate-300">
                    {pct(row.uptime)}
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`font-mono ${
                        row.p95 > 1000
                          ? "font-semibold text-amber-300"
                          : "text-slate-400"
                      }`}
                    >
                      {ms(row.p95)}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-600">
                      avg {ms(row.avgLatency)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={`h-full rounded-full ${
                            row.errorBudget < 20
                              ? "bg-red-400"
                              : row.errorBudget < 50
                                ? "bg-amber-400"
                                : "bg-emerald-400"
                          }`}
                          style={{ width: `${Math.max(2, row.errorBudget)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">
                        {pct(row.errorBudget, 1)}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <GradeBadge grade={grades.get(row.serviceId) ?? "B"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
          <h2 className="text-sm font-semibold text-slate-100">
            Incident resolution
          </h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Manual resolve clears the window and returns the service to
            operational. The next three checks re-evaluate it.
          </p>

          <div className="mt-4 space-y-2">
            {status.incidents.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-xs text-slate-500">
                Nothing open. No action required.
              </p>
            ) : (
              [...status.incidents]
                .sort((a, b) => Number(a.status === "open") - Number(b.status === "open"))
                .slice(0, 10)
                .map((incident) => (
                <div
                  key={incident.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-black/20 p-3.5"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-slate-200">
                        {incident.title}
                      </p>
                      <ScopeBadge scope={incident.scope} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {incident.severity} / {incident.scope} / opened {timeAgo(incident.startedAt)}
                    </p>
                    {incident.resolutionMethod && (
                      <p className="mt-1 text-[10px] font-medium text-emerald-300">
                        {incident.resolutionMethod === "rollback"
                          ? "Resolved via One-Click Rollback"
                          : `Resolved via ${incident.resolutionMethod}`}
                      </p>
                    )}
                  </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                    {incident.status === "open" && (
                      <>
                    <button
                      type="button"
                      onClick={() => onRollback(incident.id)}
                      disabled={!adminKey || busyId === incident.id}
                      className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {busyId === incident.id
                        ? "Rolling Back & Verifying..."
                        : "Trigger Rollback / Heal"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onResolve(incident.id)}
                      disabled={!adminKey || busyId === incident.id}
                      className="text-[10px] text-slate-500 hover:text-slate-300 disabled:opacity-35"
                    >
                      Resolve manually
                    </button>
                    </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
          <h2 className="text-sm font-semibold text-slate-100">Admin key</h2>
          <p className="mt-1 text-[11px] text-slate-500">
            Required for manual resolution. Sent as the{" "}
            <code className="text-slate-400">x-admin-key</code> header.
          </p>
          <input
            type="password"
            value={adminKey}
            onChange={(event) => setAdminKey(event.target.value)}
            placeholder="Enter ADMIN_KEY"
            autoComplete="off"
            className="mt-4 w-full rounded-xl border border-white/[0.08] bg-black/30 px-3.5 py-2.5 font-mono text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-emerald-400/30"
          />
          <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
            <span
              className={`size-1.5 rounded-full ${
                adminKey ? "bg-emerald-400" : "bg-slate-600"
              }`}
            />
            {adminKey ? "Key loaded for this session" : "Console locked"}
          </div>
          {error ? (
            <p className="mt-3 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">
              {error}
            </p>
          ) : null}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <WebhookReceiver />
        <AuditTrail entries={status.audit} valid={status.auditValid} />
      </div>
    </div>
  );
}
