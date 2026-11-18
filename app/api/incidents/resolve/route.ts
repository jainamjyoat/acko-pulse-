import { resolveIncident } from "@/src/features/sre/resolve";

export async function POST(request: Request) {
  return resolveIncident(request);
}
