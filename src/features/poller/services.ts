import type { ServiceConfig } from "../shared/types";

export const SERVICES: ServiceConfig[] = [
  {
    id: "quotes",
    name: "Quotes",
    url: process.env.SERVICE_QUOTES_URL ?? "https://httpbin.org/status/200",
    description: "Quote generation and pricing",
  },
  {
    id: "payments",
    name: "Payments",
    url: process.env.SERVICE_PAYMENTS_URL ?? "https://api.github.com/zen",
    description: "Checkout, billing, settlement",
  },
  {
    id: "claims",
    name: "Claims",
    url:
      process.env.SERVICE_CLAIMS_URL ??
      "https://jsonplaceholder.typicode.com/todos/1",
    description: "Claims processing and adjudication",
  },
  {
    id: "notifications",
    name: "Notifications",
    url:
      process.env.SERVICE_NOTIFICATIONS_URL ?? "https://postman-echo.com/status/200",
    description: "Email, push, transactional messaging",
  },
];

export const serviceById = (id: string) => SERVICES.find((s) => s.id === id);

export function resetUrl(service: ServiceConfig): string {
  return new URL("/control/reset", service.url).toString();
}
