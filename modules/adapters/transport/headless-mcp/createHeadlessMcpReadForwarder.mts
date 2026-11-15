import { Agent, request } from "node:https";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import headless from "../../../contracts/headless/index.js";
import type { HeadlessPlanReviewAgentRequest, HeadlessPlanReviewAgentResult, HeadlessPlanStepRequest,
  HeadlessPlanStepResult, HeadlessLocalFileImportRequest, HeadlessLocalFileImportResult } from "../../../contracts/headless/index.js";
import type { HeadlessApprovedTurnRequest, HeadlessApprovedTurnResult, HeadlessAuthoringWireResult, HeadlessReadRequest, HeadlessSemanticBatchRequest, HeadlessSystemManagementRequest, HeadlessWindowRequest, HeadlessWindowResult } from "../../../contracts/headless/index.js";
import systemBuilder from "../../../contracts/system-builder/index.js";
import workspace from "../../../contracts/workspace/index.js";
import organization from "../../../contracts/organization/index.js";
import loopback from "../headless-loopback/index.js";
import managedWindow from "../../../contracts/headless/managed-headless-window.js";

const { HEADLESS_CONTRACT_VERSION, HEADLESS_READ_OPERATIONS, isDesktopHeadlessEndpoint, isDesktopHeadlessFingerprint, isHeadlessHostIncarnationId } = headless;
const { SYSTEM_BUILDER_TEMPLATE_IDS, isSystemBuilderSystemId, isSystemBuilderStatus, normalizeSystemBuilderRevisionId } = systemBuilder;
const { isWorkspaceId } = workspace;

