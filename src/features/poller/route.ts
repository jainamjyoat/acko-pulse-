import { poll } from "./poller";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  return Response.json(await poll(false), { headers: NO_STORE });
}

export async function POST() {
  return Response.json(await poll(true), { headers: NO_STORE });
}
