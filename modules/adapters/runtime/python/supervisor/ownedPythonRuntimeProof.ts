import { timingSafeEqual } from "node:crypto";

export const OWNED_RUNTIME_READY_PREFIX = "AISB_OWNED_RUNTIME_READY_V1 ";
const LINE_BYTES = 128;
const CHUNK_BYTES = 16 * 1024;

/** Bounded private pipe protocol. It is never inferred from HTTP or stderr. */
export function createOwnedPythonRuntimeProof(nonce: string, endpoint: {host: string; port: string}) {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error("Python runtime ownership proof is unavailable.");
  if (endpoint.host !== "127.0.0.1" || !/^[1-9][0-9]{3,4}$/.test(endpoint.port)
    || Number(endpoint.port) < 1024 || Number(endpoint.port) > 65535) throw new Error("Python runtime ownership endpoint is unavailable.");
  const expected = Buffer.from(OWNED_RUNTIME_READY_PREFIX + nonce + " " + endpoint.host + ":" + endpoint.port, "ascii");
  const line = Buffer.alloc(LINE_BYTES);
  let size = 0, discarding = false, observed = false;
  return {
    push(chunk: string | Buffer): boolean {
      if (observed) return true;
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (bytes.length > CHUNK_BYTES) { size = 0; discarding = true; return false; }
      for (const byte of bytes) {
        if (byte === 10) {
          if (!discarding) {
            const length = size && line[size - 1] === 13 ? size - 1 : size;
            if (length === expected.length && timingSafeEqual(line.subarray(0, length), expected)) observed = true;
          }
          size = 0; discarding = false;
          if (observed) break;
        } else if (!discarding) {
          if (size === LINE_BYTES) { size = 0; discarding = true; }
          else line[size++] = byte;
        }
      }
      return observed;
    },
  };
}
