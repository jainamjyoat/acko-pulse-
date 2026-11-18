import { createHash } from "node:crypto";
import { getStore } from "../poller/store";
import { supabaseAdmin } from "../shared/supabase-server";
import type { AuditEntry } from "../shared/types";

const GENESIS = "0".repeat(64);

function digest(entry: Omit<AuditEntry, "hash" | "id">): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

export async function appendAudit(
  actor: string,
  action: string,
  serviceId: string,
  incidentId: string,
): Promise<AuditEntry> {
  const store = getStore();
  let previousHash = store.audit.at(-1)?.hash;
  const supabase = supabaseAdmin();
  if (!previousHash && supabase) {
    const { data } = await supabase
      .from("audit_logs")
      .select("hash")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    previousHash = data?.hash;
  }
  previousHash ??= GENESIS;
  const data = {
    id: Date.now(),
    actor,
    action,
    serviceId,
    incidentId,
    at: new Date().toISOString(),
    previousHash,
  };
  const hashable = {
    actor: data.actor,
    action: data.action,
    serviceId: data.serviceId,
    incidentId: data.incidentId,
    at: data.at,
    previousHash: data.previousHash,
  };
  const entry: AuditEntry = { ...data, hash: digest(hashable) };
  store.audit.push(entry);

  if (supabase) {
    const { error } = await supabase.from("audit_logs").insert({
      actor: entry.actor,
      action: entry.action,
      service_id: entry.serviceId,
      incident_id: entry.incidentId,
      created_at: entry.at,
      previous_hash: entry.previousHash,
      hash: entry.hash,
    });
    if (error) throw new Error(`Audit persistence failed: ${error.message}`);
  }
  return entry;
}

export async function getAuditTrail(): Promise<AuditEntry[]> {
  const supabase = supabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select(
        "id, actor, action, service_id, incident_id, created_at, previous_hash, hash",
      )
      .order("id", { ascending: true })
      .limit(500);
    if (!error && data) {
      return data.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        serviceId: row.service_id,
        incidentId: row.incident_id,
        at: row.created_at,
        previousHash: row.previous_hash,
        hash: row.hash,
      }));
    }
  }
  return [...getStore().audit];
}

export function verifyAuditTrail(entries: AuditEntry[]): boolean {
  let previousHash = GENESIS;
  for (const entry of entries) {
    const { hash } = entry;
    const data = {
      actor: entry.actor,
      action: entry.action,
      serviceId: entry.serviceId,
      incidentId: entry.incidentId,
      at: entry.at,
      previousHash: entry.previousHash,
    };
    if (entry.previousHash !== previousHash || digest(data) !== hash) return false;
    previousHash = hash;
  }
  return true;
}
