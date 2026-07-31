import { createHmac } from "node:crypto";

export function hashToken(token: string, secret: string): string {
  if (!secret || !secret.trim()) {
    throw new Error("Token hash secret is required for lan-https-token mode.");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}
