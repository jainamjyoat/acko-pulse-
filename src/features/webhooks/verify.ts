import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "../poller/store";
import { supabaseAdmin } from "../shared/supabase-server";

export async function receiveWebhook(request: Request) {
  const raw = await request.text();
  const timestamp = request.headers.get("x-pulse-timestamp") ?? "";
  const signature = request.headers.get("x-pulse-signature") ?? "";
  const secret = process.env.WEBHOOK_SECRET ?? "";
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const actual = signature.replace(/^sha256=/, "");
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
  const verified = Boolean(
    secret &&
      fresh &&
      /^[a-f0-9]{64}$/i.test(actual) &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(actual)),
  );

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = { at: new Date().toISOString(), verified, body };
  getStore().receivedWebhooks.unshift(event);
  getStore().receivedWebhooks = getStore().receivedWebhooks.slice(0, 100);
  const supabase = supabaseAdmin();
  if (supabase) {
    await supabase.from("webhook_events").insert({
      verified,
      payload: { body, received_at: event.at },
    });
  }
  return Response.json({ verified }, { status: verified ? 200 : 401 });
}

export async function getWebhookEvents() {
  const supabase = supabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from("webhook_events")
      .select("id, received_at, verified, payload")
      .order("id", { ascending: false })
      .limit(100);
    if (!error && data) {
      return data.map((row) => ({
        at: row.received_at,
        verified: row.verified,
        body: row.payload.body,
      }));
    }
  }
  return getStore().receivedWebhooks;
}
