import { request, type Agent } from "node:https";
import { z } from "zod/v4";
import headless from "../../../contracts/headless/index.js";
import type { HeadlessApprovedTurnRequest, HeadlessApprovedTurnResult, HeadlessAuthoringWireResult, HeadlessReadRequest, HeadlessSemanticBatchRequest, HeadlessSystemManagementRequest } from "../../../contracts/headless/index.js";
import systemBuilder from "../../../contracts/system-builder/index.js";
import workspace from "../../../contracts/workspace/index.js";
import loopback from "../headless-loopback/index.js";

const { HEADLESS_CONTRACT_VERSION, HEADLESS_READ_OPERATIONS, isDesktopHeadlessEndpoint, isDesktopHeadlessFingerprint, isHeadlessHostIncarnationId } = headless;
const { SYSTEM_BUILDER_TEMPLATE_IDS, isSystemBuilderSystemId, isSystemBuilderStatus, normalizeSystemBuilderRevisionId } = systemBuilder;
const { isWorkspaceId } = workspace;

const MAX_RESULT_BYTES = 128 * 1024;
const MAX_ACTIVE = 4;
const DEADLINE_MS = 5_000;
const deadlineCode = "headless.unavailable";
const text = z.string().min(1).max(200);
const workspaceId = z.string().refine(isWorkspaceId, "Invalid workspace ID");
const systemId = z.string().refine(isSystemBuilderSystemId, "Invalid system ID");
const revisionId = z.string().refine((value) => {
  try { return normalizeSystemBuilderRevisionId(value) === value; } catch { return false; }
});
const operation = z.enum(HEADLESS_READ_OPERATIONS);
const templateId = z.enum(SYSTEM_BUILDER_TEMPLATE_IDS);
const resultError = z.strictObject({ ok: z.literal(false), code: z.enum([
  "headless.invalid-request", "headless.unsupported-version", "headless.unsupported-operation",
  "headless.host-changed", "headless.forbidden", "headless.not-found", "headless.unavailable",
  "headless.result-too-large", "headless.stale",
]) });
const system = z.strictObject({
  systemId, name: text, status: z.string().refine(isSystemBuilderStatus),
  revision: z.number().int().positive(), currentRevisionId: revisionId.optional(),
});
const cursor = z.strictObject({
  hostIncarnationId: z.string().refine(isHeadlessHostIncarnationId), sequence: z.number().int().nonnegative(),
  scopeTag: z.string().length(64).regex(/^[a-f0-9]{64}$/),
});
const savedReference = { systemId, recordRevision: z.number().int().positive(), revisionId: revisionId.nullable() };
const workflowId = z.string().refine(headless.isHeadlessWorkflowId);
const source = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("approved-release"), sourceId: workflowId, sourceDigest: z.string().length(71).regex(/^sha256:[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal("reviewed-execution-plan"), sourceId: workflowId, sourceRevision: workflowId }),
]);
const workflowProfile = z.strictObject({ profileId: workflowId, source,
  title: z.enum(["Controlled conversation", "Service request records", "Artifact review"]),
  availability: z.enum(["available", "blocked"]), blockers: z.array(z.strictObject({ code: workflowId })).max(16) });
const field = z.strictObject({ fieldId: workflowId, kind: z.enum(["text", "multiline", "integer", "number", "boolean", "select"]),
  required: z.boolean(), minimum: z.number().optional(), maximum: z.number().optional(),
  maximumLength: z.number().int().positive().optional(), options: z.array(workflowId).min(1).max(32).optional() });
const resultValue = {
  "host.describe": z.strictObject({
    version: z.literal(HEADLESS_CONTRACT_VERSION),
    hostIncarnationId: z.string().refine(isHeadlessHostIncarnationId),
    workspaces: z.array(workspaceId).max(128),
    operations: z.array(operation).max(HEADLESS_READ_OPERATIONS.length),
  }),
  "workspaces.list": z.array(z.strictObject({ workspaceId, displayName: text })).max(128),
  "systems.list": z.array(system).max(128),
  "systems.read": system,
  "templates.list": z.array(z.strictObject({ templateId, displayName: text })).max(128),
  "systems.snapshot": z.strictObject({
    systems: z.array(z.strictObject({ ...savedReference, status: z.string().refine(isSystemBuilderStatus) })).max(128), cursor,
  }),
  "systems.changes": z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("resync") }),
    z.strictObject({
      kind: z.literal("changes"),
      events: z.array(z.strictObject({ ...savedReference, sequence: z.number().int().positive() })).max(64),
      cursor, more: z.boolean(),
    }),
  ]),
  "workflows.list": z.array(workflowProfile).max(64),
  "workflows.prepare": z.strictObject({ profile: workflowProfile, snapshotRevision: workflowId, actions: z.array(z.strictObject({
    actionId: workflowId, intent: z.literal("read"), enabled: z.boolean(), requiresConfirmation: z.literal(false),
    fields: z.array(field).max(16),
  })).max(32) }),
  "conversation-tasks.read": z.strictObject({
    sessionId: workflowId, turnId: workflowId,
    turnStatus: z.enum(["draft", "submitted", "generating", "succeeded", "failed", "cancel-requested", "cancelled", "retryable", "blocked", "stale", "invalid"]),
    run: z.strictObject({ runId: workflowId, status: z.enum(["draft", "awaiting-approval", "approved", "queued", "running", "succeeded",
      "failed", "cancel-requested", "cancelled", "retryable", "blocked", "stale", "invalid", "archived"]) }).nullable(),
  }),
};

