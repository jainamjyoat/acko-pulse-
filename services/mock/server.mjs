import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8080);
const name = process.env.SERVICE_NAME ?? "Pulse service";
const latency = Math.max(0, Number(process.env.LATENCY_MS ?? 35));
let failing = process.env.START_FAILING === "true";
let responseLatency = latency;
let insecureHeaders = false;

function send(response, status, payload) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (!insecureHeaders) {
    headers["x-content-type-options"] = "nosniff";
    headers["x-frame-options"] = "DENY";
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    setTimeout(() => {
      if (failing) return send(response, 503, { service: name, status: "failing" });
      return send(response, 200, { service: name, status: "ok", latencyMs: latency });
    }, responseLatency);
    return;
  }

  if (request.method === "POST" && url.pathname === "/control/reset") {
    failing = false;
    return send(response, 200, { service: name, status: "reset" });
  }

  if (request.method === "POST" && url.pathname === "/control/fail") {
    failing = true;
    return send(response, 200, { service: name, status: "failing" });
  }

  if (request.method === "POST" && url.pathname === "/control/latency") {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      let requested;
      try {
        requested = Number(JSON.parse(raw).latencyMs);
      } catch {
        return send(response, 400, { error: "Expected JSON { latencyMs }" });
      }
      if (!Number.isInteger(requested) || requested < 0 || requested > 4500) {
        return send(response, 400, { error: "latencyMs must be 0..4500" });
      }
      responseLatency = requested;
      send(response, 200, { service: name, latencyMs: responseLatency });
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/control/security-headers") {
    insecureHeaders = url.searchParams.get("mode") === "missing";
    return send(response, 200, {
      service: name,
      securityHeaders: insecureHeaders ? "missing" : "present",
    });
  }

  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, {
      service: name,
      endpoints: [
        "GET /health",
        "POST /control/fail",
        "POST /control/reset",
        "POST /control/latency { latencyMs: 0..4500 }",
        "POST /control/security-headers?mode=missing|normal",
      ],
    });
  }

  return send(response, 404, { error: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${name} listening on ${port}`);
});
