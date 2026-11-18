import { appendAudit } from "../audit/hashChain";
import { serviceById, resetUrl } from "../poller/services";
import { getStore } from "../poller/store";
import { supabaseAdmin } from "../shared/supabase-server";
import { sendIncidentWebhook } from "../poller/webhook";
import { getStatus } from "../status/getStatus";
import type { Incident } from "../shared/types";

export async function rollbackIncident(request: Request) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return Response.json({ error: "ADMIN_KEY is not configured" }, { status: 503 });
  if (request.headers.get("x-admin-key") !== adminKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let id: unknown;
  try {
    id = (await request.json()).id;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof id !== "string") return Response.json({ error: "id is required" }, { status: 400 });

  const store = getStore();
  const incident = store.incidents.find((row) => row.id === id);
  if (!incident || incident.status !== "open") {
    return Response.json({ error: "Open incident not found" }, { status: 404 });
  }
  const service = serviceById(incident.serviceId);
  if (!service) return Response.json({ error: "Service not found" }, { status: 404 });
  if (store.pendingHealing.has(service.id)) {
    return Response.json({ error: "Rollback already in progress" }, { status: 409 });
  }

  store.pendingHealing.set(service.id, "rollback");
  try {
    const reset = await fetch(resetUrl(service), {
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
    if (!reset.ok) throw new Error(`Service reset failed (${reset.status})`);

    await appendAudit(
      request.headers.get("x-admin-actor")?.slice(0, 120) || "engineer",
      "incident.rollback.requested",
      service.id,
      incident.id,
    );
    return Response.json({ accepted: true, message: "Rolling Back & Verifying..." }, { status: 202 });
  } catch (error) {
    store.pendingHealing.delete(service.id);
    return Response.json(
      { error: error instanceof Error ? error.message : "Rollback failed" },
      { status: 502 },
    );
  }
}

export async function resolveIncident(request: Request) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return Response.json({ error: "ADMIN_KEY is not configured" }, { status: 503 });
  if (request.headers.get("x-admin-key") !== adminKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let id: unknown;
  try {
    id = (await request.json()).id;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof id !== "string") return Response.json({ error: "id is required" }, { status: 400 });

  const incident: Incident | undefined = getStore().incidents.find(
    (row) => row.id === id && row.status === "open",
  );
  if (!incident) return Response.json({ error: "Open incident not found" }, { status: 404 });

  const now = new Date().toISOString();
  incident.status = "resolved";
  incident.resolvedAt = now;
  incident.resolutionMethod = "manual";
  getStore().alertOpen.delete(incident.serviceId);

  const supabase = supabaseAdmin();
  if (supabase) {
    await supabase
      .from("incidents")
      .update({ status: "resolved", resolved_at: now, resolution_method: "manual" })
      .eq("id", incident.id);
  }
  await appendAudit(
    request.headers.get("x-admin-actor")?.slice(0, 120) || "engineer",
    "incident.resolve.manual",
    incident.serviceId,
    incident.id,
  );
  await sendIncidentWebhook({ event: "incident.recovered", incidentId: incident.id, method: "manual", at: now });
  return Response.json(await getStatus());
}
