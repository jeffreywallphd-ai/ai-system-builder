import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import headless from "../../../contracts/headless/index.js";
import type { HeadlessApprovedTurnRequest, HeadlessHostIncarnationId, HeadlessReadRequest, HeadlessSemanticBatchRequest, HeadlessSystemManagementRequest, HeadlessSystemSummary, HeadlessWindowRequest } from "../../../contracts/headless/index.js";
import type { HeadlessPlanStepRequest, HeadlessLocalFileImportRequest, HeadlessProviderFileImportRequest } from "../../../contracts/headless/index.js";
import systemBuilder from "../../../contracts/system-builder/index.js";
import type { SystemBuilderSystemId } from "../../../contracts/system-builder/index.js";
import workspace from "../../../contracts/workspace/index.js";
import type { WorkspaceId } from "../../../contracts/workspace/index.js";
import { createHeadlessMcpReadForwarder, createManagedHeadlessMcpReadForwarder,
  type HeadlessPlanReviewForwardRequest } from "./createHeadlessMcpReadForwarder.mjs";
import { boundHeadlessMcpStdio } from "./boundHeadlessMcpStdio.mjs";

const hostIncarnationId = z.string().refine(headless.isHeadlessHostIncarnationId, "Invalid host ID");
const workspaceId = z.string().refine(workspace.isWorkspaceId, "Invalid workspace ID");
const systemId = z.string().refine(systemBuilder.isSystemBuilderSystemId, "Invalid system ID");
const workflowId = z.string().refine(headless.isHeadlessWorkflowId, "Invalid workflow ID");
const workflowSource = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("approved-release"), sourceId: workflowId, sourceDigest: z.string().length(71).regex(/^sha256:[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal("reviewed-execution-plan"), sourceId: workflowId, sourceRevision: workflowId }),
]);
const version = headless.HEADLESS_CONTRACT_VERSION;
const requestedMode = process.env.AISB_HEADLESS_MODE;
const managed = requestedMode === "managed";
const enablePlanReview = process.env.AISB_HEADLESS_ENABLE_PLAN_REVIEW === "1";
const enableAuthoring = !enablePlanReview && process.env.AISB_HEADLESS_ENABLE_AUTHORING === "1";
const enableConversation = !enablePlanReview && process.env.AISB_HEADLESS_ENABLE_CONVERSATION === "1";
const enableManagedConsent = managed && !enablePlanReview && process.env.AISB_HEADLESS_ENABLE_MANAGED_CONSENT === "1";
const enableManagedDelivery = enableManagedConsent && process.env.AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION === "1";
const enablePresentation = managed ? enableManagedConsent : !enablePlanReview && process.env.AISB_HEADLESS_ENABLE_PRESENTATION === "1";
const forward = managed ? createManagedHeadlessMcpReadForwarder({
  httpsOrigin: process.env.AISB_HEADLESS_MANAGED_ORIGIN,
  credential: process.env.AISB_HEADLESS_MANAGED_CREDENTIAL,
  organizationId: process.env.AISB_HEADLESS_MANAGED_ORGANIZATION_ID,
  workspaceId: process.env.AISB_HEADLESS_MANAGED_WORKSPACE_ID,
}, enableAuthoring, enableManagedConsent, enableManagedDelivery, enablePlanReview) : requestedMode === undefined || requestedMode === "desktop" ? createHeadlessMcpReadForwarder(
  process.env.AISB_HEADLESS_ENDPOINT, process.env.AISB_HEADLESS_FINGERPRINT, process.env.AISB_HEADLESS_CREDENTIAL,
  enableAuthoring, enableConversation, enablePresentation, enablePlanReview,
) : undefined;
delete process.env.AISB_HEADLESS_CREDENTIAL;
delete process.env.AISB_HEADLESS_MANAGED_CREDENTIAL;

function toolResult<T extends { ok: boolean }>(result:T) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: !result.ok };
}

async function invoke(request: HeadlessReadRequest | HeadlessSemanticBatchRequest | HeadlessSystemManagementRequest |
  HeadlessApprovedTurnRequest | HeadlessWindowRequest | HeadlessPlanReviewForwardRequest | HeadlessPlanStepRequest |
  HeadlessLocalFileImportRequest | HeadlessProviderFileImportRequest,
  signal?: AbortSignal) {
  return toolResult(await forward?.(request, signal) ?? { ok: false, code: "headless.unavailable" });
}

function invalidAuthoring() {
  return toolResult({ ok: false, code: "headless.invalid-request" });
}

