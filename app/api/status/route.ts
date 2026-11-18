import { getStatus } from "@/src/features/status/getStatus";

export async function GET() {
  return Response.json(await getStatus(), {
    headers: { "cache-control": "no-store" },
  });
}
