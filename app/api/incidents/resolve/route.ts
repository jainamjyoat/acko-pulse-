import { rollbackIncident } from "@/src/features/sre/resolve";

export async function POST(request: Request) {
  return rollbackIncident(request);
}
