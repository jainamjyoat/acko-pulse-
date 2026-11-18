"use client";

import type { AuditEntry } from "../shared/types";
import { timeAgo } from "../shared/ui";

export default function AuditTrail({
  entries,
  valid,
}: {
  entries: AuditEntry[];
  valid: boolean;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Immutable Audit Trail
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            SHA-256 hash-chained manual and automated recovery actions.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${
            valid
              ? "bg-emerald-400/10 text-emerald-300"
              : "bg-red-400/10 text-red-300"
          }`}
        >
          {valid ? "CHAIN VERIFIED" : "CHAIN INVALID"}
        </span>
      </div>
      <div className="mt-4 max-h-72 space-y-2 overflow-auto">
        {!entries.length ? (
          <p className="text-xs text-slate-500">No actions recorded.</p>
        ) : (
          [...entries].reverse().map((entry) => (
            <article
              key={`${entry.id}-${entry.hash}`}
              className="rounded-xl border border-white/[0.06] bg-black/20 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-200">
                  {entry.action}
                </p>
                <span className="text-[10px] text-slate-500">
                  {entry.actor} · {timeAgo(entry.at)}
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-[9px] text-slate-600">
                prev {entry.previousHash.slice(0, 16)}… · hash {entry.hash.slice(0, 24)}…
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
