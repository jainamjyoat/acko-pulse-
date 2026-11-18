import type { ServiceConfig } from "../shared/types";

export const SERVICES: ServiceConfig[] = [
  {
    id: "quotes",
    name: "Quotes",
    url: process.env.SERVICE_QUOTES_URL ?? "http://localhost:4101/health",
    description: "Quote generation and pricing",
  },
  {
    id: "payments",
    name: "Payments",
    url: process.env.SERVICE_PAYMENTS_URL ?? "http://localhost:4102/health",
    description: "Checkout, billing, settlement",
  },
  {
    id: "claims",
    name: "Claims",
    url:
      process.env.SERVICE_CLAIMS_URL ??
      "http://localhost:4103/health",
    description: "Claims processing and adjudication",
  },
  {
    id: "notifications",
    name: "Notifications",
    url:
      process.env.SERVICE_NOTIFICATIONS_URL ?? "http://localhost:4104/health",
    description: "Email, push, transactional messaging",
  },
];

export const serviceById = (id: string) => SERVICES.find((s) => s.id === id);

export function resetUrl(service: ServiceConfig): string {
  return new URL("/control/reset", service.url).toString();
}