const MAX_RESULT_BYTES = 128 * 1024;
const MAX_ACTIVE = 4;
const DEADLINE_MS = 5_000;
const MANAGED_SEMANTIC_APPLY_DEADLINE_MS = 13_000;
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
  "plan.capabilities": z.strictObject({
    workspaceId, approval: z.literal("required"),
    actions: z.array(z.enum(["systems.create", "systems.rename", "systems.clone"])).max(3)
      .refine(actions => new Set(actions).size === actions.length),
  }),
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
  "workflows.prepare": z.strictObject({ profile: workflowProfile, snapshotRevision: workflowId,
    approvedSessionIds: z.array(workflowId).max(100).refine(ids => new Set(ids).size === ids.length).optional(),
    actions: z.array(z.strictObject({
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
export type HeadlessPlanReviewForwardRequest = HeadlessPlanReviewAgentRequest & { readonly version: typeof HEADLESS_CONTRACT_VERSION };
type ForwardRequest = HeadlessReadRequest | AuthoringRequest | HeadlessApprovedTurnRequest | HeadlessWindowRequest |
  HeadlessPlanReviewForwardRequest | HeadlessPlanStepRequest | HeadlessLocalFileImportRequest;
const unknownWrite: HeadlessAuthoringWireResult = { ok: false, code: "headless.operation-unconfirmed" };
const unknownTurn = { ok: false, code: "headless.operation-unconfirmed" } as const;
export const MANAGED_HEADLESS_READS = ["host.describe", "templates.list", "systems.read", "plan.capabilities"] as const;
type ForwardResult = ReadResult | HeadlessAuthoringWireResult | HeadlessApprovedTurnResult | HeadlessWindowResult |
  HeadlessPlanReviewAgentResult | HeadlessPlanStepResult | HeadlessLocalFileImportResult;

export function createManagedHeadlessMcpReadForwarder(configuration: {
  readonly httpsOrigin?: string;
  readonly credential?: string;
  readonly organizationId?: string;
  readonly workspaceId?: string;
}, enableAuthoring = false, enableConsent = false, enableDelivery = false, enablePlanReview = false) {
  const {httpsOrigin, credential, organizationId, workspaceId} = configuration;
  if (typeof httpsOrigin !== "string" || httpsOrigin.length > 256 ||
      typeof credential !== "string" || credential.length < 1 || credential.length > 8_192 ||
      !/^[A-Za-z0-9._~+/=-]+$/.test(credential) ||
      !organization.isOrganizationId(organizationId) || !isWorkspaceId(workspaceId)) return undefined;
  let origin: URL;
  try { origin = new URL(httpsOrigin); } catch { return undefined; }
  if (origin.protocol !== "https:" || origin.origin !== httpsOrigin) return undefined;
  const address = new URL("/api/headless/agent/read", origin);
  const authoringAddress = new URL("/api/headless/agent/author", origin);
  const presentationAddress = new URL(managedWindow.MANAGED_HEADLESS_AGENT_WINDOW_PATH, origin);
  const planReviewAddress = enablePlanReview ? new URL(headless.MANAGED_HEADLESS_PLAN_REVIEW_PATH, origin) : undefined;
  const planStepAddress = enablePlanReview ? new URL(headless.MANAGED_HEADLESS_PLAN_STEP_PATH, origin) : undefined;
  const headers = {"x-organization-id": organizationId};
  const presentationSession = randomUUID();
  const presentationHeaders = {...headers, [managedWindow.MANAGED_HEADLESS_AGENT_SESSION_HEADER]: presentationSession};
  // Native Node TLS verifies the exact configured name against trusted CAs.
  // Each fixed POST independently prevents proxying and redirect following.
  const agent = new Agent({rejectUnauthorized: true, keepAlive: false, maxSockets: MAX_ACTIVE});
  const guard = (input: ForwardRequest) => {
    if (isPlanReview(input)) return enablePlanReview && input.target.workspaceId === workspaceId;
    if (input.operation === "plan.run-step") return enablePlanReview && input.input.workspaceId === workspaceId;
    if (input.version === headless.UI_CONTROL_VERSION) {
      const target = "target" in input.input ? input.input.target : input.input;
      return !enablePlanReview && enableConsent && target.workspaceId === workspaceId &&
        managedWindow.isManagedWindowOperation(input.operation, enableDelivery);
    }
    return input.version === HEADLESS_CONTRACT_VERSION &&
    (input.operation === "host.describe" ||
      ("workspaceId" in input.input && input.input.workspaceId === workspaceId &&
        ((!enablePlanReview && isAuthoring(input)) || MANAGED_HEADLESS_READS.some(operation => operation === input.operation))));
  };
  const forward = createForwarder({address, authoringAddress, conversationAddress: address, presentationAddress,
    planReviewAddress, planStepAddress, agent, authorization: `Bearer ${credential}`,
    enableAuthoring: !enablePlanReview && enableAuthoring, enableConversation: false, enablePresentation: !enablePlanReview && enableConsent,
    headers, presentationHeaders, managedSemanticApply: true});
  return async (input: ForwardRequest, signal?: AbortSignal): Promise<ForwardResult> => {
    if (!guard(input)) return {ok: false, code: "headless.forbidden"};
    const result = await forward(input, signal);
    if (!result.ok) return result;
    const serialized = JSON.stringify(result);
    if (serialized.includes(credential) || serialized.toLowerCase().includes(presentationSession))
      return input.operation === "plan.run-step" || isAuthoring(input) && input.operation !== "systems.preview-edits"
        ? unknownWrite : unavailable;
    if (input.version === headless.UI_CONTROL_VERSION) return managedWindow.readManagedWindowResult(result, input);
    if (resultHasOperation(result, "host.describe")) {
      const described = resultValue["host.describe"].safeParse(result.value);
      if (!described.success || described.data.workspaces.some(id => id !== workspaceId) ||
          described.data.operations.some(operation => !MANAGED_HEADLESS_READS.some(allowed => allowed === operation)))
        return unavailable;
    }
    return result;
  };
}

function resultHasOperation(result: ForwardResult, operation: HeadlessReadRequest["operation"]): result is ReadResult & { ok: true } {
  return result.ok && "operation" in result && result.operation === operation;
}

export function createHeadlessMcpReadForwarder(endpoint: unknown, fingerprint: unknown, credential: unknown,
  enableAuthoring = false, enableConversation = false, enablePresentation = false, enablePlanReview = false) {
  if (!isDesktopHeadlessEndpoint(endpoint) || !isDesktopHeadlessFingerprint(fingerprint) || typeof credential !== "string" ||
      credential.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(credential)) return undefined;
  // Build fixed paths locally. The pinned Agent attaches HTTP only to
  // the exact verified TLS socket; no proxy or redirect changes the target.
  const address = new URL("/aisb-headless/v1/read", endpoint);
  const authoringAddress = new URL("/aisb-headless/v1/author", endpoint);
  const conversationAddress = new URL(headless.HEADLESS_APPROVED_TURN_PATH, endpoint);
  const presentationAddress = new URL(headless.HEADLESS_WINDOW_CONTROL_PATH, endpoint);
  const planReviewAddress = enablePlanReview ? new URL(headless.HEADLESS_PLAN_REVIEW_PATH, endpoint) : undefined;
  const planStepAddress = enablePlanReview ? new URL(headless.HEADLESS_PLAN_STEP_PATH, endpoint) : undefined;
  const localFilePreviewAddress = enablePlanReview ? new URL(headless.HEADLESS_LOCAL_FILE_PREVIEW_PATH, endpoint) : undefined;
  const agent = loopback.createDesktopPinnedLoopbackAgent(endpoint, fingerprint);
  const authorization = `Bearer ${credential}`;
  return createForwarder({address, authoringAddress, conversationAddress, presentationAddress, planReviewAddress, planStepAddress, localFilePreviewAddress,
    agent, authorization, enableAuthoring: !enablePlanReview && enableAuthoring,
    enableConversation: !enablePlanReview && enableConversation, enablePresentation: !enablePlanReview && enablePresentation});
}

function createForwarder(options: {
  address: URL; authoringAddress: URL; conversationAddress: URL; presentationAddress: URL;
  planReviewAddress?: URL;
  planStepAddress?: URL;
  localFilePreviewAddress?: URL;
  agent: Agent | undefined; authorization: string; headers?: Readonly<Record<string, string>>;
  presentationHeaders?: Readonly<Record<string, string>>;
  enableAuthoring: boolean; enableConversation: boolean; enablePresentation: boolean;
  managedSemanticApply?: boolean;
}) {
  const {address, authoringAddress, conversationAddress, presentationAddress,
    agent, authorization, headers, presentationHeaders, enableAuthoring, enableConversation, enablePresentation} = options;
  let active = 0;
  return async (input: ForwardRequest, signal?: AbortSignal): Promise<ForwardResult> => {
    if (input.operation === "data.prepare-local-file") {
      if (!options.localFilePreviewAddress) return { ok: false, code: "headless.forbidden" };
      const decoded = headless.readHeadlessLocalFileImportRequest(input, input.input.hostIncarnationId);
      if (!decoded.ok) return decoded;
      if (active >= MAX_ACTIVE || signal?.aborted) return unavailable;
      active++;
      try {
        const { status, raw } = await sendRead(options.localFilePreviewAddress, agent, authorization, decoded.request, signal, headers);
        const result = headless.readHeadlessLocalFileImportResult(raw, decoded.request.input);
        if (result.ok) return status === 200 && result.value.checkpointExpiresAt > Date.now() &&
          !JSON.stringify(result).includes(authorization.slice("Bearer ".length)) ? result : unavailable;
        if ((status === 403 && result.code === "headless.forbidden") ||
            (status === 400 && result.code === "headless.invalid-request") ||
            (status === 409 && (result.code === "headless.host-changed" ||
              result.code === "headless.source-not-ready" || result.code === "headless.stale"))) return result;
        return unavailable;
      } catch { return unavailable; }
      finally { active--; }
    }
    if (input.operation === "plan.run-step") {
      if (!options.planStepAddress) return { ok: false, code: "headless.forbidden" };
      const accepted = headless.readHeadlessPlanStepRequest(input, input.input.hostIncarnationId);
      if (!accepted.ok) return accepted;
      if (active >= MAX_ACTIVE || signal?.aborted) return unavailable;
      active++;
      try {
        const { status, raw } = await sendRead(options.planStepAddress, agent, authorization, accepted.request, signal, headers);
        const result = headless.readHeadlessPlanStepResult(raw, accepted.request.input,
          { allowLocalFileSave: options.localFilePreviewAddress !== undefined });
        if (status === 200 && result.ok)
          return result.value.expiresAt > Date.now() ? result : unknownWrite;
        // The host can withhold a reply after it has saved the step. Only
        // unambiguous request or host validation errors are safe to report.
        if (!result.ok && ((status === 400 && result.code === "headless.invalid-request") ||
            (status === 409 && result.code === "headless.host-changed"))) return result;
        return unknownWrite;
      } catch { return unknownWrite; }
      finally { active--; }
    }
    if (isPlanReview(input)) {
      if (!options.planReviewAddress) return { ok: false, code: "headless.forbidden" };
      if (!options.localFilePreviewAddress && input.operation === "plan.submit" &&
          input.proposal.requests.some(step => step.operation === "data.save-local-source"))
        return { ok: false, code: "headless.forbidden" };
      if (active >= MAX_ACTIVE || signal?.aborted) return unavailable;
      active++;
      try {
        const fields = input.operation === "plan.submit"
          ? { ...input.target, steps: input.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })) }
          : input.target;
        const { status, raw } = await sendRead(options.planReviewAddress, agent, authorization,
          { version: input.version, operation: input.operation, input: fields }, signal, headers,
          DEADLINE_MS, headless.HEADLESS_PLAN_REVIEW_MAX_REQUEST_BYTES);
        const result = headless.readHeadlessPlanReviewAgentResult(raw, input.target.fingerprint,
          input.operation === "plan.submit" ? input.proposal.requests.length : undefined);
        if (status === 200 && result.ok)
          return result.value.expiresAt <= Date.now() ? { ok: false, code: "headless.plan-expired" } : result;
        return !result.ok && status >= 400 && status < 600 ? result : unavailable;
      } catch { return unavailable; }
      finally { active--; }
    }
    if (input.version === headless.UI_CONTROL_VERSION) {
      if (!enablePresentation) return { ok: false, code: "headless.forbidden" };
      if (!headless.readHeadlessWindowRequest(input) || active >= MAX_ACTIVE || signal?.aborted) return unavailable;
      active++;
      try {
        const { status, raw } = await sendRead(presentationAddress, agent, authorization, input, signal, presentationHeaders);
        const result = headless.readHeadlessWindowResult(raw);
        return (status === 200) === result.ok ? result : unavailable;
      } catch { return unavailable; }
      finally { active--; }
    }
    const author = isAuthoring(input);
    const converse = input.operation === headless.HEADLESS_APPROVED_TURN_OPERATION;
    if ((author && !enableAuthoring) || (converse && !enableConversation)) return { ok: false, code: "headless.forbidden" };
    if (active >= MAX_ACTIVE || signal?.aborted) return unavailable;
    active++;
    try {
      // Managed apply validates twice before its owned transaction. Let the
      // server's existing 12-second deadline decide admission and response.
      const deadlineMs = options.managedSemanticApply && input.operation === "systems.apply-edits"
        ? MANAGED_SEMANTIC_APPLY_DEADLINE_MS : DEADLINE_MS;
      const { status, raw } = await sendRead(converse ? conversationAddress : author ? authoringAddress : address,
        agent, authorization, input, signal, headers, deadlineMs);
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
      if (input.operation === "plan.capabilities") {
        const result = resultValue["plan.capabilities"].safeParse(parsed.data.value);
        if (!result.success || result.data.workspaceId !== input.input.workspaceId) return unavailable;
      }
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
        if (result.data.approvedSessionIds !== undefined &&
            (result.data.profile.profileId !== "builtin.workflow.conversation@1.0.0" || target.kind !== "reviewed-execution-plan"))
          return unavailable;
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

function isPlanReview(input: ForwardRequest): input is HeadlessPlanReviewForwardRequest {
  return input.operation === "plan.submit" || input.operation === "plan.status";
}

function isAuthoring(input: ForwardRequest): input is AuthoringRequest {
  return input.operation === "systems.preview-edits" || input.operation === "systems.apply-edits" ||
    input.operation === "systems.create" || input.operation === "systems.rename" || input.operation === "systems.clone";
}

function sendRead(address: URL, agent: Agent | undefined, authorization: string, input: unknown, signal?: AbortSignal,
  headers?: Readonly<Record<string, string>>, deadlineMs = DEADLINE_MS, maxRequestBytes = 8 * 1024) {
  const body = JSON.stringify(input);
  if (Buffer.byteLength(body) > maxRequestBytes) return Promise.reject(new Error("The local request is too large."));
  return new Promise<{ status: number; raw: unknown }>((resolve, reject) => {
    const client = request(address, {
      method: "POST",
      agent,
      signal,
      headers: { ...headers, Authorization: authorization, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (response) => {
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers["content-type"] ?? "") || response.headers["content-encoding"] ||
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
    const timer = setTimeout(() => client.destroy(new Error("Local connector timed out.")), deadlineMs);
    client.on("close", () => clearTimeout(timer));
    client.on("error", reject);
    client.end(body);
  });
}
