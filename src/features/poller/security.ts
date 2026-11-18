import type { SecurityGrade } from "../shared/types";

/** Scores the response against five baseline browser-hardening headers. */
export function gradeSecurity(headers: Headers): SecurityGrade {
  const csp = headers.get("content-security-policy") ?? "";
  const checks: boolean[] = [
    Boolean(headers.get("strict-transport-security")),
    csp.length > 0,
    headers.get("x-content-type-options")?.toLowerCase() === "nosniff",
    Boolean(headers.get("x-frame-options")) || csp.includes("frame-ancestors"),
    Boolean(headers.get("referrer-policy")),
  ];
  const score = checks.filter(Boolean).length;

  return score >= 5 ? "A" : score === 4 ? "B" : score === 3 ? "C" : score === 2 ? "D" : "F";
}
