"use client";

import { useEffect, useState } from "react";
import type { WebhookEvent } from "../shared/types";
import { timeAgo } from "../shared/ui";

export default function WebhookReceiver() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/webhooks/events", { cache: "no-store" });
        if (!response.ok) throw new Error("Webhook feed unavailable");
        const data = (await response.json()) as WebhookEvent[];
        if (active) {
          setEvents(data);
          setError("");
        }
      } catch {
        if (active) setError("Unable to load webhook events");
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
      <h2 className="text-sm font-semibold text-slate-100">Webhook Receiver</h2>
      <p className="mt-1 text-xs text-slate-500">
        POST signed events to <code>/api/webhooks/receive</code>.
      </p>
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      <div className="mt-4 space-y-2">
        {!events.length ? (
          <p className="text-xs text-slate-500">Waiting for signed events.</p>
        ) : (
          events.map((event, index) => (
            <article
              key={`${event.at}-${index}`}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-slate-300">
                  {JSON.stringify(event.body)}
                </p>
                <p className="mt-1 text-[10px] text-slate-600">
                  {timeAgo(event.at)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${
                  event.verified
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-red-400/10 text-red-300"
                }`}
              >
                {event.verified ? "VERIFIED" : "INVALID SIGNATURE"}
              </span>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
