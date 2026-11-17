import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import { isSystemBuilderSystemId, normalizeSystemBuilderRevisionId } from "../system-builder";

const authoringFailures = new Set([
  "headless.invalid-request", "headless.unsupported-version", "headless.host-changed", "headless.forbidden",
  "headless.unavailable", "headless.invalid-edit-batch", "headless.stale-revision", "headless.operation-unconfirmed",
  "headless.idempotency-conflict", "headless.idempotency-expired", "headless.operation-capacity",
] as const);
type FailureCode = typeof authoringFailures extends Set<infer Code> ? Code : never;
type Value = {
  readonly kind: "preview";
  readonly previewDigest: string;
  readonly validation: "valid" | "valid-with-warnings";
  readonly removedInstanceIds: readonly string[];
  readonly removedBindingIds: readonly string[];
} | {
  readonly kind: "committed" | "replayed";
  readonly reference: { readonly systemId: string; readonly recordRevision: number; readonly revisionId: string };
};
export type HeadlessAuthoringWireResult =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly code: FailureCode };
const unavailable = { ok: false, code: "headless.unavailable" } as const;

/** Rebuild the finite response at egress; internal error text and other fields are never returned. */
export function readHeadlessAuthoringWireResult(value: unknown): HeadlessAuthoringWireResult {
  try {
    const envelope = readStrictPassiveRecord(value, ["ok", "code", "value"]);
    if (envelope.ok === false) {
      const code = envelope.code as FailureCode;
      return !("value" in envelope) && authoringFailures.has(code) ? { ok: false, code } : unavailable;
    }
    if (envelope.ok !== true || "code" in envelope) return unavailable;
    const result = readStrictPassiveRecord(envelope.value, ["kind", "previewDigest", "validation", "removedInstanceIds", "removedBindingIds", "reference"]);
    if (result.kind === "committed" || result.kind === "replayed") {
      if (Object.keys(result).length !== 2) return unavailable;
      const { systemId, recordRevision, revisionId } = readStrictPassiveRecord(result.reference, ["systemId", "recordRevision", "revisionId"]);
      if (!isSystemBuilderSystemId(systemId) || hasKnownPassiveCredential(systemId) || typeof recordRevision !== "number" ||
          !Number.isSafeInteger(recordRevision) || recordRevision < 1 || !outboundId(revisionId)) return unavailable;
      return { ok: true, value: { kind: result.kind, reference: { systemId, recordRevision, revisionId } } };
    }
    const { kind, previewDigest, validation } = result;
    if (kind !== "preview" || Object.keys(result).length !== 5 ||
        typeof previewDigest !== "string" || previewDigest.length !== 64 || !/^[a-f0-9]{64}$/.test(previewDigest) ||
        (validation !== "valid" && validation !== "valid-with-warnings")) return unavailable;
    const removedInstanceIds = idList(result.removedInstanceIds, 513);
    const removedBindingIds = idList(result.removedBindingIds, 1_024);
    return { ok: true, value: { kind, previewDigest, validation, removedInstanceIds, removedBindingIds } };
  } catch { return unavailable; }
}

function idList(value: unknown, max: number): readonly string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid authoring references.");
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    const id: unknown = entry && "value" in entry ? entry.value : undefined;
    if (!outboundId(id)) throw new Error("Invalid authoring reference.");
    result.push(id);
  }
  if (new Set(result).size !== result.length) throw new Error("Duplicate authoring reference.");
  return result;
}

function outboundId(value: unknown): value is string {
  return typeof value === "string" && normalizeSystemBuilderRevisionId(value) === value && !hasKnownPassiveCredential(value);
}
