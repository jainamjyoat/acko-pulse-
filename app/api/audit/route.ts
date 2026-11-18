import { getAuditTrail, verifyAuditTrail } from "@/src/features/audit/hashChain";

export async function GET(_request: Request) {
  void _request.url;
  const entries = await getAuditTrail();
  return Response.json(
    { entries, valid: verifyAuditTrail(entries) },
    { headers: { "cache-control": "no-store" } },
  );
}
