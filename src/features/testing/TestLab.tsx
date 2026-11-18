"use client";

import { useEffect, useState } from "react";
import type { StatusPayload } from "../shared/types";
import { StateBadge } from "../shared/ui";

type Scenario = "failure" | "latency" | "security" | "rollback" | "restore";
type StepResult = { label: string; detail: string; ok: boolean; at: string };
type ConfigCheck = "checking" | "configured" | "missing" | "error";

const SCENARIOS: {
  id: Scenario;
  title: string;
  description: string;
  expected: string;
}[] = [
  {
    id: "failure",
    title: "Health check failure",
    description: "Force a local service to return HTTP 503.",
    expected: "1–2 failed checks => DEGRADED / INTERNAL; 3 => OUTAGE / PUBLIC.",
  },
  {
    id: "latency",
    title: "Latency degradation",
    description: "Set service response delay to 1200ms (local mock only).",
    expected: "After the 3-check window, average latency > 1000ms => DEGRADED.",
  },
  {
    id: "security",
    title: "Security-header regression",
    description: "Remove the two monitored security headers from mock responses.",
    expected: "Security posture badge changes from A to B; service health remains 200.",
  },
  {
    id: "rollback",
    title: "Rollback and recovery verification",
    description: "Reset the mock service and observe recovery through three healthy probes.",
    expected: "Incident remains open until 3/3 successful checks confirm recovery.",
  },
  {
    id: "restore",
    title: "Restore test settings",
    description: "Clear failure, latency, and header test conditions.",
    expected: "The selected mock returns to normal health, latency, and headers.",
  },
];

