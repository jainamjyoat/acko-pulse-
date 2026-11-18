import { serviceById } from "@/src/features/poller/services";

type TestAction = "fail" | "reset" | "latency" | "security" | "restore";

export async function POST(request: Request) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return Response.json({ error: "Configure ADMIN_KEY to enable the test lab" }, { status: 503 });
  }
  if (request.headers.get("x-admin-key") !== adminKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { serviceId?: unknown; action?: unknown; latencyMs?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.serviceId !== "string" || typeof body.action !== "string") {
    return Response.json({ error: "serviceId and action are required" }, { status: 400 });
  }
  const service = serviceById(body.serviceId);
  if (!service) return Response.json({ error: "Unknown service" }, { status: 404 });

  const action = body.action as TestAction;
  let target: URL;
  try {
    target = new URL(service.url);
  } catch {
    return Response.json({ error: "Service URL is invalid" }, { status: 400 });
  }
  const expectedPort = { quotes: "4101", payments: "4102", claims: "4103", notifications: "4104" }[service.id];
  const localTarget = ["localhost", "127.0.0.1", "::1"].includes(target.hostname) && target.port === expectedPort;
  if (!localTarget) {
    return Response.json({ error: "Test controls are restricted to the included localhost Docker mock services" }, { status: 403 });
  }

  let endpoint: string;
  let payload: Record<string, unknown> | undefined;
  switch (action) {
    case "fail": endpoint = "/control/fail"; break;
    case "reset": endpoint = "/control/reset"; break;
    case "latency":
      if (!Number.isInteger(body.latencyMs) || Number(body.latencyMs) < 0 || Number(body.latencyMs) > 4500) {
        return Response.json({ error: "latencyMs must be an integer from 0 to 4500" }, { status: 400 });
      }
      endpoint = "/control/latency";
      payload = { latencyMs: body.latencyMs };
      break;
    case "security":
      if (body.mode !== "missing" && body.mode !== "normal") {
        return Response.json({ error: "mode must be missing or normal" }, { status: 400 });
      }
      endpoint = `/control/security-headers?mode=${body.mode}`;
      break;
    case "restore": {
      const base = service.url;
      const operations = [
        { path: "/control/reset" },
        { path: "/control/latency", body: { latencyMs: 35 } },
        { path: "/control/security-headers?mode=normal" },
      ];
      try {
        for (const operation of operations) {
          const response = await fetch(new URL(operation.path, base), {
            method: "POST",
            headers: operation.body ? { "content-type": "application/json" } : undefined,
            body: operation.body ? JSON.stringify(operation.body) : undefined,
            signal: AbortSignal.timeout(5000),
            cache: "no-store",
          });
          if (!response.ok) throw new Error(`Mock service returned HTTP ${response.status}`);
        }
        return Response.json({ ok: true, message: `${service.name}: failure cleared, latency set to 35ms, security headers restored` });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Restore failed" }, { status: 502 });
      }
    }
    default:
      return Response.json({ error: "Unsupported test action" }, { status: 400 });
  }

  try {
    const response = await fetch(new URL(endpoint, service.url), {
      method: "POST",
      headers: payload ? { "content-type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return Response.json({ error: `Mock service returned HTTP ${response.status}` }, { status: 502 });
    }
    return Response.json({ ok: true, message: `${service.name}: ${JSON.stringify(result)}` });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Local service control failed" }, { status: 502 });
  }
}
