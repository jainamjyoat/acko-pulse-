import type { SecurityGrade } from "../shared/types";

/** A when both required headers pass, B otherwise. */
export function gradeSecurity(headers: Headers): SecurityGrade {
  return headers.get("x-content-type-options")?.toLowerCase() === "nosniff" &&
    Boolean(headers.get("x-frame-options"))
    ? "A"
    : "B";
}
