import type { Express } from "express";

export function applySecurityHeaders(app: Express): void {
  app.use((_, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
}
