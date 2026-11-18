import { getStatus } from "@/features/pulse/server/status";

export async function GET() {
  return Response.json(await getStatus(), {
    headers: { "cache-control": "no-store" },
  });
}
