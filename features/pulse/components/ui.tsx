import type { SecurityGrade, ServiceState } from "../types";

export const stateStyles: Record<ServiceState, string> = {
  OPERATIONAL:
    "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  DEGRADED: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  OUTAGE: "border-red-400/30 bg-red-400/10 text-red-300",
};

export const stateDot: Record<ServiceState, string> = {
  OPERATIONAL: "bg-emerald-400",
  DEGRADED: "bg-amber-400",
  OUTAGE: "bg-red-400",
};

export function StateBadge({ state }: { state: ServiceState }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] ${stateStyles[state]}`}
    >
      <span
        className={`size-1.5 rounded-full ${stateDot[state]} ${
          state === "OPERATIONAL" ? "" : "animate-pulse"
        }`}
      />
      {state}
    </span>
  );
}

export function GradeBadge({ grade }: { grade: SecurityGrade }) {
  const tone =
    grade === "A" || grade === "B"
      ? "text-emerald-300 border-emerald-400/20 bg-emerald-400/5"
      : grade === "C"
        ? "text-amber-300 border-amber-400/20 bg-amber-400/5"
        : "text-red-300 border-red-400/20 bg-red-400/5";

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${tone}`}
    >
      {grade}
    </span>
  );
}

export function timeAgo(value: string | null): string {
  if (!value) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const pct = (value: number, digits = 2) =>
  `${value.toFixed(digits)}%`;

export const ms = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