type ReadResult = { ok: true; operation: HeadlessReadRequest["operation"]; value: unknown } |
  { ok: false; code: z.infer<typeof resultError>["code"] };
const unavailable: ReadResult = { ok: false, code: deadlineCode };

type AuthoringRequest = HeadlessSemanticBatchRequest | HeadlessSystemManagementRequest;
type ForwardRequest = HeadlessReadRequest | AuthoringRequest | HeadlessApprovedTurnRequest;
const unknownWrite: HeadlessAuthoringWireResult = { ok: false, code: "headless.operation-unconfirmed" };
const unknownTurn = { ok: false, code: "headless.operation-unconfirmed" } as const;
export function createHeadlessMcpReadForwarder(endpoint: unknown, fingerprint: unknown, credential: unknown,
  enableAuthoring = false, enableConversation = false) {
  if (!isDesktopHeadlessEndpoint(endpoint) || !isDesktopHeadlessFingerprint(fingerprint) || typeof credential !== "string" ||
      credential.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(credential)) return undefined;
  // Build fixed paths locally. The pinned Agent attaches HTTP only to
  // the exact verified TLS socket; no proxy or redirect changes the target.
  const address = new URL("/aisb-headless/v1/read", endpoint);
  const authoringAddress = new URL("/aisb-headless/v1/author", endpoint);
  const conversationAddress = new URL(headless.HEADLESS_APPROVED_TURN_PATH, endpoint);
  const agent = loopback.createDesktopPinnedLoopbackAgent(endpoint, fingerprint);
  const authorization = `Bearer ${credential}`;
  let active = 0;
  return async (input: ForwardRequest, signal?: AbortSignal): Promise<ReadResult | HeadlessAuthoringWireResult | HeadlessApprovedTurnResult> => {
    const author = isAuthoring(input);
    const converse = input.operation === headless.HEADLESS_APPROVED_TURN_OPERATION;
    if ((author && !enableAuthoring) || (converse && !enableConversation)) return { ok: false, code: "headless.forbidden" };
    if (active >= MAX_ACTIVE || signal?.aborted) return unavailable;
    active++;
    try {
      const { status, raw } = await sendRead(converse ? conversationAddress : author ? authoringAddress : address, agent, authorization, input, signal);
      if (converse) {
        const result = headless.readHeadlessApprovedTurnResult(raw);
        if (status === 200 && result.ok) return result;
        // A 403 can also suppress the response to work already accepted.
        // Only definite pre-dispatch validation and reservation errors are final.
        if (!result.ok && (
          (status === 400 && (result.code === "headless.invalid-request" || result.code === "headless.unsupported-version")) ||
          (status === 409 && (result.code === "headless.host-changed" || result.code === "headless.idempotency-conflict")) ||
          (status === 410 && result.code === "headless.idempotency-expired")
        )) return result;
        return unknownTurn;
      }
      if (author) {
        const result = headless.readHeadlessAuthoringWireResult(raw);
        // The host deliberately uses the same 403 before admission and when
        // it must suppress a reply after a committed write. The client cannot
        // safely infer which happened or retry with a different key.
        if (status === 403 && input.operation !== "systems.preview-edits") return unknownWrite;
        if (!result.ok && status >= 400 && status < 500 && result.code !== "headless.unavailable") return result;
        if (status === 200 && result.ok &&
            (input.operation === "systems.preview-edits" ? result.value.kind === "preview" : result.value.kind !== "preview")) {
          if (result.value.kind !== "preview" && (input.operation === "systems.apply-edits" || input.operation === "systems.rename") &&
              result.value.reference.systemId !== input.input.systemId) return unknownWrite;
          return result;
        }
        return input.operation === "systems.preview-edits" ? unavailable : unknownWrite;
      }
      if (status >= 400 && status < 600) {
        const error = resultError.safeParse(raw);
        return error.success ? error.data : unavailable;
      }
      if (status !== 200) return unavailable;
      const expected = z.strictObject({ ok: z.literal(true), operation: z.literal(input.operation), value: resultValue[input.operation] });
      const parsed = expected.safeParse(raw);
      if (!parsed.success) return unavailable;
      if (input.operation === "systems.read" &&
          (!parsed.data.value || typeof parsed.data.value !== "object" || !("systemId" in parsed.data.value) ||
            parsed.data.value.systemId !== input.input.systemId)) return unavailable;
      if (input.operation === "systems.snapshot") {
        const result = resultValue["systems.snapshot"].safeParse(parsed.data.value);
        if (!result.success || result.data.cursor.hostIncarnationId !== input.input.hostIncarnationId) return unavailable;
      }
      if (input.operation === "systems.changes") {
        const result = resultValue["systems.changes"].safeParse(parsed.data.value);
        if (!result.success) return unavailable;
        if (result.data.kind === "changes") {
          const { events, cursor: next, more } = result.data;
          const previous = input.input.cursor.sequence;
          if (next.hostIncarnationId !== input.input.hostIncarnationId || next.sequence !== previous + events.length ||
              events.some(({ sequence }, index) => sequence !== previous + index + 1) || (more && events.length === 0)) return unavailable;
        }
      }
      if (input.operation === "conversation-tasks.read") {
        const result = resultValue["conversation-tasks.read"].safeParse(parsed.data.value);
        if (!result.success || result.data.sessionId !== input.input.sessionId || result.data.turnId !== input.input.turnId) return unavailable;
      }
      if (input.operation === "workflows.list") {
        const result = resultValue["workflows.list"].safeParse(parsed.data.value);
        if (!result.success || result.data.some(row => row.source.kind !== input.input.sourceKind)) return unavailable;
      }
      if (input.operation === "workflows.prepare") {
        const result = resultValue["workflows.prepare"].safeParse(parsed.data.value);
        const target = input.input.source;
        if (!result.success || result.data.profile.profileId !== input.input.profileId) return unavailable;
        const actual = result.data.profile.source;
        if (actual.sourceId !== target.sourceId || actual.kind !== target.kind ||
            (actual.kind === "approved-release" && target.kind === "approved-release" && actual.sourceDigest !== target.sourceDigest) ||
            (actual.kind === "reviewed-execution-plan" && target.kind === "reviewed-execution-plan" && actual.sourceRevision !== target.sourceRevision))
          return unavailable;
      }
      return parsed.data;
    } catch {
      return converse ? unknownTurn : author && input.operation !== "systems.preview-edits" ? unknownWrite : unavailable;
    } finally {
      active--;
    }
  };
}

