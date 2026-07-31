export interface ThinClientApiError {
  status: number;
  endpoint: string;
  code?: string;
  message: string;
  details?: unknown;
}

interface ApiEnvelope { ok: boolean; value?: unknown; error?: { code?: string; message?: string; details?: unknown; endpoint?: string } }

export function parseApiEnvelope(raw: unknown): ApiEnvelope {
  if (typeof raw === "object" && raw !== null && typeof (raw as any).ok === "boolean") return raw as ApiEnvelope;
  throw new Error("Invalid API envelope.");
}

export function toThinClientApiError(status: number, endpoint: string, envelope?: ApiEnvelope): ThinClientApiError {
  return {
    status,
    endpoint: envelope?.error?.endpoint ?? endpoint,
    code: envelope?.error?.code,
    message: envelope?.error?.message ?? `Request failed (HTTP ${status}).`,
    details: envelope?.error?.details,
  };
}
