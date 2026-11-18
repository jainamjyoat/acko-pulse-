import type { ServiceState, StatusPayload } from "../shared/types";
import { GradeBadge, ms, pct, StateBadge, timeAgo } from "../shared/ui";

const HISTORY_BLOCKS = 20;

function customerState(state: ServiceState): ServiceState {
  return state === "OUTAGE" ? "OUTAGE" : "OPERATIONAL";
}

function UptimeBar({ history }: { history: boolean[] }) {
  const bars: { outage: boolean; faded?: boolean }[] = history
    .slice(-HISTORY_BLOCKS)
    .map((outage) => ({ outage }));
  while (bars.length < HISTORY_BLOCKS) bars.unshift({ outage: false, faded: true });

  return (
    <div className="flex h-7 items-end gap-[3px]" aria-label="Last 20 checks">
      {bars.map((bar, index) => (
        <span
          key={index}
          className={`min-w-0 flex-1 rounded-sm ${
            bar.faded
              ? "h-2 bg-white/[0.06]"
              : bar.outage
                ? "h-full bg-red-400/80"
                : "h-full bg-emerald-400/70"
          }`}
        />
      ))}
    </div>
  );
}

function PublicBanner({ services }: { services: StatusPayload["services"] }) {
  if (!services.length) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-5 py-4 text-sm text-slate-400">
        Connecting to the status feed...
      </div>
    );
  }

  const outage = services.some((service) => service.state === "OUTAGE");
  if (outage) {
    return (
      <div className="rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-5 py-4">
        <p className="text-sm font-medium text-red-200">
          We are investigating a service disruption.
        </p>
        <p className="mt-1 text-xs text-red-300/70">
          Updates will be posted as the incident is resolved.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] px-5 py-4">
      <p className="text-sm font-medium text-emerald-200">
        All systems operational.
      </p>
      <p className="mt-1 text-xs text-emerald-300/60">
        No customer-facing incidents.
      </p>
    </div>
  );
}

function ServiceCard({
  service,
}: {
  service: StatusPayload["services"][number];
}) {
  const publicState = customerState(service.state);

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 transition-colors hover:border-white/[0.14]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            {service.name}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{service.description}</p>
        </div>
        <StateBadge state={publicState} />
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
        <UptimeBar history={service.outageHistory} />
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">
            Last {HISTORY_BLOCKS} checks
          </span>
          <span className="font-mono text-slate-300">
            {pct(service.uptime)} uptime
          </span>
        </div>
      </div>
    </article>
  );
}

function IncidentFeed({
  incidents,
}: {
  incidents: StatusPayload["incidents"];
}) {
  const publicIncidents = incidents.filter(
    (incident) => incident.scope === "PUBLIC",
  );
  const open = publicIncidents.filter((incident) => incident.status === "open");

  return (
    <aside className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Incident feed</h2>
        <span className="rounded-full border border-white/[0.08] px-2 py-0.5 font-mono text-[10px] text-slate-500">
          {open.length} open
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {publicIncidents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-xs text-slate-500">
            No customer-facing incidents.
          </p>
        ) : (
          publicIncidents.slice(0, 9).map((incident) => (
            <div
              key={incident.id}
              className={`rounded-xl border p-3.5 ${
                incident.status === "open"
                  ? "border-red-400/20 bg-red-400/[0.04]"
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
                      : "bg-red-400/10 text-red-300"
                  }`}
                >
                  {incident.status}
                </span>
                {incident.status === "resolved" && incident.resolutionMethod === "rollback" && (
                  <p className="mt-2 text-[10px] font-medium text-emerald-300">
                    Resolved via One-Click Rollback
                  </p>
                )}
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
    <div className="space-y-4">
      <PublicBanner services={status.services} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
        <div className="grid gap-4 sm:grid-cols-2">
          {status.services.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>
        <IncidentFeed incidents={status.incidents} />
      </div>
    </div>
  );
}
