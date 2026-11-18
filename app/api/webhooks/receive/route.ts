import { receiveWebhook } from "@/src/features/webhooks/verify";

export async function POST(request: Request) {
  return receiveWebhook(request);
}
