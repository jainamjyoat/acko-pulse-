import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8080);
const name = process.env.SERVICE_NAME ?? "Pulse service";
const latency = Math.max(0, Number(process.env.LATENCY_MS ?? 35));
let failing = process.env.START_FAILING === "true";

function send(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/health") {
    setTimeout(() => {
      if (failing) return send(response, 503, { service: name, status: "failing" });
      return send(response, 200, { service: name, status: "ok", latencyMs: latency });
    }, latency);
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

  if (request.method === "GET" && url.pathname === "/") {
    return send(response, 200, {
      service: name,
      endpoints: ["GET /health", "POST /control/fail", "POST /control/reset"],
    });
  }

  return send(response, 404, { error: "Not found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${name} listening on ${port}`);
});