function isAuthoring(input: ForwardRequest): input is AuthoringRequest {
  return input.operation === "systems.preview-edits" || input.operation === "systems.apply-edits" ||
    input.operation === "systems.create" || input.operation === "systems.rename" || input.operation === "systems.clone";
}

function sendRead(address: URL, agent: Agent, authorization: string, input: ForwardRequest, signal?: AbortSignal) {
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > 8 * 1024) return Promise.reject(new Error("The local request is too large."));
  return new Promise<{ status: number; raw: unknown }>((resolve, reject) => {
    const client = request(address, {
      method: "POST",
      agent,
      signal,
      headers: { Authorization: authorization, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (response) => {
      if (response.headers["content-type"] !== "application/json" || response.headers["content-encoding"] ||
          response.statusCode === undefined || !response.headers["content-length"] ||
          !/^[1-9][0-9]{0,5}$/.test(response.headers["content-length"])) {
        client.destroy(new Error("Invalid connector response."));
        return;
      }
      const length = Number(response.headers["content-length"]);
      if (length > MAX_RESULT_BYTES) {
        client.destroy(new Error("Invalid connector response."));
        return;
      }
      const bytes = Buffer.allocUnsafe(length);
      let offset = 0;
      response.on("error", reject);
      response.on("data", (chunk: Buffer) => {
        if (offset + chunk.length > length) client.destroy(new Error("Invalid connector response."));
        else offset += chunk.copy(bytes, offset);
      });
      response.on("end", () => {
        if (offset !== length) { reject(new Error("Invalid connector response.")); return; }
        try {
          const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          const raw: unknown = JSON.parse(text);
          if (JSON.stringify(raw) !== text) throw new Error("Invalid connector response.");
          resolve({ status: response.statusCode!, raw });
        } catch { reject(new Error("Invalid connector response.")); }
      });
    });
    const timer = setTimeout(() => client.destroy(new Error("Local connector timed out.")), DEADLINE_MS);
    client.on("close", () => clearTimeout(timer));
    client.on("error", reject);
    client.end(body);
  });
}