export default function TestLab({
  status,
  adminKey,
  onRefresh,
}: {
  status: StatusPayload;
  adminKey: string;
  onRefresh: () => Promise<void>;
}) {
  const [serviceId, setServiceId] = useState("payments");
  const [running, setRunning] = useState<Scenario | null>(null);
  const [results, setResults] = useState<StepResult[]>([]);
  const [error, setError] = useState("");
  const [configCheck, setConfigCheck] = useState<ConfigCheck>("checking");

  const checkServerConfig = async () => {
    setConfigCheck("checking");
    try {
      const response = await fetch("/api/test-lab", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to check server configuration");
      const config = await response.json() as { adminKeyConfigured: boolean };
      setConfigCheck(config.adminKeyConfigured ? "configured" : "missing");
    } catch {
      setConfigCheck("error");
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/test-lab", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to check server configuration");
        const config = await response.json() as { adminKeyConfigured: boolean };
        if (active) setConfigCheck(config.adminKeyConfigured ? "configured" : "missing");
      } catch {
        if (active) setConfigCheck("error");
      }
    })();
    return () => { active = false; };
  }, []);

  const addResult = (label: string, detail: string, ok: boolean) => {
    setResults((rows) => [
      { label, detail, ok, at: new Date().toLocaleTimeString() },
      ...rows,
    ].slice(0, 30));
  };

  const run = async (scenario: Scenario) => {
    setError("");
    setRunning(scenario);
    const action = scenario === "failure" ? "fail" :
      scenario === "latency" ? "latency" :
      scenario === "security" ? "security" :
      scenario === "restore" ? "restore" : "reset";
    const payload = scenario === "latency"
      ? { latencyMs: 1200 }
      : scenario === "security"
        ? { mode: "missing" }
        : scenario === "restore"
          ? { latencyMs: 35, mode: "normal" }
          : {};

    try {
      let response: Response;
      if (scenario === "rollback") {
        const incident = status.incidents.find(
          (row) => row.serviceId === serviceId && row.status === "open",
        );
        if (!incident) throw new Error("No open incident for this service. Run the failure scenario and wait for OUTAGE first.");
        response = await fetch("/api/incidents/resolve", {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-key": adminKey },
          body: JSON.stringify({ id: incident.id }),
        });
      } else {
        response = await fetch("/api/test-lab", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ serviceId, action, ...payload }),
        });
      }
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? `Test action failed (${response.status})`);
      addResult(SCENARIOS.find((item) => item.id === scenario)!.title,
        data.message ?? "Control action accepted; waiting for poll results.", true);

      await observeOutcome(scenario);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unknown test error";
      setError(message);
      addResult("Scenario failed", message, false);
    } finally {
      setRunning(null);
    }
  };

  const observeOutcome = async (scenario: Scenario) => {
    const maxAttempts = scenario === "rollback" ? 36 : 7;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const poll = await fetch("/api/poll", { cache: "no-store" });
      if (poll.ok) {
        const snapshot = await poll.json() as StatusPayload;
        const service = snapshot.services.find((row) => row.id === serviceId);
        const recent = service?.history.slice(-3) ?? [];
        const incident = snapshot.incidents.find(
          (row) => row.serviceId === serviceId && row.status === "open",
        );
        await onRefresh();

        const complete = scenario === "failure"
          ? service?.state === "OUTAGE" && incident?.scope === "PUBLIC"
          : scenario === "latency"
            ? service?.state === "DEGRADED" && incident?.scope === "INTERNAL"
            : scenario === "security"
              ? service?.grade === "B"
              : scenario === "restore"
                ? service?.state === "OPERATIONAL" && service.grade === "A" && service.latency < 1000
                : incident?.status === "resolved" && recent.length === 3 && recent.every((check) => check.ok) && service?.state === "OPERATIONAL";

        if (complete) {
          addResult("Expected outcome observed", describeOutcome(scenario, service?.state, service?.grade), true);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    addResult("Outcome not observed yet", "Check the live SRE state and scenario prerequisites. Failure/latency scenarios may need 3 poll cycles; rollback requires three successful probes.", false);
  };

  const describeOutcome = (scenario: Scenario, state?: string, grade?: string) => {
    if (scenario === "failure") return `Observed ${state}; PUBLIC outage incident opened.`;
    if (scenario === "latency") return `Observed ${state}; INTERNAL degradation incident opened.`;
    if (scenario === "security") return `Observed security grade ${grade}.`;
    if (scenario === "restore") return `Service restored to ${state}; grade ${grade}.`;
    return "Three healthy checks confirmed and incident resolved.";
  };

  const selected = status.services.find((service) => service.id === serviceId);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
        <h2 className="text-sm font-semibold text-amber-200">Local Test Lab</h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Safe fault-injection scenarios control only the included local mock services.
          They do not generate attack traffic or test external targets. Enter the configured
          ADMIN_KEY in the SRE tab before running a scenario.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500" htmlFor="test-service">
            Target service
          </label>
          <select
            id="test-service"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            className="mt-2 w-full rounded-lg border border-white/[0.1] bg-slate-950 px-3 py-2 text-sm text-slate-200"
          >
            {status.services.map((service) => (
              <option key={service.id} value={service.id}>{service.name}</option>
            ))}
          </select>
          <div className="mt-5 space-y-3 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>Current state</span>
              {selected && <StateBadge state={selected.state} />}
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Latest latency</span><span className="font-mono">{selected?.latency ?? 0}ms</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Security grade</span><span className="font-mono">{selected?.grade ?? "—"}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Window</span><span className="font-mono">{selected?.history.slice(-3).filter((check) => check.ok).length ?? 0}/3 healthy</span>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-white/[0.06] p-3 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <p className={configCheck === "configured" ? "text-emerald-300" : "text-amber-300"}>
                Server ADMIN_KEY: {configCheck === "checking" ? "checking…" : configCheck === "configured" ? "detected" : configCheck === "missing" ? "missing in Next.js process" : "configuration check failed"}
              </p>
              <button type="button" onClick={() => void checkServerConfig()} className="text-slate-400 underline hover:text-slate-200">Recheck</button>
            </div>
            {!adminKey && <p className="mt-1 text-slate-400">Enter the same key in the SRE Console. The browser does not receive the server secret.</p>}
            {configCheck === "missing" && <p className="mt-1 text-slate-500">Create project-root `.env.local` beside `package.json` with `ADMIN_KEY=your-secret`. `.env.example` is a template and is not loaded. Restart Next.js after editing.</p>}
            {configCheck === "configured" && adminKey && <p className="mt-1 text-slate-500">Server has a key; the value is never returned to the browser.</p>}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {SCENARIOS.map((scenario) => (
            <article key={scenario.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
              <h3 className="text-sm font-semibold text-slate-200">{scenario.title}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">{scenario.description}</p>
              <p className="mt-2 text-[11px] leading-5 text-slate-400"><b className="text-emerald-300">Expected:</b> {scenario.expected}</p>
              <button
                type="button"
                disabled={!adminKey || running !== null}
                onClick={() => void run(scenario.id)}
                className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {running === scenario.id ? "Running scenario…" : "Run scenario"}
              </button>
            </article>
          ))}
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-300">{error}</p>}

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Scenario results</h2>
            <p className="mt-1 text-xs text-slate-500">Observed actions and live service state. Refresh continues every 5 seconds.</p>
          </div>
          <button type="button" onClick={() => setResults([])} className="text-xs text-slate-500 hover:text-slate-300">Clear</button>
        </div>
        <div className="mt-4 space-y-2">
          {results.length === 0 ? <p className="text-xs text-slate-500">Run a scenario to begin.</p> : results.map((result, index) => (
            <div key={`${result.at}-${index}`} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/20 p-3">
              <div><p className={`text-xs font-medium ${result.ok ? "text-slate-200" : "text-red-300"}`}>{result.label}</p><p className="mt-1 text-[11px] text-slate-500">{result.detail}</p></div>
              <time className="font-mono text-[10px] text-slate-600">{result.at}</time>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
