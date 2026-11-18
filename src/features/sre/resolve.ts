import { getStatus } from "../status/getStatus";
import { getStore, resetService } from "../poller/store";
import { supabaseAdmin } from "../shared/supabase-server";
import { sendStateWebhook } from "../poller/webhook";
import type { Incident, StateChange } from "../shared/types";

type ResolveBody = { id?: unknown };

export async function resolveIncident(request: Request) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return Response.json(
      { error: "ADMIN_KEY is not configured" },
      { status: 503 },
    );
  }
  if (request.headers.get("x-admin-key") !== adminKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ResolveBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const store = getStore();
  const supabase = supabaseAdmin();
  let incident: Incident | undefined = store.incidents.find(
    (row) => row.id === body.id,
  );

  if (!incident && supabase) {
    const { data } = await supabase
      .from("incidents")
      .select(
        "id, service_id, severity, scope, status, title, started_at, resolved_at",
      )
      .eq("id", body.id)
      .maybeSingle();

    if (data) {
      const runtime = store.runtimes.get(data.service_id);
      incident = {
        id: data.id,
        serviceId: data.service_id,
        serviceName: runtime?.config.name ?? data.service_id,
        severity: data.severity,
        scope:
          data.scope ?? (data.severity === "warning" ? "INTERNAL" : "PUBLIC"),
        status: data.status,
        title: data.title,
        startedAt: data.started_at,
        resolvedAt: data.resolved_at,
      };
    }
  }

  if (!incident) {
    return Response.json({ error: "Incident not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const runtime = store.runtimes.get(incident.serviceId);
  let change: StateChange | null = null;

  if (runtime && runtime.state !== "OPERATIONAL") {
    change = {
      serviceId: runtime.config.id,
      serviceName: runtime.config.name,
      from: runtime.state,
      to: "OPERATIONAL",
      scope: null,
      latency: runtime.latency,
      grade: runtime.grade,
      at: now,
    };
    resetService(incident.serviceId);
  }

  incident.status = "resolved";
  incident.resolvedAt = now;

  if (supabase) {
    await Promise.allSettled([
      supabase
        .from("incidents")
        .update({ status: "resolved", resolved_at: now })
        .eq("id", incident.id),
      supabase
        .from("services")
        .update({ state: "OPERATIONAL" })
        .eq("id", incident.serviceId),
    ]);
  }

  if (change) await sendStateWebhook(change);

  return Response.json(await getStatus());
}
