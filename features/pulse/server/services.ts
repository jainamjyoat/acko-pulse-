import type { ServiceConfig } from "../types";

export const SERVICES: ServiceConfig[] = [
  {
    id: "auth",
    name: "Identity & Auth",
    url: process.env.SERVICE_AUTH_URL ?? "https://httpbin.org/status/200",
    description: "Login, tokens, session validation",
  },
  {
    id: "payments",
    name: "Payments API",
    url: process.env.SERVICE_PAYMENTS_URL ?? "https://api.github.com/zen",
    description: "Checkout, billing, settlement",
  },
  {
    id: "notifications",
    name: "Notifications",
    url:
      process.env.SERVICE_NOTIFICATIONS_URL ??
      "https://jsonplaceholder.typicode.com/todos/1",
    description: "Email, push, transactional messaging",
  },
  {
    id: "search",
    name: "Search & Index",
    url:
      process.env.SERVICE_SEARCH_URL ?? "https://postman-echo.com/status/200",
    description: "Catalog search and index freshness",
  },
];

export const serviceById = (id: string) => SERVICES.find((s) => s.id === id);
