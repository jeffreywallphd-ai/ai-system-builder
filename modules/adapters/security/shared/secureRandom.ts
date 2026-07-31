import { randomBytes } from "node:crypto";

export function secureRandomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
