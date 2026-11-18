import { getStatus } from "@/src/features/status/getStatus";

export async function GET(request: Request) {
  void request.url;
  return Response.json(await getStatus(), {
    headers: { "cache-control": "no-store" },
  });
}
