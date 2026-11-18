import { resolveIncident } from "@/features/pulse/server/resolve";

export async function POST(request: Request) {
  return resolveIncident(request);
}