function addPresentationTools(server: McpServer) {
  const id = z.string().refine(headless.isUiControlId, "Invalid window control ID");
  const window = { hostIncarnationId, workspaceId, windowId: id, uiIncarnationId: id };
  const attempt = { ...window, requestId: id, attemptId: id };
  const lease = z.strictObject({ ...attempt, leaseId: id, generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
  const destructiveHint = false;
  const openWorldHint = false;
  const read = { readOnlyHint: true, destructiveHint, openWorldHint };
  const action = { readOnlyHint: false, destructiveHint, openWorldHint, idempotentHint: true };
  const exactResource = z.string().min(1).max(160);
  const intent = z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("open-system"), systemId, revisionId: exactResource }),
    z.strictObject({ action: z.literal("select-component"), systemId, revisionId: exactResource, instanceId: exactResource }),
    z.strictObject({ action: z.literal("show-validation"), systemId, revisionId: exactResource }),
    z.strictObject({ action: z.literal("show-run"), runId: exactResource }),
    z.strictObject({ action: z.literal("show-artifact"), artifactId: z.string().min(1).max(512) }),
    z.strictObject({ action: z.literal("show-data-source"), taskId: exactResource, fileId: exactResource,
      taskRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
    z.strictObject({ action: z.literal("show-dataset-version"), datasetId: exactResource, versionId: exactResource,
      versionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
    z.strictObject({ action: z.literal("show-dataset-task"), taskId: hostIncarnationId }),
  ]);
  const call = (operation: HeadlessWindowRequest["operation"], input: unknown, signal?: AbortSignal) => {
    const request = headless.readHeadlessWindowRequest({ version: headless.UI_CONTROL_VERSION, operation, input });
    return request ? invoke(request, signal) : invalidAuthoring();
  };
  server.registerTool("aisb_list_windows", {
    description: "List current application window identities in the authorized workspace.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId }), annotations: read,
  }, (input, context) => call("window.list", input, context.mcpReq.signal));
  server.registerTool("aisb_request_window", {
    description: "Ask the user to attach a single identified window. Reuse the request key after an uncertain reply.",
    inputSchema: z.strictObject({ target: z.strictObject(window), taskId: id, requestKey: id }), annotations: action,
  }, (input, context) => call("window.request", input, context.mcpReq.signal));
  server.registerTool("aisb_window_status", {
    description: "Read the exact request status. Only an active request has a lease. Ended requests require fresh user direction.",
    inputSchema: z.strictObject({ target: z.strictObject(attempt) }), annotations: read,
  }, (input, context) => call("window.status", input, context.mcpReq.signal));
  server.registerTool("aisb_release_window", {
    description: "Dismiss the exact attempt or release its exact lease. Independent chat work continues.",
    inputSchema: z.strictObject({ target: z.union([lease, z.strictObject(attempt)]) }), annotations: action,
  }, (input, context) => call("window.release", input, context.mcpReq.signal));
  if (managed && !enableManagedDelivery) return;
  server.registerTool("aisb_renew_window", {
    description: "Keep the same active lease current. Failed and ended leases stay detached.",
    inputSchema: z.strictObject({ target: lease }), annotations: { ...action, idempotentHint: false },
  }, (input, context) => call("window.renew", input, context.mcpReq.signal));
  server.registerTool("aisb_present_in_window", {
    description: "Show one exact saved resource in the active window. Retry the same command ID and target to read the outcome without repeating the effect.",
    inputSchema: z.strictObject({ target: lease, commandId: id, intent }), annotations: action,
  }, (input, context) => call("window.present", input, context.mcpReq.signal));
  server.registerTool("aisb_window_context", {
    description: "Read the current allowed view and saved resource identifiers from one active lease.",
    inputSchema: z.strictObject({ target: lease }), annotations: read,
  }, (input, context) => call("window.context", input, context.mcpReq.signal));
}

function addSystemBuilderTools(server: McpServer) {
  const displayName = z.string().min(1).max(120);
  const idempotencyKey = z.string().refine(headless.isHeadlessHostIncarnationId, "Invalid retry key");
  const workspaceTarget = { hostIncarnationId, workspaceId };
  const savedRevision = {
    systemId, baseRecordRevision: z.number().int().positive(),
    baseRevisionId: z.string().min(1).max(160),
  };
  const base = { ...workspaceTarget, ...savedRevision };
  const create = { templateId: z.enum(systemBuilder.SYSTEM_BUILDER_TEMPLATE_IDS), name: displayName, idempotencyKey };
  const savedChange = { ...savedRevision, idempotencyKey, name: displayName };
  const rename = { ...savedChange, description: z.string().min(1).max(1_000).optional() };
  const target = { ...workspaceTarget, ...savedChange };
  const id = z.string().min(1).max(160);
  const place = { parentInstanceId: id, slotId: id, order: z.number().int().nonnegative().max(511) };
  const configuration = z.record(z.string().min(1).max(64), z.unknown());
  const edits = z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("add"), instanceId: id, definitionId: id, version: z.string().min(1).max(128), configuration, ...place }),
    z.strictObject({ kind: z.literal("configure"), instanceId: id, values: configuration }),
    z.strictObject({ kind: z.literal("connect"), bindingId: id, bindingKind: z.enum(["input", "output", "event", "control"]),
      sourceInstanceId: id, sourcePortId: id, targetInstanceId: id, targetPortId: id }),
    z.strictObject({ kind: z.literal("move"), instanceId: id, ...place }),
    z.strictObject({ kind: z.literal("remove"), instanceId: id }),
  ])).min(1).max(headless.HEADLESS_MAX_SEMANTIC_EDITS);
  const writeHints = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
  const queryHints = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  async function author(operation: HeadlessSemanticBatchRequest["operation"] | HeadlessSystemManagementRequest["operation"],
    input: { hostIncarnationId: string }, signal?: AbortSignal) {
    if (!headless.isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalidAuthoring();
    const raw = { version, operation, input };
    const edit = headless.parseHeadlessSemanticBatchRequest(raw, input.hostIncarnationId);
    if (edit.ok) return invoke(edit.request, signal);
    const management = headless.parseHeadlessSystemManagementRequest(raw, input.hostIncarnationId);
    return management.ok ? invoke(management.request, signal) : invalidAuthoring();
  }
  if (enableAuthoring) {
    server.registerTool("aisb_create_system", {
      description: "Create one saved system from an exact template in the approved workspace. Reuse the same key after a lost reply.",
      inputSchema: z.strictObject({ ...workspaceTarget, ...create }),
      annotations: { ...writeHints, destructiveHint: false },
    }, (input, context) => author("systems.create", input, context.mcpReq.signal));
    server.registerTool("aisb_rename_system", {
      description: "Rename one saved system against both revisions. If omitted, the existing description is preserved.",
      inputSchema: z.strictObject({ ...workspaceTarget, ...rename }), annotations: writeHints,
    }, (input, context) => author("systems.rename", input, context.mcpReq.signal));
    server.registerTool("aisb_clone_system", {
      description: "Copy one exact saved system revision in its approved workspace.",
      inputSchema: z.strictObject(target), annotations: { ...writeHints, destructiveHint: false },
    }, (input, context) => author("systems.clone", input, context.mcpReq.signal));
    server.registerTool("aisb_preview_edits", {
      description: "Validate a bounded edit batch and list what it removes. This does not change saved state.",
      inputSchema: z.strictObject({ ...base, edits }), annotations: queryHints,
    }, (input, context) => author("systems.preview-edits", input, context.mcpReq.signal));
    server.registerTool("aisb_apply_edits", {
      description: "Apply the exact preview to the same saved revision. Reuse the same key after a lost reply; do not repeat with a new key.",
      inputSchema: z.strictObject({ ...base, edits, previewDigest: z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey }), annotations: writeHints,
    }, (input, context) => author("systems.apply-edits", input, context.mcpReq.signal));
  }
  const allowLocalFileSave = enablePlanReview;
  const allowProviderFileSave = enablePlanReview;
  const allowLocalDatasetPreparation = enablePlanReview;
  const allowDatasetResultSave = enablePlanReview;
  const allowContextPackGeneration = enablePlanReview;
  const allowContextRagGeneration = enablePlanReview;
  const allowContextResultSave = enablePlanReview;
  const ingestionId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  const localFileTarget = { taskId: ingestionId, fileId: ingestionId,
    taskRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) };
  const source = z.strictObject(localFileTarget);
  const column = z.string().min(1).max(64).regex(/^[A-Za-z_][A-Za-z0-9_. -]*$/);
  const datasetPreparation = {sources: z.array(source).min(1).max(headless.HEADLESS_DATASET_MAX_SOURCES),
    recipe: z.strictObject({kind: z.literal("provided-instruction-rows-v1"), inputColumn: column, outputColumn: column}),
    split: z.strictObject({trainRatio: z.number().positive().max(1), validationRatio: z.number().min(0).max(1), testRatio: z.number().min(0).max(1),
      seed: z.number().int().min(0).max(2_147_483_647)}), qualityPreset: z.enum(["recommended", "strict"])};
  const contextSource = z.discriminatedUnion("kind", [
    z.strictObject({kind: z.literal("ingestion-file"), ...localFileTarget}),
    z.strictObject({kind: z.literal("dataset-version"), datasetId: ingestionId, versionId: ingestionId,
      versionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), role: z.enum(["dataset", "train", "validation", "test"])}),
  ]);
  const chunks = {chunkCharacters: z.number().int().min(64).max(32000), overlapCharacters: z.number().int().min(0).max(8000),
    maximumChunks: z.number().int().min(1).max(1000), textFields: z.array(z.string().min(1).max(128)).max(32)};
  const contextPackSettings = z.strictObject({...chunks, kind: z.literal("markdown-context-pack"), cleaningPreset: z.enum(["standard", "strict"])});
  const contextRagSettings = z.strictObject({...chunks, kind: z.literal("rag-database"), modelRecordId: z.string().refine(headless.isHeadlessContextModelId),
    modelUpdatedAt: z.string().refine(headless.isHeadlessContextTimestamp), batchSize: z.number().int().min(1).max(32), device: z.enum(["cpu", "cuda"]),
    sourceChecks: z.strictObject({preset: z.enum(["recommended", "strict"]), allowedLanguages: z.array(z.string().min(2).max(16)).min(1).max(16),
      requireLicenseMetadata: z.boolean(), requireConsentMetadata: z.boolean(), includeSourceAttribution: z.boolean()})});
  if (enablePlanReview) {
    const contextSettings = z.discriminatedUnion("kind", [
      contextPackSettings,
      contextRagSettings,
    ]);
    const contextRead = (operation: "context.models" | "context.preview-generation", input: {hostIncarnationId: string}, signal?: AbortSignal) => {
      const parsed = headless.readHeadlessContextReadRequest({version, operation, input}, input.hostIncarnationId as HeadlessHostIncarnationId);
      return parsed.ok ? invoke(parsed.request, signal) : invalidAuthoring();
    };
    server.registerTool("aisb_context_models", {
      description: "List at most 32 recorded model metadata entries in this workspace. No shared-file discovery, model warming or dependency install. Recorded status is not proof that a model is currently usable; runtime readiness remains not checked.",
      inputSchema: z.strictObject(workspaceTarget), annotations: queryHints,
    }, (input, context) => contextRead("context.models", input, context.mcpReq.signal));
    server.registerTool("aisb_preview_context_generation", {
      description: "Preview exact saved source files or immutable dataset versions with Context settings. Returns bounded hashes, sizes and settings, never source text or private paths. Starts no extraction, index, model or task. Approval and result review remain required; runtime readiness is not checked. Four sources of at most 4 MiB each and 1000 chunks.",
      inputSchema: z.strictObject({...workspaceTarget, name: z.string().min(1).max(120),
        sources: z.array(contextSource).min(1).max(headless.HEADLESS_CONTEXT_MAX_SOURCES), settings: contextSettings}), annotations: queryHints,
    }, (input, context) => contextRead("context.preview-generation", input, context.mcpReq.signal));
    const datasetSelection = z.discriminatedUnion("kind", [
      z.strictObject({kind: z.literal("task"), taskId: z.string().uuid()}),
      z.strictObject({kind: z.literal("plan-step"), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        step: z.number().int().min(1).max(headless.HEADLESS_MAX_BUILD_PLAN_STEPS)}),
    ]);
    server.registerTool("aisb_context_task", {
      description: "Poll one accepted Context task or recover its receipt from an exact known approved plan step. The owner validates completed output and returns only state, counts and a review fingerprint. No source text, paths, prompts or embeddings. Starts no new task and cannot approve, save, publish or adopt an uncertain attempt.",
      inputSchema: z.strictObject({...workspaceTarget, selection: datasetSelection}), annotations: queryHints,
    }, (input, context) => {
      const parsed = headless.readHeadlessContextTaskRequest({version, operation: "context.task", input},
        input.hostIncarnationId as HeadlessHostIncarnationId);
      return parsed.ok ? invoke(parsed.request, context.mcpReq.signal) : invalidAuthoring();
    });
    server.registerTool("aisb_read_context", {
      description: "Read bounded metadata for one exact saved Context ID in this workspace. Returns its causal saved reference, name, digest and counts. Reads no artifact bytes, source text, private paths or embeddings and starts no model/runtime. Byte availability remains not checked; this read grants no query, rebuild or window permission.",
      inputSchema: z.strictObject({...workspaceTarget, contextId: z.string().uuid()}), annotations: queryHints,
    }, (input, context) => {
      const parsed = headless.readHeadlessContextSavedRequest({version, operation: "context.saved", input}, input.hostIncarnationId as HeadlessHostIncarnationId);
      return parsed.ok ? invoke(parsed.request, context.mcpReq.signal) : invalidAuthoring();
    });
    server.registerTool("aisb_dataset_task_status", {
      description: "Read one accepted dataset task or recover its receipt from a known approved plan step. Returns only task identity and state. Unconfirmed reservations are not adopted or restarted. This read cannot prepare, approve, save or publish output.",
      inputSchema: z.strictObject({...workspaceTarget, selection: datasetSelection}), annotations: queryHints,
    }, (input, context) => {
      const parsed = headless.readHeadlessDatasetTaskStatusRequest({version, operation: "data.dataset-task-status", input},
        input.hostIncarnationId as HeadlessHostIncarnationId);
      return parsed.ok ? invoke(parsed.request, context.mcpReq.signal) : invalidAuthoring();
    });
    server.registerTool("aisb_dataset_task_review", {
      description: "Read bounded quality counts, split counts, report identity and save availability for an accepted dataset task. Returns no rows or samples. Processing must reach required result review first; this read cannot approve, save, publish or restart work.",
      inputSchema: z.strictObject({...workspaceTarget, selection: datasetSelection}), annotations: queryHints,
    }, (input, context) => {
      const parsed = headless.readHeadlessDatasetTaskReviewRequest({version, operation: "data.dataset-task-review", input},
        input.hostIncarnationId as HeadlessHostIncarnationId);
      return parsed.ok ? invoke(parsed.request, context.mcpReq.signal) : invalidAuthoring();
    });
    server.registerTool("aisb_preview_dataset_preparation", {
      description: "Preview exact completed local sources, provided-row mapping, split and quality settings. Reports metadata and fixed limits without reading source contents, starting processing or granting approval. At most four files of 4 MiB each; unknown local file licensing stays unknown.",
      inputSchema: z.strictObject({...workspaceTarget, ...datasetPreparation}),
      annotations: queryHints,
    }, (input, context) => {
      const parsed = headless.readHeadlessDatasetPreparationRequest({version, operation: "data.preview-dataset-preparation", input}, input.hostIncarnationId as HeadlessHostIncarnationId);
      return parsed.ok ? invoke(parsed.request, context.mcpReq.signal) : invalidAuthoring();
    });
    const datasetId = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
    const query = (operation: "data.dataset-versions" | "data.compare-dataset-versions", input: {hostIncarnationId: string}, signal?: AbortSignal) => {
      const parsed = headless.parseHeadlessReadRequest({version, operation, input}, input.hostIncarnationId as HeadlessHostIncarnationId);
      return parsed.ok ? invoke(parsed.request, signal) : invalidAuthoring();
    };
    server.registerTool("aisb_dataset_versions", {
      description: "Inspect one to sixteen exact saved version IDs from the same dataset. Returns digests and counts in the requested order without scanning history or returning private recipes, paths or content.",
      inputSchema: z.strictObject({...workspaceTarget, datasetId, versionIds: z.array(datasetId).min(1).max(headless.HEADLESS_DATASET_VERSION_READ_LIMIT).refine(ids => new Set(ids).size === ids.length)}), annotations: queryHints,
    }, (input, context) => query("data.dataset-versions", input, context.mcpReq.signal));
    server.registerTool("aisb_compare_dataset_versions", {
      description: "Compare two exact saved versions of the same dataset in the approved workspace. Returns only change flags, counts and artifact roles. Starts no preparation or model task.",
      inputSchema: z.strictObject({...workspaceTarget, fromVersionId: datasetId, toVersionId: datasetId}), annotations: queryHints,
    }, (input, context) => query("data.compare-dataset-versions", input, context.mcpReq.signal));
  }
  if (enablePlanReview) server.registerTool("aisb_ingestion_status", {
    description: "Read progress for one known ingestion task in the approved workspace. Returns counts and state without source contents, paths, or credentials.",
    inputSchema: z.strictObject({ ...workspaceTarget, taskId: ingestionId }), annotations: queryHints,
  }, (input, context) => {
    const parsed = headless.parseHeadlessReadRequest({version, operation: "data.ingestion-status", input}, input.hostIncarnationId as HeadlessHostIncarnationId);
    return parsed.ok ? invoke(parsed.request, context.mcpReq.signal) : invalidAuthoring();
  });
  const step = z.discriminatedUnion("operation", [
    z.strictObject({operation: z.literal("context.save-result"), idempotencyKey, taskId: z.string().uuid(),
      reportFingerprint: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().min(1).max(120)}),
    z.strictObject({operation: z.literal("context.generate-rag"), idempotencyKey, name: z.string().min(1).max(120),
      sources: z.array(contextSource).min(1).max(headless.HEADLESS_CONTEXT_MAX_SOURCES), settings: contextRagSettings}),
    z.strictObject({operation: z.literal("context.generate-pack"), idempotencyKey, name: z.string().min(1).max(120),
      sources: z.array(contextSource).min(1).max(headless.HEADLESS_CONTEXT_MAX_SOURCES), settings: contextPackSettings}),
    z.strictObject({ operation: z.literal("systems.create"), ...create }),
    z.strictObject({ operation: z.literal("systems.rename"), ...rename }),
    z.strictObject({ operation: z.literal("systems.clone"), ...savedChange }),
    z.strictObject({ operation: z.literal("data.save-local-source"), ...localFileTarget, idempotencyKey }),
    z.strictObject({ operation: z.literal("data.save-provider-source"), ...localFileTarget, idempotencyKey }),
    z.strictObject({ operation: z.literal("data.prepare-local-dataset"), ...datasetPreparation, idempotencyKey }),
    z.strictObject({ operation: z.literal("data.save-prepared-dataset"), taskId: z.string().uuid(),
      reportFingerprint: z.string().regex(/^[a-f0-9]{64}$/), outputBaseName: z.string().min(1).max(160), idempotencyKey }),
  ]);
  server.registerTool("aisb_plan_capabilities", {
    description: "Check which saved-system operations can be proposed in one current workspace. Use the corresponding template or saved revision as input. Plan execution requires approval.",
    inputSchema: z.strictObject(workspaceTarget),
    annotations: queryHints,
  }, (input, context) => {
    if (!headless.isHeadlessHostIncarnationId(input.hostIncarnationId) || !workspace.isWorkspaceId(input.workspaceId))
      return invalidAuthoring();
    return invoke({version, operation:"plan.capabilities",
      input:{hostIncarnationId:input.hostIncarnationId, workspaceId:input.workspaceId}}, context.mcpReq.signal);
  });
  server.registerTool("aisb_preview_build_plan", {
    description: allowLocalFileSave
      ? "Check proposed system changes, selected file saves, provided-row dataset preparation, reviewed dataset saves, Context generation and separately reviewed Context saves. Sources must already be saved. RAG generation requires an approved installed embedding model; deterministic packs and result saves call no model. The preview identifies exact permissions and limits. Execution requires separate approval."
      : "Check proposed create, rename, and clone steps in order against current workspace data. Preview requires separate approval before execution.",
    inputSchema: z.strictObject({ ...workspaceTarget, steps: z.array(step).min(1).max(headless.HEADLESS_MAX_BUILD_PLAN_STEPS) }),
    annotations: queryHints,
  }, async (input, context) => {
    if (!headless.isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalidAuthoring();
    const proposal = headless.parseHeadlessBuildPlanProposal(input, input.hostIncarnationId, { allowLocalFileSave, allowProviderFileSave, allowLocalDatasetPreparation, allowDatasetResultSave, allowContextPackGeneration, allowContextRagGeneration, allowContextResultSave });
    if (!proposal.ok) return invalidAuthoring();
    const { scope, requests, preview } = proposal;

    const unavailable = { ok: false, code: "headless.unavailable" } as const;
    const deadline = AbortSignal.timeout(12_000);
    const signal = context.mcpReq.signal ? AbortSignal.any([deadline, context.mcpReq.signal]) : deadline;
    let templates: ReadonlySet<string> | undefined;
    const records = new Map<SystemBuilderSystemId, HeadlessSystemSummary>();
    for (const request of requests) {
      if (request.operation === "context.save-result") {
        const selection = {kind: "task", taskId: request.input.taskId} as const;
        const reviewed = await forward?.({version, operation: "context.task", input: {
          hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId, selection}}, signal);
        if (!reviewed?.ok) return toolResult(reviewed ?? unavailable);
        const report = headless.readHeadlessContextTaskValue(reviewed.value, selection)?.review;
        if (!report || !report.requiresExplicitSave || report.reportFingerprint !== request.input.reportFingerprint)
          return toolResult(unavailable);
        continue;
      }
      if (request.operation === "context.generate-pack" || request.operation === "context.generate-rag") {
        const {idempotencyKey: _key, ...selected} = request.input;
        const preview = await forward?.({version, operation: "context.preview-generation", input: selected}, signal);
        if (!preview?.ok) return toolResult(preview ?? unavailable);
        if (!("operation" in preview) || preview.operation !== "context.preview-generation" ||
            !headless.readHeadlessContextPreview(preview.value, selected)) return toolResult(unavailable);
        continue;
      }
      if (request.operation === "data.save-prepared-dataset") {
        const reviewed = await forward?.({version, operation: "data.dataset-task-review", input: {
          hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId,
          selection: {kind: "task", taskId: request.input.taskId}}}, signal);
        if (!reviewed?.ok) return toolResult(reviewed ?? unavailable);
        const report = headless.readHeadlessDatasetTaskReviewValue(reviewed.value, {kind: "task", taskId: request.input.taskId})?.review;
        if (!report || !report.saveAvailable || !report.approvalAllowed || report.reportFingerprint !== request.input.reportFingerprint)
          return toolResult(unavailable);
        continue;
      }
      if (request.operation === "data.prepare-local-dataset") {
        const {idempotencyKey: _key, ...selected} = request.input;
        const preview = await forward?.({version, operation: "data.preview-dataset-preparation", input: selected}, signal);
        if (!preview?.ok) return toolResult(preview ?? unavailable);
        if (!headless.readHeadlessDatasetPreparationPreview(preview.value, selected)) return toolResult(unavailable);
        continue;
      }
      if (request.operation === "data.save-provider-source") {
        const { idempotencyKey: _key, ...selected } = request.input;
        const preview = await forward?.({ version, operation: "data.prepare-provider-file", input: selected }, signal);
        if (!preview?.ok) return toolResult(preview ?? unavailable);
        if (!headless.readHeadlessProviderFileImportResult(preview, selected).ok) return toolResult(unavailable);
        continue;
      }
      if (request.operation === "data.save-local-source") {
        const { idempotencyKey: _key, ...selected } = request.input;
        const preview = await forward?.({ version, operation: "data.prepare-local-file", input: selected }, signal);
        if (!preview?.ok) return toolResult(preview ?? unavailable);
        if (!headless.readHeadlessLocalFileImportResult(preview, selected).ok) return toolResult(unavailable);
        continue;
      }
      if (request.operation === "systems.create") {
        if (!templates) {
          const result = await forward?.({ version, operation: "templates.list", input: scope }, signal);
          if (!result?.ok) return toolResult(result ?? unavailable);
          if (!("operation" in result) || result.operation !== "templates.list" || !Array.isArray(result.value))
            return toolResult(unavailable);
          templates = new Set(result.value.map(({ templateId }) => templateId));
        }
        if (!templates.has(request.input.templateId)) return toolResult({ ok: false, code: "headless.not-found" });
        continue;
      }
      const { systemId, baseRecordRevision, baseRevisionId } = request.input;
      let record = records.get(systemId);
      if (!record) {
        const result = await forward?.({ version, operation: "systems.read", input: { ...scope, systemId } }, signal);
        if (!result?.ok) return toolResult(result ?? unavailable);
        if (!("operation" in result) || result.operation !== "systems.read") return toolResult(unavailable);
        // The existing read forwarder validates this response and its target.
        record = result.value as HeadlessSystemSummary;
        records.set(systemId, record);
      }
      if (record.systemId !== systemId || record.status === "archived")
        return toolResult({ ok: false, code: "headless.not-found" });
      if (record.revision !== baseRecordRevision || record.currentRevisionId !== baseRevisionId)
        return toolResult({ ok: false, code: "headless.stale" });
    }
    if (signal.aborted) return toolResult(unavailable);
    const fingerprint = createHash("sha256").update(JSON.stringify(preview), "utf8").digest("hex");
    return toolResult({ ok: true, value: { ...preview, fingerprint } });
  });
  if (enablePlanReview) {
    server.registerTool("aisb_preview_selected_local_file", {
      description: "Preview the type and size of a staged local file the user selected for this plan-review client. Preview leaves the file staged.",
      inputSchema: z.strictObject({ ...workspaceTarget, ...localFileTarget }),
      annotations: queryHints,
    }, (input, context) => {
      if (!headless.isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalidAuthoring();
      const decoded = headless.readHeadlessLocalFileImportRequest({ version, operation: "data.prepare-local-file", input },
        input.hostIncarnationId);
      return decoded.ok ? invoke(decoded.request, context.mcpReq.signal) : invalidAuthoring();
    });
    server.registerTool("aisb_preview_selected_provider_file", {
      description: "Preview the file type and immutable revision of one repository file selected for this plan-review client. Import requires approval.",
      inputSchema: z.strictObject({ ...workspaceTarget, ...localFileTarget }),
      annotations: queryHints,
    }, (input, context) => {
      if (!headless.isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalidAuthoring();
      const decoded = headless.readHeadlessProviderFileImportRequest({ version, operation: "data.prepare-provider-file", input },
        input.hostIncarnationId);
      return decoded.ok ? invoke(decoded.request, context.mcpReq.signal) : invalidAuthoring();
    });
    const fingerprint = z.string().length(64).regex(/^[a-f0-9]{64}$/);
    const reviewTarget = { ...workspaceTarget, fingerprint };
    const submit = { ...reviewTarget, steps: z.array(step).min(1).max(headless.HEADLESS_MAX_BUILD_PLAN_STEPS) };
    async function reviewPlan(operation: "plan.submit" | "plan.status", input: { hostIncarnationId: string }, signal?: AbortSignal) {
      if (!headless.isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalidAuthoring();
      const raw = { version, operation, input };
      const decoded = headless.readHeadlessPlanReviewAgentRequest(raw, input.hostIncarnationId, { allowLocalFileSave, allowProviderFileSave, allowLocalDatasetPreparation, allowDatasetResultSave, allowContextPackGeneration, allowContextRagGeneration, allowContextResultSave });
      return decoded.ok ? invoke({ ...decoded.request, version }, signal) : invalidAuthoring();
    }
    server.registerTool("aisb_request_build_plan_approval", {
      description: "Send the exact preview for human review in the app. An exact retry returns the current decision and original deadline.",
      inputSchema: z.strictObject(submit), annotations: { ...writeHints, destructiveHint: false },
    }, (input, context) => reviewPlan("plan.submit", input, context.mcpReq.signal));
    server.registerTool("aisb_build_plan_approval_status", {
      description: "Read the app's current decision and expiry for one exact build-plan proposal.",
      inputSchema: z.strictObject(reviewTarget), annotations: queryHints,
    }, (input, context) => reviewPlan("plan.status", input, context.mcpReq.signal));
    server.registerTool("aisb_run_approved_build_step", {
      description: "Run the next exact approved change. Use the same step and revision to recover an uncertain reply while approval is current.",
      inputSchema: z.strictObject({ ...reviewTarget, approvalRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        step: z.number().int().min(1).max(headless.HEADLESS_MAX_BUILD_PLAN_STEPS) }),
      annotations: { ...writeHints, destructiveHint: false },
    }, (input, context) => {
      if (!headless.isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalidAuthoring();
      const decoded = headless.readHeadlessPlanStepRequest({ version, operation: "plan.run-step", input }, input.hostIncarnationId);
      return decoded.ok ? invoke(decoded.request, context.mcpReq.signal) : invalidAuthoring();
    });
  }
}

serveStdio(() => {
  const host = managed ? "managed" : "desktop";
  const mode = enablePlanReview ? "plan-review" : enableAuthoring ? "authoring" : "read";
  const server = new McpServer({ name: `ai-system-builder-${host}-${mode}`, version: "1.0.0" }, { capabilities: { tools: {} } });
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool("aisb_host_describe", {
    description: managed ? "Read the configured managed server's version, current ID, and granted operations."
      : "Read the connected desktop host's version, current ID, and granted operations.",
    inputSchema: z.strictObject({}), annotations,
  }, (_input, context) => invoke({ version, operation: "host.describe", input: {} }, context.mcpReq.signal));
  if (!managed) server.registerTool("aisb_list_workspaces", {
    description: "List the workspaces this paired client can read.",
    inputSchema: z.strictObject({ hostIncarnationId }), annotations,
  }, (input, context) => invoke({ version, operation: "workspaces.list", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId,
  } }, context.mcpReq.signal));
  if (!managed) server.registerTool("aisb_list_systems", {
    description: "List saved systems in one authorized workspace.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId }), annotations,
  }, (input, context) => invoke({ version, operation: "systems.list", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
  } }, context.mcpReq.signal));
  server.registerTool("aisb_read_system", {
    description: "Read one saved system's name, status, and revision from its workspace.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId, systemId }), annotations,
  }, (input, context) => invoke({ version, operation: "systems.read", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
    systemId: input.systemId as SystemBuilderSystemId,
  } }, context.mcpReq.signal));
  server.registerTool("aisb_list_templates", {
    description: "List the supported System Builder templates in one authorized workspace.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId }), annotations,
  }, (input, context) => invoke({ version, operation: "templates.list", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
  } }, context.mcpReq.signal));
  if (!managed) server.registerTool("aisb_saved_system_snapshot", {
    description: "Read saved system references and a replay cursor in one authorized workspace. Does not read or change the UI.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId }), annotations,
  }, (input, context) => invoke({ version, operation: "systems.snapshot", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
  } }, context.mcpReq.signal));
  if (!managed) server.registerTool("aisb_saved_system_changes", {
    description: "Read a bounded page of committed system changes. Use a fresh snapshot when the host says resync.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId, cursor: z.strictObject({
      hostIncarnationId, scopeTag: z.string().length(64).regex(/^[a-f0-9]{64}$/), sequence: z.number().int().nonnegative(),
    }) }), annotations,
  }, (input, context) => {
    const cursor = headless.parseHeadlessChangeCursor(input.cursor);
    if (!cursor) return invalidAuthoring();
    return invoke({ version, operation: "systems.changes", input: {
      hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId, cursor,
    } }, context.mcpReq.signal);
  });
  if (!managed) server.registerTool("aisb_list_workflows", {
    description: "Read the supported workflow metadata in the exact workspace; starts no work.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId, sourceKind: z.enum(headless.HEADLESS_WORKFLOW_SOURCE_KINDS) }), annotations,
  }, (input, context) => invoke({ version, operation: "workflows.list", input: {
    ...input, hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
  } }, context.mcpReq.signal));
  if (!managed) server.registerTool("aisb_prepare_workflow", {
    description: "Read exact source readiness, snapshot revision and approved read-field metadata. Does not invoke any action.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId, profileId: workflowId, source: workflowSource }), annotations,
  }, (input, context) => invoke({ version, operation: "workflows.prepare", input: {
    ...input, hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
  } }, context.mcpReq.signal));
  if (!managed) server.registerTool("aisb_read_conversation_task", {
    description: "Read the saved status of one exact conversation turn and its run; never starts or cancels it.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId, sessionId: workflowId, turnId: workflowId }), annotations,
  }, (input, context) => invoke({ version, operation: "conversation-tasks.read", input: {
    ...input, hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
  } }, context.mcpReq.signal));
  if (enableAuthoring || enablePlanReview) addSystemBuilderTools(server);
  if (enablePresentation) addPresentationTools(server);
  if (!managed && enableConversation) server.registerTool("aisb_send_approved_turn", {
    description: "Send one message to an already approved conversation at its exact saved revisions. An uncertain reply never authorizes a new key; reconcile before retrying the same request.",
    inputSchema: z.strictObject({
      hostIncarnationId, workspaceId, planId: workflowId, planRevision: workflowId, sessionId: workflowId,
      snapshotRevision: workflowId, key: z.string().refine(headless.isHeadlessHostIncarnationId, "Invalid retry key"),
      text: z.string().min(1).max(2_000),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, (input, context) => {
    const decoded = headless.parseHeadlessApprovedTurnRequest({ version, operation: headless.HEADLESS_APPROVED_TURN_OPERATION, input });
    return decoded.ok ? invoke(decoded.request, context.mcpReq.signal) : invalidAuthoring();
  });
  return server;
}, {
  transport: boundHeadlessMcpStdio(process.stdin, process.stdout, () => {
    process.exitCode = 1;
    process.stdin.destroy();
    process.stdout.destroy();
  }),
  maxSubscriptions: 1,
  // Keep SDK diagnostics out of protocol/stdout and do not print untrusted errors.
  onerror: () => {},
});
