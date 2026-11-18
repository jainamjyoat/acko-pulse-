import { createHmac } from "node:crypto";
import type { StateChange } from "../shared/types";

/** POSTs only state transitions, signed with HMAC-SHA256. */
export async function sendStateWebhook(change: StateChange): Promise<void> {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url || !secret) return;

  const body = JSON.stringify({ event: "service.state_changed", ...change });
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pulse-signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // A failed webhook must not change the monitor's state.
  }
}
