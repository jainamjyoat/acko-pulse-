import type { StatusPayload } from "../types";
import { GradeBadge, ms, pct, StateBadge, timeAgo } from "./ui";

function UptimeBar({ history }: { history: { ok: boolean }[] }) {
  const bars: { ok: boolean; faded?: boolean }[] = history.slice(-30);
  while (bars.length < 30) bars.unshift({ ok: true, faded: true });

  return (
    <div className="flex h-7 items-end gap-[3px]" aria-label="Last 30 checks">
      {bars.map((bar, index) => (
        <span
          key={index}
          className={`min-w-0 flex-1 rounded-sm ${
            bar.faded
              ? "h-2 bg-white/[0.06]"
              : bar.ok
                ? "h-full bg-emerald-400/70"
                : "h-full bg-red-400/80"
          }`}
        />
      ))}
    </div>
  );
}

function ServiceCard({
  service,
}: {
  service: StatusPayload["services"][number];
}) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 transition-colors hover:border-white/[0.14]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            {service.name}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{service.description}</p>
        </div>
        <StateBadge state={service.state} />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-600">
            Latency
          </p>
          <p className="mt-1 font-mono text-sm text-slate-200">
            {ms(service.latency)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-600">
            Security
          </p>
          <div className="mt-1">
            <GradeBadge grade={service.grade} />
          </div>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-600">
            Checked
          </p>
          <p className="mt-1 font-mono text-sm text-slate-400">
            {timeAgo(service.lastChecked)}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <UptimeBar history={service.history} />
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">
            {service.checks} checks sampled
          </span>
          <span className="font-mono text-slate-300">
            {pct(service.uptime)} uptime
          </span>
        </div>
      </div>
    </article>
  );
}

function IncidentFeed({ incidents }: { incidents: StatusPayload["incidents"] }) {
  return (
    <aside className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Incident feed</h2>
        <span className="rounded-full border border-white/[0.08] px-2 py-0.5 font-mono text-[10px] text-slate-500">
          {incidents.filter((incident) => incident.status === "open").length} open
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {incidents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-xs text-slate-500">
            No incidents recorded. All checks nominal.
          </p>
        ) : (
          incidents.slice(0, 9).map((incident) => (
            <div
              key={incident.id}
              className={`rounded-xl border p-3.5 ${
                incident.status === "open"
                  ? incident.severity === "critical"
                    ? "border-red-400/20 bg-red-400/[0.04]"
                    : "border-amber-400/20 bg-amber-400/[0.04]"
                  : "border-white/[0.06] bg-white/[0.015]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-200">
                    {incident.title}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {incident.serviceName} · {timeAgo(incident.startedAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                    incident.status === "resolved"
                      ? "bg-white/[0.05] text-slate-500"
                      : incident.severity === "critical"
                        ? "bg-red-400/10 text-red-300"
                        : "bg-amber-400/10 text-amber-300"
                  }`}
                >
                  {incident.status === "resolved"
                    ? "resolved"
                    : incident.severity}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export default function PublicStatus({ status }: { status: StatusPayload }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
      <div className="grid gap-4 sm:grid-cols-2">
        {status.services.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>
      <IncidentFeed incidents={status.incidents} />
    </div>
  );
}
