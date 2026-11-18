import { createHmac } from "node:crypto";
import type { StateChange } from "../shared/types";

/** POSTs only state transitions, signed with HMAC-SHA256. */
export async function sendStateWebhook(change: StateChange): Promise<void> {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url || !secret) return;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({ event: "service.state_changed", ...change });
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Pulse-Signature": `sha256=${signature}`,
        "X-Pulse-Timestamp": timestamp,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // A failed webhook must not change the monitor's state.
  }
}

export async function sendIncidentWebhook(payload: Record<string, unknown>) {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url || !secret) return;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Pulse-Signature": `sha256=${signature}`,
        "X-Pulse-Timestamp": timestamp,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Delivery failure does not affect the state machine.
  }
}
