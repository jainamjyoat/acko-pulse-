import { getWebhookEvents } from "@/src/features/webhooks/verify";

export async function GET(_request: Request) {
  void _request.url;
  return Response.json(await getWebhookEvents(), {
    headers: { "cache-control": "no-store" },
  });
}
