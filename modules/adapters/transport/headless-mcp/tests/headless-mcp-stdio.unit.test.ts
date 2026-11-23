import assert from "node:assert/strict";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, request } from "node:https";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import selfsigned from "selfsigned";
import { createInMemoryStructuredDocumentStore } from "../../../persistence/shared";
import { createStructuredHeadlessPlanReviewRepository } from "../../../persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { HeadlessBuildPlanReviewUseCase } from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import { createDesktopHeadlessClientAuthority } from "../../../security/headless";
import { createDesktopPinnedLoopbackAgent, startDesktopHeadlessLoopback } from "../../headless-loopback";
import { HEADLESS_CONTRACT_VERSION as version, HEADLESS_LOCAL_FILE_PREVIEW_PATH, HEADLESS_PLAN_REVIEW_PATH, HEADLESS_PLAN_STEP_PATH, HEADLESS_READ_OPERATIONS,
  UI_PRESENTATION_ACTIONS, isHeadlessHostIncarnationId, parseHeadlessReadRequest, readHeadlessPlanReviewAgentRequest,
  readHeadlessPlanReviewAgentResult, type HeadlessChangeCursor } from "../../../../contracts/headless";
import type {HeadlessDatasetVersionSummary, HeadlessDatasetPreparationRequest, HeadlessContextQueryPreviewRequest, HeadlessModelMetadataRequest, HeadlessModelSourcePreviewRequest} from "../../../../contracts/headless";
import {normalizeDatasetVersionId} from "../../../../contracts/dataset";
import {readModelDownloadSource} from "../../../../contracts/model";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId } from "../../../../contracts/ingestion";
import { normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId } from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { boundHeadlessMcpStdio } from "../boundHeadlessMcpStdio.mjs";

const workspaceId = createWorkspaceId("mcp-fixture-workspace");
const systemId = normalizeSystemBuilderSystemId("mcp-fixture-system");
const organizationId = createOrganizationId("mcp-fixture-org");
const hostIncarnationId = "d5ed1db7-f069-4c48-bbc4-815697889c5d";
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
const expectedTools = ["aisb_host_describe", "aisb_list_systems", "aisb_list_templates", "aisb_list_workflows", "aisb_list_workspaces",
  "aisb_prepare_workflow", "aisb_read_conversation_task", "aisb_read_system", "aisb_saved_system_changes", "aisb_saved_system_snapshot"];
const authoringTools = ["aisb_apply_edits", "aisb_clone_system", "aisb_create_system", "aisb_plan_capabilities",
  "aisb_preview_build_plan", "aisb_preview_edits", "aisb_rename_system"];
const planReviewTools = ["aisb_model_workflow", "aisb_model_metadata", "aisb_context_models", "aisb_preview_context_generation", "aisb_preview_context_rebuild", "aisb_preview_context_query", "aisb_context_task", "aisb_read_context", "aisb_build_plan_approval_status", "aisb_plan_capabilities", "aisb_preview_build_plan",
  "aisb_request_build_plan_approval", "aisb_run_approved_build_step", "aisb_ingestion_status", "aisb_dataset_versions", "aisb_compare_dataset_versions", "aisb_preview_dataset_preparation", "aisb_dataset_task_status", "aisb_dataset_task_review"];
const desktopDataPreviewTool = "aisb_preview_selected_local_file";
const desktopProviderPreviewTool = "aisb_preview_selected_provider_file";
const dataStatusTool = "aisb_ingestion_status";
const presentationTools = ["aisb_list_windows", "aisb_present_in_window", "aisb_release_window", "aisb_renew_window",
  "aisb_request_window", "aisb_window_context", "aisb_window_status"];
const entrypoint = path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts");
const datasetSummary: HeadlessDatasetVersionSummary = {versionId: normalizeDatasetVersionId("version.001"),
  versionDigest: `sha256:${"a".repeat(64)}`, createdAt: "2026-11-17T00:00:00.000Z", totalRows: 10, sourceCount: 1,
  artifactCount: 4, parentVersionId: null, splitSeed: 42, recipeDigest: `sha256:${"b".repeat(64)}`,
  quality: {policyFingerprint: `sha256:${"c".repeat(64)}`, reportFingerprint: `sha256:${"d".repeat(64)}`},
  splits: [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]};
function preparationPreview(input: HeadlessDatasetPreparationRequest["input"]) {
  return {workspaceId: input.workspaceId, sources: input.sources.map((source, index) => ({...source,
    sourceSnapshotId: "snapshot.preview." + index, format: "csv", sizeBytes: 32,
    digest: "sha256:" + "a".repeat(64), licenseStatus: "unknown"})),
    recipe: input.recipe, split: input.split, qualityPreset: input.qualityPreset, totalBytes: input.sources.length * 32,
    maximumRowsPerSource: 1000, outputFormat: "jsonl", reviewRequired: true, externalProviderCalls: 0, modelCalls: 0};
}

function contextPreview(input: {workspaceId: unknown; name: unknown; sources: readonly unknown[]; settings: unknown}) {
  return {workspaceId: input.workspaceId, name: input.name, sources: input.sources.map(reference => ({reference,
    digest: "sha256:" + "a".repeat(64), sizeBytes: 32, format: "csv", licenseStatus: "unknown"})),
    settings: input.settings, totalBytes: input.sources.length * 32, runtimeReadiness: "not-checked",
    approvalRequired: true, reviewRequired: true, modelCalls: 0, externalProviderCalls: 0};
}
const contextSettings = {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500,
  overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]};
const modelSummary = {modelRecordId: "model.synthetic", updatedAt: "2026-11-19T00:00:00.000Z", source: "local",
  lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface", taskTags: ["text-generation"]};
const modelInventory = {workspaceId, models: [modelSummary], runtimeReadiness: "not-checked", supplyVerification: "not-checked"};
const modelRecord = {workspaceId, model: modelSummary, runtimeReadiness: "not-checked", supplyVerification: "not-checked"};
const modelTaskValue = {workspaceId, taskId: "00000000-0000-4000-8000-000000000071", state: "running", percent: 27.5,
  plan: {fingerprint: "a".repeat(64), step: 1},
  registration: "requires-separate-approval", runtimeReadiness: "not-checked"};
function modelSourcePreview() {
  const source = readModelDownloadSource({provider: "huggingface", modelId: "Qwen/synthetic-model", revision: "a".repeat(40),
    format: "transformers-safetensors", license: {kind: "unknown"},
    files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({path, sizeBytes: 10,
      integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1", digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})),
    totalBytes: 30, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
  {provider: "huggingface", modelId: "Qwen/synthetic-model"});
  return {workspaceId, source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex"), downloadApprovalRequired: true};
}
function modelTrainingProgressValue() {
  return {workspaceId, taskId: modelTaskValue.taskId, plan: {...modelTaskValue.plan}, state: "running", percent: 50,
    progress: {epoch: 1, totalEpochs: 2, batch: 2, totalBatches: 4}, resultReview: "not-ready",
    registration: "requires-separate-approval", runtimeReadiness: "not-checked", outputQuality: "not-evaluated"} as const;
}
function modelCompletionReviewValue() {
  const {source, manifestDigest} = modelSourcePreview();
  return {workspaceId, taskId: modelTaskValue.taskId, plan: {...modelTaskValue.plan}, modelId: source.modelId,
    revision: source.revision, manifestDigest, format: source.format, license: source.license,
    selectedFileCount: source.files.length, totalBytes: source.totalBytes, fromCache: false,
    selectedFilesVerification: "verified-at-completion", registration: "requires-separate-approval", runtimeReadiness: "not-checked"};
}
const ragSettings = {kind: "rag-database", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"],
  modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-18T00:00:00.000Z", batchSize: 4, device: "cpu",
  sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false,
    requireConsentMetadata: false, includeSourceAttribution: true}};
const contextTaskValue = {taskId: hostIncarnationId, state: "review-required", review: {kind: "markdown-context-pack",
  reportFingerprint: "a".repeat(64), sourceCount: 1, chunkCount: 2, sizeBytes: 1000, requiresExplicitSave: true}};
const contextSavedValue = {reference: {workspaceId, contextId: hostIncarnationId, taskId: hostIncarnationId,
  kind: "markdown-context-pack", artifactDigest: "sha256:" + "a".repeat(64)}, name: "Synthetic context", sizeBytes: 1000,
  sourceCount: 1, chunkCount: 2, byteAvailability: "not-checked"};
const contextRebuildValue = {reference: contextSavedValue.reference,
  preview: contextPreview({workspaceId, name: "Synthetic context", sources: [
    {kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 1}], settings: contextSettings}),
  byteAvailability: "not-checked"};
function contextQueryPreview(input: HeadlessContextQueryPreviewRequest["input"]) {
  return {reference: input.reference, queryDigest: "sha256:" + createHash("sha256").update(input.query, "utf8").digest("hex"),
    maximumResults: input.maximumResults, embeddingDevice: input.embeddingDevice,
    modelRecordId: "model.synthetic", modelUpdatedAt: ragSettings.modelUpdatedAt, sourceCount: 1,
    maximumQueryCharacters: 2000, byteAvailability: "not-checked", runtimeReadiness: "not-checked", approvalRequired: true, output: "citation-summary"};
}
// This fixture opens several real CLI processes with empty tsx caches and
// waits once for the managed request deadline. Bound the whole fixture separately.
test("managed stdio binds one verified TLS origin and exact organization and workspace", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "managed-mcp-"));
  const certificate = await selfsigned.generate([{name: "commonName", value: "127.0.0.1"}], {
    keySize: 2048, extensions: [{name: "subjectAltName", altNames: [{type: 7, ip: "127.0.0.1"}]}],
  });
  const ca = path.join(directory, "synthetic-ca.pem");
  await writeFile(ca, certificate.cert, {flag: "wx"});
  const requests: {url?: string; workspace?: string; organization?: string; authHeader: boolean}[] = [];
  let redirect = false;
  let displacedDiscovery = false;
  let echoCredential = false;
  let echoPrivateWindowSession = false;
  let wrongCommandReceipt = false;
  let repeatedCommand = false;
  let commandApplied = false;
  let delayedSemanticEffects = 0;
  let sourceArchived = false;
  let displacedCapabilities = false;
  let displacedProviderReply = false;
  let invalidStatusReply = false;
  let cancellationCalls = 0;
  let completionReviewMode = "valid";
  let trainingProgressMode = "valid";
  let trainingReviewMode = "valid";
  let wrongQuestionDigest = false;
  let changedPreparation = false;
  let sourceReady = true;
  const listener = createServer({key: certificate.private, cert: certificate.cert}, (request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {body += chunk.toString();});
    request.on("end", () => {
      const input = JSON.parse(body);
      requests.push({url: request.url, workspace: input.input.workspaceId, organization: String(request.headers["x-organization-id"]),
        authHeader: request.headers.authorization === "Bearer synthetic-managed-bearer"});
      if (redirect) {
        response.writeHead(307, {Location: "/forbidden-destination", "Content-Length": 0}).end();
        return;
      }
      if (input.operation === "systems.apply-edits") {
        delayedSemanticEffects++;
        const payload = JSON.stringify({ok:true, value:{kind:"committed", reference:{systemId, recordRevision:2,
          revisionId:"revision-2"}}});
        const timer = setTimeout(() => {
          response.writeHead(200, {"Content-Type":"application/json; charset=utf-8", "Content-Length":Buffer.byteLength(payload)}).end(payload);
        }, 5_200);
        response.once("close", () => clearTimeout(timer));
        return;
      }
      if (input.operation === "window.request") {
        const session = request.headers["x-aisb-headless-session"];
        const descriptor = {ok:true, value:{kind:"request", request:{
          target:{...input.input.target, requestId:"0df554b7-1843-4e33-933d-8071e2a4e49f", attemptId:"4924715a-f22f-4c50-9b35-883af79407bb"},
          taskId: input.input.taskId, agentSessionId: echoPrivateWindowSession ? session : "693fe179-d578-47ce-9df3-75378ad1d90d",
          status:"pending", expiresAt:50_000,
        }}};
        const payload = JSON.stringify(descriptor);
        response.writeHead(200, {"Content-Type":"application/json; charset=utf-8", "Content-Length":Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "window.present") {
        const payload = JSON.stringify({ok: true, value: {kind: "command", duplicate: repeatedCommand,
          receipt: {sequence: 1, commandId: wrongCommandReceipt ? randomUUID() : input.input.commandId,
            status: commandApplied ? "applied" : "accepted"}}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "plan.capabilities") {
        const payload = JSON.stringify({ok:true, operation:input.operation, value:{
          workspaceId:displacedCapabilities ? "different-workspace" : workspaceId,
          actions:["systems.rename"], approval:"required",
        }});
        response.writeHead(200, {"Content-Type":"application/json; charset=utf-8", "Content-Length":Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "context.preview-query") {
        const payload = JSON.stringify({ok: true, operation: input.operation, value: {...contextQueryPreview(input.input),
          ...(wrongQuestionDigest ? {queryDigest: "sha256:" + "f".repeat(64)} : {}), ...(invalidStatusReply ? {query: input.input.query} : {})}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "context.preview-rebuild") {
        const payload = JSON.stringify({ok: true, operation: input.operation,
          value: {...contextRebuildValue, ...(invalidStatusReply ? {sourceText: "synthetic private source"} : {})}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "context.saved") {
        const payload = JSON.stringify({ok: true, operation: input.operation,
          value: {...contextSavedValue, ...(invalidStatusReply ? {sourceText: "synthetic private source"} : {})}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "context.task") {
        const payload = JSON.stringify({ok: true, operation: input.operation,
          value: {...contextTaskValue, ...(invalidStatusReply ? {sourceText: "synthetic private source"} : {})}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "models.cancel-download") {
        cancellationCalls++;
        const payload = JSON.stringify({ok: true, operation: input.operation, value: {...modelTaskValue, cancellationAccepted: true,
          ...(invalidStatusReply ? {error: "private/model/path"} : {})}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "models.review-download") {
        const payload = JSON.stringify(completionReviewMode === "not-ready" ? {ok: false, code: "headless.source-not-ready"} : {
          ok: true, operation: completionReviewMode === "tag" ? "models.task" : input.operation,
          value: {...modelCompletionReviewValue(), ...(completionReviewMode === "private" ? {localPath: "private/model/path"} : {}),
            ...(completionReviewMode === "workspace" ? {workspaceId: "workspace.foreign"} : {})}});
        response.writeHead(completionReviewMode === "not-ready" ? 409 : 200,
          {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "models.review-training") {
        const value = recordedTrainingHistory(workspaceId, modelTaskValue.taskId, modelTaskValue.plan);
        const payload = JSON.stringify(trainingReviewMode === "not-ready" ? {ok: false, code: "headless.source-not-ready"}
          : trainingReviewMode === "denied" ? {ok: false, code: "headless.forbidden"} : {
          ok: true, operation: trainingReviewMode === "tag" ? "models.task" : input.operation, value: {...value,
            ...(trainingReviewMode === "measured" ? {comparison: recordedTrainingMeasurement()} : {}),
            ...(trainingReviewMode === "task" ? {taskId: randomUUID()} : {}),
            ...(trainingReviewMode === "plan" ? {plan: {...value.plan, step: 2}} : {}),
            ...(trainingReviewMode === "workspace" ? {workspaceId: "workspace.foreign"} : {}),
            ...(trainingReviewMode === "private" ? {logs: ["PRIVATE"]} : {}),
            ...(trainingReviewMode === "quality" ? {verification: {...value.verification, outputQuality: "passed"}} : {})}});
        response.writeHead(trainingReviewMode === "not-ready" ? 409 : trainingReviewMode === "denied" ? 403 : 200,
          {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "models.training-task") {
        const payload = JSON.stringify(trainingProgressMode === "denied" ? {ok: false, code: "headless.forbidden"} : {
          ok: true, operation: trainingProgressMode === "tag" ? "models.task" : input.operation,
          value: {...modelTrainingProgressValue(),
            ...(trainingProgressMode === "task" ? {taskId: randomUUID()} : {}),
            ...(trainingProgressMode === "plan" ? {plan: {fingerprint: "b".repeat(64), step: 1}} : {}),
            ...(trainingProgressMode === "workspace" ? {workspaceId: "workspace.foreign"} : {}),
            ...(trainingProgressMode === "private" ? {logs: ["PRIVATE"]} : {}),
            ...(trainingProgressMode === "quality" ? {outputQuality: "passed"} : {}),
            ...(trainingProgressMode === "percent" ? {percent: 25} : {})}});
        response.writeHead(trainingProgressMode === "denied" ? 403 : 200,
          {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "models.task") {
        const payload = JSON.stringify({ok: true, operation: input.operation, value: {...modelTaskValue,
          ...(invalidStatusReply ? {error: "private/provider/path"} : {})}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "models.preview-source") {
        const payload = JSON.stringify({ok: true, operation: input.operation, value: {...modelSourcePreview(),
          ...(invalidStatusReply ? {manifestDigest: "sha256:" + "f".repeat(64)} : {})}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "models.inventory" || input.operation === "models.record") {
        const value = input.operation === "models.inventory" ? modelInventory : modelRecord;
        const payload = JSON.stringify({ok: true, operation: input.operation, value: {...value,
          ...(invalidStatusReply ? {localPath: "private/model"} : {})}});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "context.models" || input.operation === "context.preview-generation") {
        const value = input.operation === "context.models" ? {workspaceId, models: [], truncated: false, runtimeReadiness: "not-checked"}
          : {...contextPreview(input.input), ...(invalidStatusReply ? {privatePath: "private-source"} : {})};
        const payload = JSON.stringify({ok: true, operation: input.operation, value});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "data.preview-dataset-preparation") {
        const payload = JSON.stringify(sourceReady ? {ok: true, operation: input.operation, value: {
          ...preparationPreview(input.input),
          ...(invalidStatusReply ? {command: {sourceArtifactIds: ["private-source"]}} : {}),
          ...(changedPreparation ? {recipe: {...input.input.recipe, outputColumn: "changed"}} : {}),
        }} : {ok: false, code: "headless.source-not-ready"});
        response.writeHead(sourceReady ? 200 : 409, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "data.ingestion-status") {
        const payload = JSON.stringify({ok: true, operation: input.operation, value: {
          taskId: input.input.taskId, state: "queued", sourceKind: "hugging-face", revision: 3,
          progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 16},
          ...(invalidStatusReply ? {diagnostic: "private-provider-detail"} : {}),
        }});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "data.dataset-versions" || input.operation === "data.compare-dataset-versions") {
        const value = input.operation === "data.dataset-versions"
          ? {workspaceId, datasetId: input.input.datasetId, versions: [datasetSummary],
            ...(invalidStatusReply ? {path: "private"} : {})}
          : {fromVersionId: input.input.fromVersionId, toVersionId: input.input.toVersionId, identical: false, rowDelta: 2,
            sources: {added: 0, removed: 0, changed: 0}, changedArtifactRoles: ["dataset"], recipeChanged: false,
            qualityPolicyChanged: false, documentationChanged: false, ...(invalidStatusReply ? {path: "private"} : {})};
        const payload = JSON.stringify({ok: true, operation: input.operation, value});
        response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
        return;
      }
      if (input.operation === "data.prepare-provider-file") {
        const {hostIncarnationId:_host, ...selected} = input.input;
        const value = {...selected, provider:"huggingface", providerRevision:"b".repeat(40), mediaType:"application/vnd.apache.parquet",
          selectionExpiresAt:Date.now() + 60_000, approvalRequired:true, externalProviderCalls:0,
          ...(displacedProviderReply ? {path:"synthetic/private.parquet"} : {})};
        const payload = JSON.stringify({ok:true, value});
        response.writeHead(200, {"Content-Type":"application/json; charset=utf-8", "Content-Length":Buffer.byteLength(payload)}).end(payload);
        return;
      }
      const value = input.operation === "host.describe"
        ? {ok: true, operation: "host.describe", value: {version, hostIncarnationId,
          workspaces: displacedDiscovery ? [workspaceId, "foreign-workspace"] : [],
          operations: displacedDiscovery ? ["host.describe", "workspaces.list"] : ["host.describe", "templates.list", "systems.read"]}}
        : input.operation === "templates.list"
          ? {ok: true, operation: "templates.list", value: [{templateId: "reference.secured-data-review@1.0.0",
            displayName: echoCredential ? "Synthetic synthetic-managed-bearer" : "Synthetic"}]}
          : input.operation === "systems.read"
            ? {ok:true, operation: "systems.read", value: {systemId, name: "Saved fixture", revision: 1,
              status: sourceArchived ? "archived" : "draft", currentRevisionId: "revision-1"}}
            : {ok: true, value: {kind: "committed", reference: {systemId, recordRevision: 1, revisionId: "revision-1"}}};
      const payload = JSON.stringify(value);
      response.writeHead(200, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload)}).end(payload);
    });
  });
  const clients: Client[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    const env = {AISB_HEADLESS_MODE: "managed", AISB_HEADLESS_MANAGED_ORIGIN: `https://127.0.0.1:${address.port}`,
      AISB_HEADLESS_MANAGED_CREDENTIAL: "synthetic-managed-bearer", AISB_HEADLESS_MANAGED_ORGANIZATION_ID: organizationId,
      AISB_HEADLESS_MANAGED_WORKSPACE_ID: workspaceId, AISB_HEADLESS_ENABLE_AUTHORING: "1",
      AISB_HEADLESS_ENABLE_PRESENTATION: "1", AISB_HEADLESS_ENABLE_CONVERSATION: "1", TSX_DISABLE_CACHE: "1"};
    async function connect(overrides: Record<string, string> = {}) {
      const client = new Client({name: "managed-fixture", version: "1.0.0"});
      clients.push(client);
      await client.connect(new StdioClientTransport({command: process.execPath, args: ["--import", "tsx", entrypoint],
        env: {...env, ...overrides}, stderr: "ignore", maxBufferSize: 256 * 1024}));
      return client;
    }
    const client = await connect({NODE_EXTRA_CA_CERTS: ca});
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(),
      ["aisb_host_describe", "aisb_list_templates", "aisb_read_system", ...authoringTools].sort());
    assert.equal(requests.length, 0);
    const discover = async (connection: Client) => resultText(await connection.callTool({name: "aisb_host_describe", arguments: {}}));
    assert.equal((await discover(client)).ok, true);
    const args = {hostIncarnationId, workspaceId, templateId: "reference.secured-data-review@1.0.0",
      idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", name: "Synthetic"};
    const author = async (input: Record<string, unknown>) => resultText(await client.callTool({name: "aisb_create_system", arguments: input}));
    assert.deepEqual(await author({...args, workspaceId: "foreign-workspace"}), {ok: false, code: "headless.forbidden"});
    assert.equal((await author(args)).ok, true);
    assert.deepEqual(requests, [
      {url: "/api/headless/agent/read", workspace: undefined, organization: organizationId, authHeader: true},
      {url: "/api/headless/agent/author", workspace: workspaceId, organization: organizationId, authHeader: true},
    ]);
    const untrusted = await connect({NODE_TLS_REJECT_UNAUTHORIZED: "0"});
    assert.deepEqual(await discover(untrusted), {ok: false, code: "headless.unavailable"});
    const invalidOrigin = await connect({NODE_EXTRA_CA_CERTS: ca, AISB_HEADLESS_MANAGED_ORIGIN: `${env.AISB_HEADLESS_MANAGED_ORIGIN}/private`});
    assert.deepEqual(await discover(invalidOrigin), {ok: false, code: "headless.unavailable"});
    assert.equal(requests.length, 2);
    displacedDiscovery = true;
    assert.deepEqual(await discover(client), {ok: false, code: "headless.unavailable"});
    displacedDiscovery = false;
    echoCredential = true;
    const echo = resultText(await client.callTool({name: "aisb_list_templates", arguments: {hostIncarnationId, workspaceId}}));
    assert.deepEqual(echo, {ok: false, code: "headless.unavailable"});
    echoCredential = false;
    redirect = true;
    assert.deepEqual(await discover(client), {ok: false, code: "headless.unavailable"});
    assert.equal(requests.length, 5);
    assert.ok(requests.slice(2).every(row => row.url === "/api/headless/agent/read"));
    redirect = false;
    const consentClient = await connect({NODE_EXTRA_CA_CERTS: ca, AISB_HEADLESS_ENABLE_MANAGED_CONSENT: "1"});
    const windowArgs = {target:{hostIncarnationId, workspaceId, windowId:"ec6853b7-7693-4173-ab60-255d29af31ab",
      uiIncarnationId:"20484653-3425-4848-b2c9-52dd6b837069"}, taskId:"4514b5f9-ab96-4eb6-81ea-5f50afcfc575", requestKey:"84df8879-dc37-42b0-a3c5-ca5e17339d47"};
    const ask = async () => resultText(await consentClient.callTool({name:"aisb_request_window", arguments:windowArgs}));
    assert.equal((await ask()).ok, true);
    echoPrivateWindowSession = true;
    assert.deepEqual(await ask(), {ok:false, code:"headless.unavailable"});
    const presentationClient = await connect({NODE_EXTRA_CA_CERTS: ca, AISB_HEADLESS_ENABLE_MANAGED_CONSENT: "1",
      AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION: "1"});
    const delivery = {target: {...windowArgs.target, requestId: randomUUID(), attemptId: randomUUID(), leaseId: randomUUID(),
      generation: 1}, commandId: randomUUID(), intent: {action: "open-system", systemId, revisionId: "revision-1"}};
    const present = async (input: Parameters<Client["callTool"]>[0]["arguments"] = delivery) => resultText(await presentationClient.callTool({
      name: "aisb_present_in_window", arguments: input,
    }));
    const callsBeforeDenied = requests.length;
    assert.deepEqual(await present({...delivery, target: {...delivery.target, workspaceId: createWorkspaceId("different-workspace")}}),
      {ok:false, code:"headless.forbidden"});
    assert.equal(requests.length, callsBeforeDenied);
    assert.deepEqual(await present(), {ok:true, value:{kind:"command", receipt:{
      sequence:1, commandId:delivery.commandId, status:"accepted",
    }, duplicate:false}});
    wrongCommandReceipt = true;
    assert.deepEqual(await present(), {ok:false, code:"headless.unavailable"});
    wrongCommandReceipt = false;
    commandApplied = true;
    assert.deepEqual(await present({...delivery, commandId: randomUUID()}), {ok:false, code:"headless.unavailable"});
    repeatedCommand = true;
    assert.deepEqual(await present(), {ok:true, value:{kind:"command", receipt:{
      sequence:1, commandId:delivery.commandId, status:"applied",
    }, duplicate:true}});
    repeatedCommand = false; commandApplied = false;
    const contextReference = {workspaceId, contextId: randomUUID(), taskId: randomUUID(), kind: "rag-database", artifactDigest: `sha256:${"a".repeat(64)}`};
    for (const intent of [{action: "show-context-artifact", reference: contextReference}, {action: "show-context-task", taskId: contextReference.taskId}, {action: "show-context-query", taskId: contextReference.taskId}]) {
      const commandId = randomUUID();
      assert.deepEqual(await present({...delivery, commandId, intent}), {ok: true, value: {kind: "command",
        receipt: {sequence: 1, commandId, status: "accepted"}, duplicate: false}});
    }
    const beforeMalformedContext = requests.length;
    const malformedContext = await presentationClient.callTool({name: "aisb_present_in_window", arguments: {...delivery,
      intent: {action: "show-context-artifact", reference: {...contextReference, path: "private/context.zip"}}}});
    assert.equal(malformedContext.isError, true); assert.equal(requests.length, beforeMalformedContext);
    for (const intent of [{action: "show-context-query", taskId: "ordinary-task"},
      {action: "show-context-query", taskId: contextReference.taskId, query: "Synthetic private query"}]) {
      const deniedQuery = await presentationClient.callTool({name: "aisb_present_in_window", arguments: {...delivery, intent}});
      assert.equal(deniedQuery.isError, true); assert.equal(requests.length, beforeMalformedContext);
      assert.doesNotMatch(JSON.stringify(deniedQuery), /Synthetic private query/);
    }

    assert.ok(requests.slice(callsBeforeDenied).every(row => row.url === "/api/headless/agent/window"));
    const edit = {hostIncarnationId, workspaceId, systemId, baseRecordRevision:1, baseRevisionId:"revision-1",
      edits:[{kind:"configure", instanceId:"fixture-instance", values:{title:"Synthetic title"}}],
      idempotencyKey:randomUUID(), previewDigest:"f".repeat(64)};
    assert.deepEqual(resultText(await client.callTool({name:"aisb_apply_edits", arguments:edit}, undefined, {timeout:14_000})),
      {ok:true,value:{kind:"committed",reference:{systemId,recordRevision:2,revisionId:"revision-2"}}});
    assert.equal(delayedSemanticEffects,1);
    assert.equal(requests.at(-1)?.url,"/api/headless/agent/author");
    const planBase = {hostIncarnationId, workspaceId};
    const source = {systemId, baseRevisionId: "revision-1", baseRecordRevision: 1};
    const steps = [
      {operation: "systems.create", name: "New proposal", templateId: args.templateId, idempotencyKey: randomUUID()},
      {operation: "systems.clone", name: "Copy proposal", ...source, idempotencyKey: randomUUID()},
      {operation: "systems.rename", name: "Rename proposal", ...source, idempotencyKey: randomUUID()},
    ];
    const preview = async (input: Record<string, unknown>) => resultText(await client.callTool({
      name: "aisb_preview_build_plan", arguments: input,
    }));
    const beforePreview = requests.length;
    const identity = checkedPlan(await preview({...planBase, steps}));
    assert.deepEqual(identity.plan, {
      version: "aisb-build-plan-preview-v1", ...planBase, approval: "required",
      steps: steps.map(({operation, ...input}) => ({operation, input, effect: "saved-system-write", externalProviderCalls: 0})),
    });
    assert.equal(requests.length - beforePreview, 2);
    const shuffledFields = steps.map(step => Object.fromEntries(Object.entries(step).reverse()));
    assert.equal(checkedPlan(await preview({...planBase, steps:shuffledFields})).fingerprint, identity.fingerprint);
    assert.notEqual(checkedPlan(await preview({...planBase, steps:[steps[1], steps[0], steps[2]]})).fingerprint, identity.fingerprint);
    assert.notEqual(checkedPlan(await preview({...planBase, steps:[{...steps[0], name:"Changed proposal"}, ...steps.slice(1)]})).fingerprint,
      identity.fingerprint);
    assert.ok(requests.slice(beforePreview).every(row => row.url === "/api/headless/agent/read" && row.workspace === workspaceId));
    const beforeDenied = requests.length;
    assert.deepEqual(await preview({...planBase, workspaceId: "foreign-workspace", steps}), {ok:false, code:"headless.forbidden"});
    assert.deepEqual(await preview({...planBase, steps:[steps[2], steps[1]]}), {ok:false, code:"headless.invalid-request"});
    assert.deepEqual(await preview({...planBase, steps:[steps[0], steps[0]]}), {ok:false, code:"headless.invalid-request"});
    assert.equal(requests.length, beforeDenied);
    assert.deepEqual(await preview({...planBase, steps:[{...steps[2], baseRecordRevision: 2}]}), {ok:false, code:"headless.stale"});
    assert.deepEqual(await preview({...planBase, steps:[{...steps[0], templateId: "reference.controlled-chatbot@1.0.0"}]}),
      {ok:false, code:"headless.not-found"});
    sourceArchived = true;
    assert.deepEqual(await preview({...planBase, steps:[steps[1]]}), {ok:false, code:"headless.not-found"});
    assert.ok(requests.slice(beforeDenied).every(row => row.url === "/api/headless/agent/read"));
    const capabilities = async () => resultText(await client.callTool({name:"aisb_plan_capabilities", arguments:planBase}));
    assert.deepEqual(await capabilities(), {ok:true, operation:"plan.capabilities",
      value:{workspaceId, actions:["systems.rename"], approval:"required"}});
    displacedCapabilities = true;
    assert.deepEqual(await capabilities(), {ok:false, code:"headless.unavailable"});
    const planner = await connect({NODE_EXTRA_CA_CERTS:ca,AISB_HEADLESS_ENABLE_PLAN_REVIEW:"1"});
    assert.ok(!(await planner.listTools()).tools.some(tool => tool.name === "aisb_cancel_model_download"));
    const controller = await connect({NODE_EXTRA_CA_CERTS:ca, AISB_HEADLESS_ENABLE_PLAN_REVIEW:"1", AISB_HEADLESS_ENABLE_MODEL_TASK_CONTROL:"1"});
    const stopTool = (await controller.listTools()).tools.find(tool => tool.name === "aisb_cancel_model_download");
    assert.ok(stopTool); assert.equal(stopTool.annotations?.readOnlyHint, false); assert.equal(stopTool.annotations?.idempotentHint, false);
    for (const selection of [{kind: "task", taskId: modelTaskValue.taskId}, {kind: "plan-step", fingerprint: "a".repeat(64), step: 1}]) {
      assert.deepEqual(resultText(await controller.callTool({name: "aisb_cancel_model_download", arguments: {...planBase, selection}})),
        {ok: true, operation: "models.cancel-download", value: {...modelTaskValue, cancellationAccepted: true}});
      assert.equal(requests.at(-1)?.url, "/api/headless/agent/model-task-control");
    }
    invalidStatusReply = true;
    assert.deepEqual(resultText(await controller.callTool({name: "aisb_cancel_model_download", arguments: {...planBase,
      selection: {kind: "task", taskId: modelTaskValue.taskId}}})), {ok: false, code: "headless.operation-unconfirmed"});
    invalidStatusReply = false;
    assert.deepEqual(resultText(await controller.callTool({name: "aisb_cancel_model_download", arguments: {...planBase,
      selection: {kind: "plan-step", fingerprint: "b".repeat(64), step: 1}}})), {ok: false, code: "headless.operation-unconfirmed"});
    assert.equal(cancellationCalls, 4, "Unknown replies never trigger a second HTTP request.");
    for (const task of [{kind: "task", taskId: modelTaskValue.taskId}, {kind: "plan-step", fingerprint: "a".repeat(64), step: 1}]) {
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
        selection: {kind: "completed-download", task}}})), {ok: true, operation: "models.review-download", value: modelCompletionReviewValue()});
      assert.equal(requests.at(-1)?.url, "/api/headless/agent/read");
    }
    for (const mode of ["tag", "private", "workspace"]) {
      completionReviewMode = mode;
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
        selection: {kind: "completed-download", task: {kind: "task", taskId: modelTaskValue.taskId}}}})), {ok: false, code: "headless.unavailable"});
    }
    completionReviewMode = "not-ready";
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
      selection: {kind: "completed-download", task: {kind: "task", taskId: modelTaskValue.taskId}}}})), {ok: false, code: "headless.source-not-ready"});
    completionReviewMode = "valid";
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
      selection: {kind: "completed-download", task: {kind: "task", taskId: randomUUID()}}}})), {ok: false, code: "headless.unavailable"});
    for (const task of [{kind: "task", taskId: modelTaskValue.taskId},
      {kind: "plan-step", fingerprint: modelTaskValue.plan.fingerprint, step: modelTaskValue.plan.step}]) {
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
        selection: {kind: "training-task", task}}})), {ok: true, operation: "models.training-task", value: modelTrainingProgressValue()});
      assert.equal(requests.at(-1)?.url, "/api/headless/agent/read");
    }
    for (const mode of ["tag", "task", "plan", "workspace", "private", "quality", "percent"]) {
      trainingProgressMode = mode;
      const task = mode === "plan" ? {kind: "plan-step", ...modelTaskValue.plan} : {kind: "task", taskId: modelTaskValue.taskId};
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
        selection: {kind: "training-task", task}}})), {ok: false, code: "headless.unavailable"}, mode);
    }
    trainingProgressMode = "denied";
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
      selection: {kind: "training-task", task: {kind: "task", taskId: modelTaskValue.taskId}}}})), {ok: false, code: "headless.forbidden"});
    trainingProgressMode = "valid";
    const beforeBadTraining = requests.length;
    assert.equal((await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
      selection: {kind: "training-task", task: {kind: "task", taskId: modelTaskValue.taskId, path: "PRIVATE"}}}})).isError, true);
    assert.equal(requests.length, beforeBadTraining);
    for (const task of [{kind: "task", taskId: modelTaskValue.taskId}, {kind: "plan-step", ...modelTaskValue.plan}]) {
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
        selection: {kind: "completed-training", task}}})), {ok: true, operation: "models.review-training",
          value: recordedTrainingHistory(workspaceId, modelTaskValue.taskId, modelTaskValue.plan)});
      assert.equal(requests.at(-1)?.url, "/api/headless/agent/read");
    }
    trainingReviewMode = "measured";
    const measuredTraining = resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
      selection: {kind: "completed-training", task: {kind: "task", taskId: modelTaskValue.taskId}}}}));
    assert.deepEqual(measuredTraining, {ok: true, operation: "models.review-training", value: {
      ...recordedTrainingHistory(workspaceId, modelTaskValue.taskId, modelTaskValue.plan), comparison: recordedTrainingMeasurement()}});
    trainingReviewMode = "valid";
    for (const mode of ["tag", "task", "plan", "workspace", "private", "quality"]) {
      trainingReviewMode = mode;
      const task = mode === "plan" ? {kind: "plan-step", ...modelTaskValue.plan} : {kind: "task", taskId: modelTaskValue.taskId};
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
        selection: {kind: "completed-training", task}}})), {ok: false, code: "headless.unavailable"}, mode);
    }
    for (const [mode, code] of [["not-ready", "headless.source-not-ready"], ["denied", "headless.forbidden"]]) {
      trainingReviewMode = mode;
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
        selection: {kind: "completed-training", task: {kind: "task", taskId: modelTaskValue.taskId}}}})), {ok: false, code});
    }
    trainingReviewMode = "valid";
    const beforeBadCompletion = requests.length;
    assert.equal((await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
      selection: {kind: "completed-training", task: {kind: "task", taskId: modelTaskValue.taskId, path: "PRIVATE"}}}})).isError, true);
    assert.equal(requests.length, beforeBadCompletion);
    const beforeBadReview = requests.length;
    for (const task of [{kind: "task", taskId: modelTaskValue.taskId, path: "private"},
      {kind: "plan-step", fingerprint: "a".repeat(64), step: 0}])
      assert.equal((await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
        selection: {kind: "completed-download", task}}})).isError, true);
    assert.equal(requests.length, beforeBadReview);
    const beforeBadControl = requests.length;
    for (const selection of [{kind: "task", taskId: modelTaskValue.taskId, command: "private"},
      {kind: "plan-step", fingerprint: "a".repeat(64), step: 0}])
      assert.equal((await controller.callTool({name: "aisb_cancel_model_download", arguments: {...planBase, selection}})).isError, true);
    assert.equal(requests.length, beforeBadControl);
    for (const [selection, expected] of [[{kind: "inventory", limit: 1}, {ok: true, operation: "models.inventory", value: modelInventory}],
      [{kind: "record", modelRecordId: "model.synthetic"}, {ok: true, operation: "models.record", value: modelRecord}]] as const) {
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_metadata", arguments: {...planBase, selection}})), expected);
      invalidStatusReply = true;
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_metadata", arguments: {...planBase, selection}})), {ok: false, code: "headless.unavailable"});
      invalidStatusReply = false;
    }
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_metadata", arguments: {...planBase,
      selection: {kind: "record", modelRecordId: "model.other"}}})), {ok: false, code: "headless.unavailable"});
    const sourceSelection = {kind: "source", modelId: "Qwen/synthetic-model", revision: "a".repeat(40)};
    const sourceTool = (await planner.listTools()).tools.find(tool => tool.name === "aisb_model_workflow");
    assert.equal(sourceTool?.annotations?.readOnlyHint, true);
    assert.equal(sourceTool?.annotations?.openWorldHint, true);
    assert.equal(sourceTool?.annotations?.destructiveHint, false);
    for (const selection of [{kind: "task", taskId: modelTaskValue.taskId},
      {kind: "plan-step", fingerprint: "a".repeat(64), step: 1}]) {
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase, selection}})),
        {ok: true, operation: "models.task", value: modelTaskValue});
      invalidStatusReply = true;
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase, selection}})),
        {ok: false, code: "headless.unavailable"});
      invalidStatusReply = false;
    }
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase,
      selection: {kind: "task", taskId: "00000000-0000-4000-8000-000000000072"}}})), {ok: false, code: "headless.unavailable"});
    for (const selection of [{kind: "plan-step", fingerprint: "b".repeat(64), step: 1},
      {kind: "plan-step", fingerprint: "a".repeat(64), step: 2}])
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase, selection}})),
        {ok: false, code: "headless.unavailable"});
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase, selection: sourceSelection}})),
      {ok: true, operation: "models.preview-source", value: modelSourcePreview()});
    invalidStatusReply = true;
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase, selection: sourceSelection}})),
      {ok: false, code: "headless.unavailable"});
    invalidStatusReply = false;
    for (const selection of [{...sourceSelection, modelId: "Qwen/other"}, {...sourceSelection, revision: "b".repeat(40)}])
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase, selection}})),
        {ok: false, code: "headless.unavailable"});
    const beforeInvalidModel = requests.length;
    for (const selection of [{kind: "inventory", limit: 33}, {kind: "record", modelRecordId: "../private"},
      {kind: "record", modelRecordId: "model.synthetic", localPath: "private/model"}, {kind: "download", modelId: "example/model"}])
      assert.equal((await planner.callTool({name: "aisb_model_metadata", arguments: {...planBase, selection}})).isError, true);
    assert.equal(requests.length, beforeInvalidModel);
    for (const selection of [{...sourceSelection, kind: "download"}, {...sourceSelection, revision: "main"}, {...sourceSelection, localPath: "private/model"},
      {kind: "task", taskId: modelTaskValue.taskId, cancel: true}, {kind: "plan-step", fingerprint: "a".repeat(64), step: 0}])
      assert.equal((await planner.callTool({name: "aisb_model_workflow", arguments: {...planBase, selection}})).isError, true);
    assert.equal(requests.length, beforeInvalidModel);
    const preparation = {...planBase, sources: [{taskId: "task.preview", fileId: "file.preview", taskRevision: 3}],
      recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
      split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"};
    const contextInput = {...planBase, name: "Synthetic context", sources: preparation.sources.map(source => ({kind: "ingestion-file", ...source})), settings: contextSettings};
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_context_models", arguments: planBase})),
      {ok: true, operation: "context.models", value: {workspaceId, models: [], truncated: false, runtimeReadiness: "not-checked"}});
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_preview_context_generation", arguments: contextInput})),
      {ok: true, operation: "context.preview-generation", value: contextPreview(contextInput)});
    const ragPlan = checkedPlan(resultText(await planner.callTool({name: "aisb_preview_build_plan", arguments: {...planBase,
      steps: [{operation: "context.generate-rag", idempotencyKey: randomUUID(), name: contextInput.name,
        sources: contextInput.sources, settings: ragSettings}]}})));
    assert.equal(ragPlan.plan.version, "aisb-build-plan-preview-v7");
    assert.equal(ragPlan.plan.steps[0].modelCalls, "required");
    assert.equal(ragPlan.plan.steps[0].externalProviderCalls, 0);
    invalidStatusReply = true;
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_preview_context_generation", arguments: contextInput})), {ok: false, code: "headless.unavailable"});
    invalidStatusReply = false;
    const contextTaskQuery = {...planBase, selection: {kind: "task", taskId: hostIncarnationId}};
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_context_task", arguments: contextTaskQuery})),
      {ok: true, operation: "context.task", value: contextTaskValue});
    invalidStatusReply = true;
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_context_task", arguments: contextTaskQuery})),
      {ok: false, code: "headless.unavailable"});
    invalidStatusReply = false;
    const contextSavedQuery = {...planBase, contextId: hostIncarnationId};
    const contextRebuildQuery = {...planBase, reference: contextSavedValue.reference};
    const queryPreviewInput = {...planBase, reference: {...contextSavedValue.reference, kind: "rag-database" as const},
      query: "Synthetic private question café 📄", maximumResults: 5, embeddingDevice: "cpu" as const};
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_preview_context_query", arguments: queryPreviewInput})),
      {ok: true, operation: "context.preview-query", value: contextQueryPreview(queryPreviewInput)});
    for (const failure of ["hash", "private-text"]) {
      wrongQuestionDigest = failure === "hash"; invalidStatusReply = failure === "private-text";
      const denied = resultText(await planner.callTool({name: "aisb_preview_context_query", arguments: queryPreviewInput}));
      assert.deepEqual(denied, {ok: false, code: "headless.unavailable"});
      assert.doesNotMatch(JSON.stringify(denied), /Synthetic private|café/);
    }
    wrongQuestionDigest = false; invalidStatusReply = false;
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_preview_context_rebuild", arguments: contextRebuildQuery})),
      {ok: true, operation: "context.preview-rebuild", value: contextRebuildValue});
    const rebuildStep = {operation: "context.generate-pack", idempotencyKey: randomUUID(), name: "Rebuilt context",
      rebuildOf: contextSavedValue.reference, sources: contextRebuildValue.preview.sources.map(source => source.reference), settings: contextSettings};
    const rebuildPlan = checkedPlan(resultText(await planner.callTool({name: "aisb_preview_build_plan",
      arguments: {...planBase, steps: [rebuildStep]}})));
    assert.equal(rebuildPlan.plan.version, "aisb-build-plan-preview-v9");
    assert.deepEqual(rebuildPlan.plan.steps[0].input.rebuildOf, contextSavedValue.reference);
    for (const changed of [{...rebuildStep, settings: {...contextSettings, chunkCharacters: 600}},
      {...rebuildStep, rebuildOf: {...contextSavedValue.reference, contextId: randomUUID()}}])
      assert.deepEqual(resultText(await planner.callTool({name: "aisb_preview_build_plan",
        arguments: {...planBase, steps: [changed]}})), {ok: false, code: "headless.unavailable"});
    invalidStatusReply = true;
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_preview_build_plan",
      arguments: {...planBase, steps: [rebuildStep]}})), {ok: false, code: "headless.unavailable"});
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_preview_context_rebuild", arguments: contextRebuildQuery})),
      {ok: false, code: "headless.unavailable"});
    invalidStatusReply = false;
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_read_context", arguments: contextSavedQuery})),
      {ok: true, operation: "context.saved", value: contextSavedValue});
    invalidStatusReply = true;
    assert.deepEqual(resultText(await planner.callTool({name: "aisb_read_context", arguments: contextSavedQuery})),
      {ok: false, code: "headless.unavailable"});
    invalidStatusReply = false;
    const savePlan = checkedPlan(resultText(await planner.callTool({name: "aisb_preview_build_plan", arguments: {...planBase,
      steps: [{operation: "context.save-result", idempotencyKey: randomUUID(), taskId: hostIncarnationId,
        reportFingerprint: contextTaskValue.review.reportFingerprint, name: contextInput.name}]}})));
    assert.equal(savePlan.plan.version, "aisb-build-plan-preview-v8");
    assert.equal(savePlan.plan.steps[0].effect, "save-reviewed-context");
    assert.equal(savePlan.plan.steps[0].modelCalls, 0);
    const previewPreparation = async (input = preparation) => resultText(await planner.callTool({name: "aisb_preview_dataset_preparation", arguments: input}));
    assert.deepEqual(await previewPreparation(), {ok: true, operation: "data.preview-dataset-preparation", value: preparationPreview(preparation as never)});
    invalidStatusReply = true;
    assert.deepEqual(await previewPreparation(), {ok: false, code: "headless.unavailable"});
    invalidStatusReply = false; changedPreparation = true;
    assert.deepEqual(await previewPreparation(), {ok: false, code: "headless.unavailable"});
    changedPreparation = false; sourceReady = false;
    assert.deepEqual(await previewPreparation(), {ok: false, code: "headless.source-not-ready"});
    sourceReady = true;
    const beforeBadPreparation = requests.length;
    assert.deepEqual(await previewPreparation({...preparation, sources: [preparation.sources[0], preparation.sources[0]]}),
      {ok: false, code: "headless.invalid-request"});
    assert.equal(requests.length, beforeBadPreparation);
    for (const [name, target] of [["aisb_dataset_versions", {datasetId: "dataset.synthetic", versionIds: ["version.001"]}],
      ["aisb_compare_dataset_versions", {fromVersionId: "version.001", toVersionId: "version.002"}]] as const) {
      const query = {...planBase, ...target};
      const value = resultText(await planner.callTool({name, arguments: query}));
      assert.equal(value.ok, true);
      if (name === "aisb_dataset_versions") assert.deepEqual(value.value.versions, [datasetSummary]);
      invalidStatusReply = true;
      assert.deepEqual(resultText(await planner.callTool({name, arguments: query})), {ok: false, code: "headless.unavailable"});
      invalidStatusReply = false;
      const calls = requests.length;
      assert.deepEqual(resultText(await planner.callTool({name, arguments: {...query, workspaceId: "foreign-workspace"}})),
        {ok: false, code: "headless.forbidden"});
      assert.equal(requests.length, calls);
    }
    const tool = (await planner.listTools()).tools.find(entry => entry.name === desktopProviderPreviewTool);
    assert.ok(tool);
    const selected = {...planBase, taskId:normalizeIngestionTaskId("ingestion.managed-synthetic"),
      fileId:normalizeIngestionTaskFileId("file.managed-synthetic"), taskRevision:3};
    const statusTarget = {hostIncarnationId, workspaceId, taskId: selected.taskId};
    const readStatus = async (input = statusTarget) => resultText(await planner.callTool({name: dataStatusTool, arguments: input}));
    assert.deepEqual(await readStatus(), {ok: true, operation: "data.ingestion-status", value: {
      taskId: selected.taskId, state: "queued", sourceKind: "hugging-face", revision: 3,
      progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 16},
    }});
    invalidStatusReply = true;
    assert.deepEqual(await readStatus(), {ok: false, code: "headless.unavailable"});
    invalidStatusReply = false;
    const statusCalls = requests.length;
    assert.deepEqual(await readStatus({...statusTarget, workspaceId: createWorkspaceId("foreign-workspace")}),
      {ok: false, code: "headless.forbidden"});
    assert.equal(requests.length, statusCalls);
    const readProvider = async (input = selected) =>
      resultText(await planner.callTool({name:desktopProviderPreviewTool, arguments:input}));
    const requested = requests.length;
    assert.deepEqual(await readProvider({...selected,workspaceId:createWorkspaceId("foreign-workspace")}),
      {ok:false,code:"headless.forbidden"});
    assert.equal(requests.length,requested);
    const outcome = await readProvider();
    assert.equal(outcome.ok,true);
    assert.equal(outcome.value.providerRevision,"b".repeat(40));
    assert.equal(outcome.value.approvalRequired,true);
    assert.deepEqual(requests.at(-1),{url:"/api/headless/agent/data/provider-file-preview",workspace:workspaceId,
      organization:organizationId,authHeader:true});
    displacedProviderReply = true;
    assert.deepEqual(await readProvider(),{ok:false,code:"headless.unavailable"});
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await rm(directory, {recursive: true, force: true});
  }
});

test("the plan-review stdio mode can run an exact approved step after the app records approval", { timeout: 25_000 }, async () => {
  const identity = { organizationId, principalId: "mcp-plan-fixture-user" };
  const platform = createInMemoryStructuredDocumentStore();
  const registry = createDesktopHeadlessClientAuthority({
    documents: platform.forOrganization(organizationId), identity,
    canReadWorkspace: async target => target === workspaceId,
    canReviewPlans: async target => target === workspaceId,
    allowNewModelSourcePairings: true,
  });
  const store = createStructuredHeadlessPlanReviewRepository(platform, async (_owner, target) =>
    target.scope.organizationId === organizationId && target.scope.principalId === identity.principalId &&
    target.scope.workspaceId === workspaceId, Date.now, async () => true, true, true, true, true, true, false, undefined, false, true);
  let effectCount = 0;
  let fileEffectCount = 0;
  let providerEffectCount = 0;
  let datasetEffectCount = 0;
  let datasetSaveCount = 0;
  let contextDenials = 0, queryEffects = 0;
  const transientQuestion = "Synthetic bounded query café 📄";
  const datasetTaskId = randomUUID();
  let requestCount = 0;
  let sourceReads = 0;
  let providerReads = 0;
  let wrongPreview = false;
  let discloseProviderPath = false;
  let statusExtra = false;
  let wrongStatusTask = false;
  let staleDatasetSource = false;
  const sourceTarget = { hostIncarnationId, workspaceId, taskId: normalizeIngestionTaskId("ingestion.fixture"),
    fileId: normalizeIngestionTaskFileId("file.fixture"), taskRevision: 4 };
  const sourceValue = { workspaceId, taskId: sourceTarget.taskId, fileId: sourceTarget.fileId, taskRevision: 4,
    mediaType: "text/csv", fileBytes: 16, checkpointExpiresAt: Date.now() + 60_000,
    effect: "save-local-source" as const, externalProviderCalls: 0 as const };
  const providerValue = { workspaceId, taskId: sourceTarget.taskId, fileId: sourceTarget.fileId, taskRevision: 4,
    provider: "huggingface" as const, providerRevision: "b".repeat(40), mediaType: "application/vnd.apache.parquet" as const,
    selectionExpiresAt: Date.now() + 60_000, approvalRequired: true as const, externalProviderCalls: 0 as const };
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read(raw, getGrant) {
      const grant = await getGrant();
      const decoded = parseHeadlessReadRequest(raw, hostIncarnationId);
      if (!grant?.planReview || !decoded.ok || !("workspaceId" in decoded.request.input) ||
          decoded.request.input.workspaceId !== workspaceId) return { ok: false, code: "headless.forbidden" };
      if (decoded.request.operation === "templates.list")
        return { ok: true, operation: "templates.list", value: [{ templateId: "reference.secured-data-review@1.0.0", displayName: "Fixture template" }] };
      if (decoded.request.operation === "plan.capabilities")
        return { ok: true, operation: "plan.capabilities", value: { workspaceId, actions: ["systems.create"], approval: "required" } };
      if (decoded.request.operation === "data.ingestion-status")
        return {ok: true, operation: "data.ingestion-status", value: {
          taskId: wrongStatusTask ? normalizeIngestionTaskId("wrong-task") : sourceTarget.taskId,
          state: "queued", sourceKind: "hugging-face", revision: 4,
          progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 16},
          ...(statusExtra ? {path: "private-synthetic.parquet"} : {}),
        }};
      if (decoded.request.operation === "data.dataset-task-review") return datasetEffectCount ? {ok: true, operation: decoded.request.operation,
        value: {taskId: wrongStatusTask ? randomUUID() : datasetTaskId, state: "review-required", review: {
          taskId: datasetTaskId, reportFingerprint: "c".repeat(64), policyFingerprint: "sha256:" + "d".repeat(64), status: "ready",
          counts: {inputRows: 2, acceptedRows: 2, quarantinedRows: 0}, reasonCounts: {},
          splits: {trainRows: 2, validationRows: 0, testRows: 0}, approvalAllowed: true, saveAvailable: true,
          ...(statusExtra ? {samples: ["Synthetic private data"]} : {}),
        }}} : {ok: false, code: "headless.forbidden"};
      if (decoded.request.operation === "data.dataset-task-status") return datasetEffectCount ? {ok: true, operation: decoded.request.operation,
        value: {taskId: wrongStatusTask ? randomUUID() : datasetTaskId, state: "review-required",
          ...(statusExtra ? {data: "Synthetic private data"} : {})}} : {ok: false, code: "headless.forbidden"};
      if (decoded.request.operation === "data.dataset-versions") return {ok: true, operation: decoded.request.operation,
        value: {workspaceId, datasetId: decoded.request.input.datasetId, versions: [datasetSummary],
          ...(statusExtra ? {path: "private"} : {})}};
      if (decoded.request.operation === "models.preview-source") return {ok: true, operation: decoded.request.operation,
        value: {...modelSourcePreview(), ...(statusExtra ? {manifestDigest: "sha256:" + "f".repeat(64)} : {})}} as never;
      if (decoded.request.operation === "models.inventory" || decoded.request.operation === "models.record") return {ok: true,
        operation: decoded.request.operation, value: {...(decoded.request.operation === "models.inventory" ? modelInventory : modelRecord),
          ...(statusExtra ? {localPath: "private/model"} : {})}} as never;
      if (decoded.request.operation === "context.models") return {ok: true, operation: decoded.request.operation,
        value: {workspaceId, models: [], truncated: false, runtimeReadiness: "not-checked"}};
      if (decoded.request.operation === "context.preview-generation") return {ok: true, operation: decoded.request.operation,
        value: {...contextPreview(decoded.request.input), ...(statusExtra ? {privatePath: "private-source"} : {})} as never};
      if (decoded.request.operation === "context.task") return {ok: true, operation: decoded.request.operation,
        value: {...contextTaskValue, taskId: wrongStatusTask ? randomUUID() : contextTaskValue.taskId,
          ...(statusExtra ? {sourceText: "synthetic private source"} : {})} as never};
      if (decoded.request.operation === "context.preview-query") return {ok: true, operation: decoded.request.operation,
        value: {...contextQueryPreview(decoded.request.input), ...(wrongStatusTask ? {queryDigest: "sha256:" + "f".repeat(64)} : {}),
          ...(statusExtra ? {query: decoded.request.input.query} : {})} as never};
      if (decoded.request.operation === "context.preview-rebuild") return {ok: true, operation: decoded.request.operation,
        value: {...contextRebuildValue, preview: contextPreview({workspaceId, name: contextRebuildValue.preview.name,
          sources: contextRebuildValue.preview.sources.map(source => source.reference),
          settings: decoded.request.input.reference.kind === "rag-database" ? ragSettings : contextSettings}), reference: {...contextRebuildValue.reference,
          kind: decoded.request.input.reference.kind, contextId: wrongStatusTask ? randomUUID() : contextRebuildValue.reference.contextId},
          ...(statusExtra ? {sourceText: "synthetic private source"} : {})} as never};
      if (decoded.request.operation === "context.saved") return {ok: true, operation: decoded.request.operation,
        value: {...contextSavedValue, reference: {...contextSavedValue.reference,
          contextId: wrongStatusTask ? randomUUID() : contextSavedValue.reference.contextId},
          ...(statusExtra ? {sourceText: "synthetic private source"} : {})} as never};
      if (decoded.request.operation === "data.preview-dataset-preparation") return staleDatasetSource
        ? {ok: false, code: "headless.stale"}
        : {ok: true, operation: decoded.request.operation,
          value: {...preparationPreview(decoded.request.input), ...(statusExtra ? {command: {sourceArtifactIds: ["private-source"]}} : {})} as never};
      if (decoded.request.operation === "data.compare-dataset-versions") return {ok: true, operation: decoded.request.operation,
        value: {fromVersionId: decoded.request.input.fromVersionId, toVersionId: decoded.request.input.toVersionId,
          identical: false, rowDelta: 2, sources: {added: 0, removed: 0, changed: 0}, changedArtifactRoles: ["dataset"],
          recipeChanged: false, qualityPolicyChanged: false, documentationChanged: false,
          ...(statusExtra ? {path: "private"} : {})}};
      return { ok: false, code: "headless.unsupported-operation" };
    },
    dataPreview: { hostIncarnationId, async execute(request, grant) {
      assert.deepEqual(request.input, sourceTarget);
      assert.ok(grant.planReview);
      sourceReads++;
      return { result: { ok: true, value: { ...sourceValue, taskRevision: wrongPreview ? 5 : 4 } },
        publishIfCurrent: async publish => grant.isCurrent?.() === true && publish() };
    }, async executeProvider(request, grant) {
      assert.equal(request.operation, "data.prepare-provider-file");
      assert.deepEqual(request.input, sourceTarget);
      assert.ok(grant.planReview);
      providerReads++;
      return { result: { ok: true, value: { ...providerValue, ...(discloseProviderPath ? { path: "synthetic/hidden.parquet" } : {}) } },
        publishIfCurrent: async publish => grant.isCurrent?.() === true && publish() };
    } },
    planReview: { hostIncarnationId, allowLocalFileSave: true, allowProviderFileSave: true, allowLocalDatasetPreparation: true,
      allowDatasetResultSave: true, allowContextPackGeneration: true, allowContextQuery: true, async execute(input, grant) {
      const { fingerprint, workspaceId } = input.target;
      const target = { hostIncarnationId, fingerprint, scope: { workspaceId, organizationId: grant.organizationId,
        principalId: grant.principalId, registeredClientId: grant.registeredClientId } };
      const isCurrent = () => grant.isCurrent?.() === true;
      const saved = input.operation === "plan.submit" ? await store.propose({ target, isCurrent, proposal: {
        ...input.proposal.scope, steps: input.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
      } }) : await store.read({ target, isCurrent });
      if (!saved.ok) return { ok: false, code: saved.code === "invalid" ? "headless.invalid-request" : "headless.forbidden" };
      const { revision, stepCount, status, expiresAt, approvedSteps } = saved.snapshot.state;
      return { ok: true, value: { fingerprint, revision, stepCount, status, expiresAt, approvedSteps } };
    }, async runStep(request, grant) {
      requestCount++;
      const { workspaceId, fingerprint, approvalRevision, step } = request.input;
      const scope = { workspaceId, organizationId: grant.organizationId, principalId: grant.principalId,
        registeredClientId: grant.registeredClientId };
      const isCurrent = () => grant.isCurrent?.() === true;
      const review = await store.read({ target: { hostIncarnationId, fingerprint, scope }, isCurrent });
      if (!review.ok || review.snapshot.state.status !== "approved" || review.snapshot.state.revision !== approvalRevision || step !== 1)
        return { result: { ok: false, code: "headless.forbidden" } };
      if (review.snapshot.preview.steps[0]?.operation === "context.query") {
        const approved = review.snapshot.preview.steps[0];
        if (!queryEffects && (request.transient?.contextQuery !== transientQuestion ||
          approved.input.queryDigest !== "sha256:" + createHash("sha256").update(request.transient!.contextQuery).digest("hex")))
          return {result: {ok: false, code: "headless.forbidden"}};
        const kind = queryEffects ? "replayed" as const : "started" as const;
        if (!queryEffects) queryEffects++;
        return {result: {ok: true, value: {kind, operation: "context.query", fingerprint, approvalRevision, step,
          expiresAt: review.snapshot.state.expiresAt, reference: {workspaceId, taskId: hostIncarnationId}}},
          publishIfCurrent: async publish => isCurrent() && publish()};
      }
      if (review.snapshot.preview.steps[0]?.operation === "context.generate-pack") {
        contextDenials++;
        return {result: {ok: false, code: "headless.not-started"}};
      }
      if (review.snapshot.preview.steps[0]?.operation === "data.save-prepared-dataset") {
        const kind = datasetSaveCount ? "replayed" as const : "committed" as const;
        if (!datasetSaveCount) datasetSaveCount++;
        return {result: {ok: true, value: {kind, operation: "data.save-prepared-dataset", fingerprint, approvalRevision, step,
          expiresAt: review.snapshot.state.expiresAt, reference: {workspaceId, taskId: datasetTaskId,
            datasetId: "reviewed-dataset", versionId: "reviewed-dataset:v1", versionDigest: "sha256:" + "e".repeat(64)}}},
          publishIfCurrent: async publish => isCurrent() && publish()};
      }
      if (review.snapshot.preview.steps[0]?.operation === "data.prepare-local-dataset") {
        const kind = datasetEffectCount ? "replayed" as const : "started" as const;
        if (!datasetEffectCount) datasetEffectCount++;
        return {result: {ok: true, value: {kind, operation: "data.prepare-local-dataset", fingerprint, approvalRevision, step,
          expiresAt: review.snapshot.state.expiresAt, reference: {workspaceId, taskId: datasetTaskId}}},
          publishIfCurrent: async publish => isCurrent() && publish()};
      }
      if (review.snapshot.preview.steps[0]?.operation === "data.save-local-source") {
        const kind = fileEffectCount ? "replayed" as const : "committed" as const;
        if (!fileEffectCount) fileEffectCount++;
        return {
          result: { ok: true, value: { kind, operation: "data.save-local-source", fingerprint, approvalRevision, step,
            expiresAt: review.snapshot.state.expiresAt, reference: { workspaceId, taskId: sourceTarget.taskId,
              fileId: sourceTarget.fileId, taskRevision: sourceTarget.taskRevision + 2 } } },
          publishIfCurrent: async publish => isCurrent() && publish(),
        };
      }
      if (review.snapshot.preview.steps[0]?.operation === "data.save-provider-source") {
        const kind = providerEffectCount ? "replayed" as const : "committed" as const;
        if (!providerEffectCount) providerEffectCount++;
        return { result: { ok: true, value: { kind, operation: "data.save-provider-source", fingerprint, approvalRevision, step,
          expiresAt: review.snapshot.state.expiresAt, reference: { workspaceId, taskId: sourceTarget.taskId,
            fileId: sourceTarget.fileId, taskRevision: sourceTarget.taskRevision + 1 } } },
        publishIfCurrent: async publish => isCurrent() && publish() };
      }
      // Hold the first reply after the fixture records the effect. The peer
      // must never send a second request automatically to recover it.
      const replay = effectCount > 0;
      if (!replay) effectCount++;
      return {
        result: { ok: true, value: { fingerprint, approvalRevision, step, expiresAt: review.snapshot.state.expiresAt,
          kind: replay ? "replayed" : "committed", reference: {
            systemId, revisionId: normalizeSystemBuilderRevisionId("mcp-fixture-system.r1"), recordRevision: 1,
          } } },
        publishIfCurrent: async publish => replay && isCurrent() && publish(),
      };
    } },
  });
  const client = new Client({ name: "headless-plan-review-fixture", version: "1.0.0" });
  try {
    const preparation = await registry.beginPairing(workspaceId, () => true, "plan-review");
    assert.equal(preparation.status, "ready");
    const credential = await pair(connector, preparation.pairingCode);
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", entrypoint],
      env: { AISB_HEADLESS_ENDPOINT: connector.endpoint, AISB_HEADLESS_FINGERPRINT: connector.fingerprint,
        AISB_HEADLESS_CREDENTIAL: credential, AISB_HEADLESS_ENABLE_PLAN_REVIEW: "1", AISB_HEADLESS_ENABLE_AUTHORING: "1",
        AISB_HEADLESS_ENABLE_CONVERSATION: "1", AISB_HEADLESS_ENABLE_PRESENTATION: "1", TSX_DISABLE_CACHE: "1" },
      stderr: "ignore", maxBufferSize: 256 * 1024,
    }));
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(),
      [...expectedTools, ...planReviewTools, desktopDataPreviewTool, desktopProviderPreviewTool].sort());
    const call = async (name: string, args: Record<string, unknown>) => resultText(await client.callTool({ name, arguments: args }));
    const statusTarget = {hostIncarnationId, workspaceId, taskId: sourceTarget.taskId};
    assert.deepEqual(await call(dataStatusTool, statusTarget), {ok: true, operation: "data.ingestion-status", value: {
      taskId: sourceTarget.taskId, state: "queued", sourceKind: "hugging-face", revision: 4,
      progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 16},
    }});
    statusExtra = true;
    assert.deepEqual(await call(dataStatusTool, statusTarget), {ok: false, code: "headless.unavailable"});
    statusExtra = false; wrongStatusTask = true;
    assert.deepEqual(await call(dataStatusTool, statusTarget), {ok: false, code: "headless.unavailable"});
    wrongStatusTask = false;
    const contextSavedQuery = {hostIncarnationId, workspaceId, contextId: hostIncarnationId};
    const contextRebuildQuery = {hostIncarnationId, workspaceId, reference: contextSavedValue.reference};
    const queryPreviewInput = {hostIncarnationId, workspaceId, reference: {...contextSavedValue.reference, kind: "rag-database" as const},
      query: "Synthetic private question café 📄", maximumResults: 5, embeddingDevice: "cpu" as const};
    assert.deepEqual(await call("aisb_preview_context_query", queryPreviewInput),
      {ok: true, operation: "context.preview-query", value: contextQueryPreview(queryPreviewInput)});
    statusExtra = true;
    assert.deepEqual(await call("aisb_preview_context_query", queryPreviewInput), {ok: false, code: "headless.unavailable"});
    statusExtra = false; wrongStatusTask = true;
    assert.deepEqual(await call("aisb_preview_context_query", queryPreviewInput), {ok: false, code: "headless.unavailable"});
    wrongStatusTask = false;
    assert.deepEqual(await call("aisb_preview_context_rebuild", contextRebuildQuery),
      {ok: true, operation: "context.preview-rebuild", value: contextRebuildValue});
    const rebuildStep = {operation: "context.generate-pack", idempotencyKey: randomUUID(), name: "Rebuilt context",
      rebuildOf: contextSavedValue.reference, sources: contextRebuildValue.preview.sources.map(source => source.reference), settings: contextSettings};
    const rebuildPlan = checkedPlan(await call("aisb_preview_build_plan", {hostIncarnationId, workspaceId, steps: [rebuildStep]}));
    assert.equal(rebuildPlan.plan.version, "aisb-build-plan-preview-v9");
    assert.deepEqual(rebuildPlan.plan.steps[0].input.rebuildOf, contextSavedValue.reference);
    for (const changed of [{...rebuildStep, settings: {...contextSettings, chunkCharacters: 600}},
      {...rebuildStep, rebuildOf: {...contextSavedValue.reference, contextId: randomUUID()}}])
      assert.deepEqual(await call("aisb_preview_build_plan", {hostIncarnationId, workspaceId, steps: [changed]}),
        {ok: false, code: "headless.unavailable"});
    statusExtra = true;
    assert.deepEqual(await call("aisb_preview_build_plan", {hostIncarnationId, workspaceId, steps: [rebuildStep]}),
      {ok: false, code: "headless.unavailable"});
    assert.deepEqual(await call("aisb_preview_context_rebuild", contextRebuildQuery), {ok: false, code: "headless.unavailable"});
    statusExtra = false; wrongStatusTask = true;
    assert.deepEqual(await call("aisb_preview_context_rebuild", contextRebuildQuery), {ok: false, code: "headless.unavailable"});
    wrongStatusTask = false;
    assert.deepEqual(await call("aisb_read_context", contextSavedQuery), {ok: true, operation: "context.saved", value: contextSavedValue});
    statusExtra = true;
    assert.deepEqual(await call("aisb_read_context", contextSavedQuery), {ok: false, code: "headless.unavailable"});
    statusExtra = false; wrongStatusTask = true;
    assert.deepEqual(await call("aisb_read_context", contextSavedQuery), {ok: false, code: "headless.unavailable"});
    wrongStatusTask = false;
    const savePlan = checkedPlan(await call("aisb_preview_build_plan", {hostIncarnationId, workspaceId,
      steps: [{operation: "context.save-result", idempotencyKey: randomUUID(), taskId: hostIncarnationId,
        reportFingerprint: contextTaskValue.review.reportFingerprint, name: "Synthetic context"}]}));
    assert.equal(savePlan.plan.version, "aisb-build-plan-preview-v8");
    assert.equal(savePlan.plan.steps[0].effect, "save-reviewed-context");
    assert.equal(savePlan.plan.steps[0].modelCalls, 0);
    const datasetPreparation = {hostIncarnationId, workspaceId,
      sources: [{taskId: "task.preview", fileId: "file.preview", taskRevision: 3}],
      recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
      split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"};
    const contextInput = {hostIncarnationId, workspaceId, name: "Synthetic context", sources: datasetPreparation.sources.map(source => ({kind: "ingestion-file", ...source})), settings: contextSettings};
    assert.deepEqual(await call("aisb_model_metadata", {hostIncarnationId, workspaceId, selection: {kind: "inventory", limit: 1}}),
      {ok: true, operation: "models.inventory", value: modelInventory});
    assert.deepEqual(await call("aisb_model_metadata", {hostIncarnationId, workspaceId, selection: {kind: "record", modelRecordId: "model.synthetic"}}),
      {ok: true, operation: "models.record", value: modelRecord});
    assert.deepEqual(await call("aisb_model_workflow", {hostIncarnationId, workspaceId, selection: {kind: "source", modelId: "Qwen/synthetic-model", revision: "a".repeat(40)}}),
      {ok: true, operation: "models.preview-source", value: modelSourcePreview()});
    statusExtra = true;
    assert.deepEqual(await call("aisb_model_workflow", {hostIncarnationId, workspaceId, selection: {kind: "source", modelId: "Qwen/synthetic-model", revision: "a".repeat(40)}}),
      {ok: false, code: "headless.unavailable"});
    assert.deepEqual(await call("aisb_model_metadata", {hostIncarnationId, workspaceId, selection: {kind: "inventory", limit: 1}}),
      {ok: false, code: "headless.unavailable"});
    statusExtra = false;
    assert.deepEqual(await call("aisb_context_models", {hostIncarnationId, workspaceId}), {ok: true, operation: "context.models",
      value: {workspaceId, models: [], truncated: false, runtimeReadiness: "not-checked"}});
    assert.deepEqual(await call("aisb_preview_context_generation", contextInput), {ok: true, operation: "context.preview-generation", value: contextPreview(contextInput)});
    const ragPlan = checkedPlan(await call("aisb_preview_build_plan", {hostIncarnationId, workspaceId,
      steps: [{operation: "context.generate-rag", idempotencyKey: randomUUID(), name: contextInput.name,
        sources: contextInput.sources, settings: ragSettings}]}));
    assert.equal(ragPlan.plan.version, "aisb-build-plan-preview-v7");
    assert.equal(ragPlan.plan.steps[0].modelCalls, "required");
    assert.equal(ragPlan.plan.steps[0].externalProviderCalls, 0);
    statusExtra = true;
    assert.deepEqual(await call("aisb_preview_context_generation", contextInput), {ok: false, code: "headless.unavailable"});
    statusExtra = false;
    const contextTaskQuery = {hostIncarnationId, workspaceId, selection: {kind: "task", taskId: hostIncarnationId}};
    assert.deepEqual(await call("aisb_context_task", contextTaskQuery), {ok: true, operation: "context.task", value: contextTaskValue});
    statusExtra = true;
    assert.deepEqual(await call("aisb_context_task", contextTaskQuery), {ok: false, code: "headless.unavailable"});
    statusExtra = false; wrongStatusTask = true;
    assert.deepEqual(await call("aisb_context_task", contextTaskQuery), {ok: false, code: "headless.unavailable"});
    wrongStatusTask = false;
    assert.deepEqual(await call("aisb_preview_dataset_preparation", datasetPreparation),
      {ok: true, operation: "data.preview-dataset-preparation", value: preparationPreview(datasetPreparation as never)});
    statusExtra = true;
    assert.deepEqual(await call("aisb_preview_dataset_preparation", datasetPreparation), {ok: false, code: "headless.unavailable"});
    statusExtra = false;
    staleDatasetSource = true;
    assert.deepEqual(await call("aisb_preview_dataset_preparation", datasetPreparation), {ok: false, code: "headless.stale"});
    staleDatasetSource = false;
    for (const [name, target] of [["aisb_dataset_versions", {datasetId: "dataset.synthetic", versionIds: ["version.001"]}],
      ["aisb_compare_dataset_versions", {fromVersionId: "version.001", toVersionId: "version.002"}]] as const) {
      const query = {hostIncarnationId, workspaceId, ...target};
      const value = await call(name, query);
      assert.equal(value.ok, true);
      if (name === "aisb_dataset_versions") assert.deepEqual(value.value.versions, [datasetSummary]);
      statusExtra = true;
      assert.deepEqual(await call(name, query), {ok: false, code: "headless.unavailable"});
      statusExtra = false;
    }
    assert.deepEqual(await call(desktopDataPreviewTool, sourceTarget), { ok: true, value: sourceValue });
    wrongPreview = true;
    assert.deepEqual(await call(desktopDataPreviewTool, sourceTarget), { ok: false, code: "headless.unavailable" });
    assert.equal(sourceReads, 2);
    assert.deepEqual(await call(desktopProviderPreviewTool, sourceTarget), { ok: true, value: providerValue });
    discloseProviderPath = true;
    assert.deepEqual(await call(desktopProviderPreviewTool, sourceTarget), { ok: false, code: "headless.unavailable" });
    assert.deepEqual(await call(desktopProviderPreviewTool, { ...sourceTarget, workspaceId: "foreign-workspace" }),
      { ok: false, code: "headless.forbidden" });
    assert.equal(providerReads, 2);
    assert.equal(effectCount, 0);
    const scope = { hostIncarnationId, workspaceId };
    assert.deepEqual(await call("aisb_plan_capabilities", scope), { ok: true, operation: "plan.capabilities",
      value: { workspaceId, actions: ["systems.create"], approval: "required" } });
    const steps = [{ operation: "systems.create", name: "Synthetic proposal",
      templateId: "reference.secured-data-review@1.0.0", idempotencyKey: randomUUID() }];
    const preview = checkedPlan(await call("aisb_preview_build_plan", { ...scope, steps }));
    const target = { ...scope, fingerprint: preview.fingerprint };
    assert.deepEqual(await call("aisb_request_build_plan_approval", { ...target, fingerprint: "bc".repeat(32), steps }),
      { ok: false, code: "headless.invalid-request" });
    const pending = await call("aisb_request_build_plan_approval", { ...target, steps });
    const parsed = readHeadlessPlanReviewAgentResult(pending, target.fingerprint);
    assert.ok(parsed.ok && parsed.value.status === "pending" && parsed.value.approvedSteps === 0);
    assert.deepEqual(await call("aisb_build_plan_approval_status", target), pending);
    assert.deepEqual(await call("aisb_request_build_plan_approval", { ...target, steps }), pending);
    assert.equal((await platform.forOrganization(organizationId).listDocuments("headless/system-builder/plan-reviews")).length, 1);
    const exact = { ...target, approvalRevision: 2, step: 1 };
    assert.deepEqual(await call("aisb_run_approved_build_step", exact), { ok: false, code: "headless.operation-unconfirmed" });
    assert.equal(effectCount, 0);
    const registered = await registry.verifyCredential(credential);
    assert.ok(registered?.planReview);
    const isCurrent = () => registered.isCurrent?.() === true;
    const approval = await new HeadlessBuildPlanReviewUseCase(store, Date.now).decide({
      fingerprint: target.fingerprint, expectedRevision: 1, decision: { kind: "approve", mode: "whole-plan" },
    }, hostIncarnationId, { workspaceId, organizationId, principalId: identity.principalId,
      registeredClientId: registered.registeredClientId }, {
      organizationId, principalId: identity.principalId, channel: "app-popup", isCurrent, canDecide: async () => isCurrent(),
    });
    assert.ok(approval.ok);
    const requestsBeforeWrite = requestCount;
    assert.deepEqual(await call("aisb_run_approved_build_step", exact), { ok: false, code: "headless.operation-unconfirmed" });
    assert.equal(requestCount, requestsBeforeWrite + 1);
    assert.equal(effectCount, 1);
    assert.deepEqual(await call("aisb_run_approved_build_step", exact), { ok: true, value: {
      kind: "replayed", expiresAt: approval.state.expiresAt, fingerprint: exact.fingerprint,
      approvalRevision: 2, step: 1, reference: { systemId, revisionId: "mcp-fixture-system.r1", recordRevision: 1 },
    } });
    assert.equal(requestCount, requestsBeforeWrite + 2);
    assert.equal(effectCount, 1);
    const localSteps = [{ operation: "data.save-local-source", taskId: sourceTarget.taskId, fileId: sourceTarget.fileId,
      taskRevision: sourceTarget.taskRevision, idempotencyKey: randomUUID() }];
    assert.deepEqual(await call("aisb_preview_build_plan", { ...scope, steps: localSteps }),
      { ok: false, code: "headless.unavailable" });
    wrongPreview = false;
    const local = checkedPlan(await call("aisb_preview_build_plan", { ...scope, steps: localSteps }));
    assert.equal(local.plan.version, "aisb-build-plan-preview-v2");
    assert.equal(fileEffectCount, 0);
    const localTarget = { ...scope, fingerprint: local.fingerprint };
    const localPending = readHeadlessPlanReviewAgentResult(
      await call("aisb_request_build_plan_approval", { ...localTarget, steps: localSteps }), local.fingerprint);
    assert.ok(localPending.ok && localPending.value.status === "pending");
    const exactFile = { ...localTarget, approvalRevision: 2, step: 1 };
    assert.deepEqual(await call("aisb_run_approved_build_step", exactFile), { ok: false, code: "headless.operation-unconfirmed" });
    const fileApproval = await new HeadlessBuildPlanReviewUseCase(store, Date.now).decide({
      fingerprint: local.fingerprint, expectedRevision: 1, decision: { kind: "approve", mode: "each-change", step: 1 },
    }, hostIncarnationId, { workspaceId, organizationId, principalId: identity.principalId,
      registeredClientId: registered.registeredClientId }, {
      organizationId, principalId: identity.principalId, channel: "authenticated-chat", isCurrent, canDecide: async () => isCurrent(),
    });
    assert.ok(fileApproval.ok);
    const fileReceipt = { operation: "data.save-local-source", fingerprint: local.fingerprint, approvalRevision: 2, step: 1,
      expiresAt: fileApproval.state.expiresAt, reference: { workspaceId, taskId: sourceTarget.taskId,
        fileId: sourceTarget.fileId, taskRevision: sourceTarget.taskRevision + 2 } };
    assert.deepEqual(await call("aisb_run_approved_build_step", exactFile), { ok: true, value: { kind: "committed", ...fileReceipt } });
    assert.deepEqual(await call("aisb_run_approved_build_step", exactFile), { ok: true, value: { kind: "replayed", ...fileReceipt } });
    assert.equal(fileEffectCount, 1);
    discloseProviderPath = false;
    const providerSteps = [{ operation: "data.save-provider-source", taskId: sourceTarget.taskId, fileId: sourceTarget.fileId,
      taskRevision: sourceTarget.taskRevision, idempotencyKey: randomUUID() }];
    const provider = checkedPlan(await call("aisb_preview_build_plan", { ...scope, steps: providerSteps }));
    assert.equal(provider.plan.version, "aisb-build-plan-preview-v3");
    assert.equal(providerEffectCount, 0);
    const providerTarget = { ...scope, fingerprint: provider.fingerprint };
    const providerPending = readHeadlessPlanReviewAgentResult(
      await call("aisb_request_build_plan_approval", { ...providerTarget, steps: providerSteps }), provider.fingerprint);
    assert.ok(providerPending.ok && providerPending.value.status === "pending");
    const exactProvider = { ...providerTarget, approvalRevision: 2, step: 1 };
    assert.deepEqual(await call("aisb_run_approved_build_step", exactProvider),
      { ok: false, code: "headless.operation-unconfirmed" });
    const providerApproval = await new HeadlessBuildPlanReviewUseCase(store, Date.now).decide({
      fingerprint: provider.fingerprint, expectedRevision: 1, decision: { kind: "approve", mode: "whole-plan" },
    }, hostIncarnationId, { workspaceId, organizationId, principalId: identity.principalId,
      registeredClientId: registered.registeredClientId }, {
      organizationId, principalId: identity.principalId, channel: "authenticated-chat", isCurrent, canDecide: async () => isCurrent(),
    });
    assert.ok(providerApproval.ok);
    const providerReceipt = { operation: "data.save-provider-source", fingerprint: provider.fingerprint, approvalRevision: 2, step: 1,
      expiresAt: providerApproval.state.expiresAt, reference: { workspaceId, taskId: sourceTarget.taskId,
        fileId: sourceTarget.fileId, taskRevision: sourceTarget.taskRevision + 1 } };
    assert.deepEqual(await call("aisb_run_approved_build_step", exactProvider),
      { ok: true, value: { kind: "committed", ...providerReceipt } });
    assert.deepEqual(await call("aisb_run_approved_build_step", exactProvider),
      { ok: true, value: { kind: "replayed", ...providerReceipt } });
    assert.equal(providerEffectCount, 1);
    const datasetSteps = [{operation: "data.prepare-local-dataset", idempotencyKey: randomUUID(),
      sources: datasetPreparation.sources, recipe: datasetPreparation.recipe, split: datasetPreparation.split,
      qualityPreset: datasetPreparation.qualityPreset}];
    const dataset = checkedPlan(await call("aisb_preview_build_plan", {...scope, steps: datasetSteps}));
    assert.equal(dataset.plan.version, "aisb-build-plan-preview-v4");
    assert.equal((await call("aisb_request_build_plan_approval", {...scope, fingerprint: dataset.fingerprint, steps: datasetSteps})).ok, true);
    const datasetApproval = await new HeadlessBuildPlanReviewUseCase(store, Date.now).decide({fingerprint: dataset.fingerprint, expectedRevision: 1,
      decision: {kind: "approve", mode: "whole-plan"}}, hostIncarnationId,
    {workspaceId, organizationId, principalId: identity.principalId, registeredClientId: registered.registeredClientId},
    {organizationId, principalId: identity.principalId, channel: "app-popup", isCurrent, canDecide: async () => isCurrent()});
    assert.ok(datasetApproval.ok);
    const datasetTarget = {...scope, fingerprint: dataset.fingerprint, approvalRevision: 2, step: 1};
    const started = await call("aisb_run_approved_build_step", datasetTarget);
    assert.ok(started.ok); assert.equal(started.value.kind, "started");
    assert.equal(started.value.operation, "data.prepare-local-dataset");
    assert.equal(started.value.reference.taskId, datasetTaskId);
    assert.deepEqual(await call("aisb_run_approved_build_step", datasetTarget), {ok: true, value: {...started.value, kind: "replayed"}});
    const selection = {kind: "task", taskId: datasetTaskId};
    assert.deepEqual(await call("aisb_dataset_task_status", {...scope, selection}), {ok: true, operation: "data.dataset-task-status",
      value: {taskId: datasetTaskId, state: "review-required"}});
    statusExtra = true;
    assert.deepEqual(await call("aisb_dataset_task_status", {...scope, selection}), {ok: false, code: "headless.unavailable"});
    statusExtra = false; wrongStatusTask = true;
    assert.deepEqual(await call("aisb_dataset_task_status", {...scope, selection}), {ok: false, code: "headless.unavailable"});
    wrongStatusTask = false;
    const reviewed = await call("aisb_dataset_task_review", {...scope, selection});
    assert.equal(reviewed.ok, true); assert.equal(reviewed.value.review.saveAvailable, true);
    assert.equal(reviewed.value.review.counts.acceptedRows, 2); assert.equal("samples" in reviewed.value.review, false);
    statusExtra = true;
    assert.deepEqual(await call("aisb_dataset_task_review", {...scope, selection}), {ok: false, code: "headless.unavailable"});
    statusExtra = false; wrongStatusTask = true;
    assert.deepEqual(await call("aisb_dataset_task_review", {...scope, selection}), {ok: false, code: "headless.unavailable"});
    wrongStatusTask = false;
    const resultSteps = [{operation: "data.save-prepared-dataset", taskId: datasetTaskId, reportFingerprint: "c".repeat(64),
      outputBaseName: "Reviewed answers", idempotencyKey: randomUUID()}];
    const resultPlan = checkedPlan(await call("aisb_preview_build_plan", {...scope, steps: resultSteps}));
    assert.equal(resultPlan.plan.version, "aisb-build-plan-preview-v5");
    assert.equal((await call("aisb_request_build_plan_approval", {...scope, fingerprint: resultPlan.fingerprint, steps: resultSteps})).ok, true);
    const resultTarget = {...scope, fingerprint: resultPlan.fingerprint, approvalRevision: 2, step: 1};
    assert.equal((await call("aisb_run_approved_build_step", resultTarget)).ok, false); assert.equal(datasetSaveCount, 0);
    assert.ok((await new HeadlessBuildPlanReviewUseCase(store, Date.now).decide({fingerprint: resultPlan.fingerprint,
      expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}, hostIncarnationId,
    {workspaceId, organizationId, principalId: identity.principalId, registeredClientId: registered.registeredClientId},
    {organizationId, principalId: identity.principalId, channel: "authenticated-chat", isCurrent, canDecide: async () => isCurrent()})).ok);
    const savedDataset = await call("aisb_run_approved_build_step", resultTarget);
    assert.equal(savedDataset.ok, true); assert.equal(savedDataset.value.operation, "data.save-prepared-dataset");
    assert.equal(savedDataset.value.reference.taskId, datasetTaskId);
    assert.deepEqual(await call("aisb_run_approved_build_step", resultTarget), {ok: true, value: {...savedDataset.value, kind: "replayed"}});
    assert.equal(datasetSaveCount, 1);
    assert.equal(datasetEffectCount, 1);
    const contextSteps = [{operation: "context.generate-pack", idempotencyKey: randomUUID(), name: "Unavailable Context profile",
      sources: [{kind: "ingestion-file", taskId: sourceTarget.taskId, fileId: sourceTarget.fileId, taskRevision: sourceTarget.taskRevision}],
      settings: contextSettings}];
    const contextPlan = checkedPlan(await call("aisb_preview_build_plan", {...scope, steps: contextSteps}));
    assert.equal((await call("aisb_request_build_plan_approval", {...scope, fingerprint: contextPlan.fingerprint, steps: contextSteps})).ok, true);
    assert.ok((await new HeadlessBuildPlanReviewUseCase(store, Date.now).decide({fingerprint: contextPlan.fingerprint,
      expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}, hostIncarnationId,
      {workspaceId, organizationId, principalId: identity.principalId, registeredClientId: registered.registeredClientId},
      {organizationId, principalId: identity.principalId, channel: "app-popup", isCurrent, canDecide: async () => isCurrent()})).ok);
    assert.deepEqual(await call("aisb_run_approved_build_step", {...scope, fingerprint: contextPlan.fingerprint, approvalRevision: 2, step: 1}),
      {ok: false, code: "headless.not-started"});
    assert.equal(contextDenials, 1, "A declared non-start must traverse the actual loopback status and SDK without an automatic retry.");
    const querySteps = [{operation: "context.query", idempotencyKey: randomUUID(), reference: {...contextSavedValue.reference, kind: "rag-database"},
      queryDigest: "sha256:" + createHash("sha256").update(transientQuestion).digest("hex"), modelRecordId: "model.synthetic",
      modelUpdatedAt: ragSettings.modelUpdatedAt, maximumResults: 3, embeddingDevice: "cpu"}];
    const queryPlan = checkedPlan(await call("aisb_preview_build_plan", {...scope, steps: querySteps}));
    assert.equal(queryPlan.plan.version, "aisb-build-plan-preview-v10");
    assert.doesNotMatch(JSON.stringify(queryPlan), /Synthetic bounded query|café/);
    assert.equal((await call("aisb_request_build_plan_approval", {...scope, fingerprint: queryPlan.fingerprint, steps: querySteps})).ok, true);
    assert.ok((await new HeadlessBuildPlanReviewUseCase(store, Date.now).decide({fingerprint: queryPlan.fingerprint,
      expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}, hostIncarnationId,
      {workspaceId, organizationId, principalId: identity.principalId, registeredClientId: registered.registeredClientId},
      {organizationId, principalId: identity.principalId, channel: "app-popup", isCurrent, canDecide: async () => isCurrent()})).ok);
    const queryTarget = {...scope, fingerprint: queryPlan.fingerprint, approvalRevision: 2, step: 1};
    const queryResult = await call("aisb_run_approved_build_step", {...queryTarget, contextQuery: transientQuestion});
    assert.equal(queryResult.ok, true, JSON.stringify(queryResult)); assert.equal(queryResult.value.operation, "context.query");
    assert.deepEqual(await call("aisb_run_approved_build_step", queryTarget), {ok: true, value: {...queryResult.value, kind: "replayed"}});
    assert.equal(queryEffects, 1);
    assert.doesNotMatch(JSON.stringify(await platform.forOrganization(organizationId).listDocuments("headless/system-builder/plan-reviews")),
      /Synthetic bounded query|café|contextQuery/);

  } finally {
    await client.close();
    await connector.close();
  }
});

test("Desktop Model forwarding retains exact dispatched targets across a held TLS response", {timeout: 12_000}, async () => {
  const {createHeadlessMcpReadForwarder} = await import("../createHeadlessMcpReadForwarder.mjs");
  const certificate = await selfsigned.generate([{name: "commonName", value: "127.0.0.1"}], {
    keySize: 2048, extensions: [{name: "subjectAltName", altNames: [{type: 7, ip: "127.0.0.1"}]}],
  });
  let received: (body: unknown, respond: (value: unknown) => void) => void = () => assert.fail("Unexpected request");
  let count = 0;
  const listener = createServer({key: certificate.private, cert: certificate.cert}, (incoming, response) => {
    assert.equal(incoming.url, "/aisb-headless/v1/read");
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.once("end", () => {
      count++;
      received(JSON.parse(Buffer.concat(chunks).toString("utf8")), value => {
        const payload = JSON.stringify(value);
        response.writeHead(200, {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload)}).end(payload);
      });
    });
  });
  try {
    await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
    const address = listener.address(); assert.ok(address && typeof address === "object");
    const pin = new X509Certificate(certificate.cert).fingerprint256.replaceAll(":", "").toLowerCase();
    const forward = createHeadlessMcpReadForwarder("https://127.0.0.1:" + address.port, pin, "A".repeat(43), false, false, false, true);
    assert.ok(forward);
    async function held(request: HeadlessModelMetadataRequest | HeadlessModelSourcePreviewRequest, change: Record<string, unknown>, value: unknown, expected: unknown) {
      let report!: (body: unknown) => void;
      let respond!: (value: unknown) => void;
      const dispatched = new Promise<unknown>(resolve => {report = resolve;});
      received = (body, send) => {respond = send; report(body);};
      const original = structuredClone(request);
      const pending = forward!(request);
      assert.deepEqual(await dispatched, original);
      Object.assign(request.input, change);
      respond({ok: true, operation: original.operation, value});
      assert.deepEqual(await pending, expected);
    }
    const foreign = createWorkspaceId("substituted-model-workspace");
    for (const operation of ["models.inventory", "models.record"] as const) {
      for (const substitute of [false, true]) {
        const request = operation === "models.inventory" ? {version, operation, input: {hostIncarnationId, workspaceId, limit: 1}}
          : {version, operation, input: {hostIncarnationId, workspaceId, modelRecordId: "model.synthetic"}};
        const value = operation === "models.inventory" ? modelInventory : modelRecord;
        const changedValue = substitute ? {...value, workspaceId: foreign,
          ...(operation === "models.record" ? {model: {...modelSummary, modelRecordId: "model.other"}} : {})} : value;
        await held(request, {workspaceId: foreign, ...(operation === "models.inventory" ? {limit: 32, cursor: "model.other"} : {modelRecordId: "model.other"})},
          changedValue, substitute ? {ok: false, code: "headless.unavailable"} : {ok: true, operation, value});
      }
    }
    await held({version, operation: "models.inventory", input: {hostIncarnationId, workspaceId, limit: 1}}, {limit: 2},
      {...modelInventory, models: [modelSummary, {...modelSummary, modelRecordId: "model.other"}]}, {ok: false, code: "headless.unavailable"});
    await held({version, operation: "models.inventory", input: {hostIncarnationId, workspaceId, limit: 1, cursor: "model.first"}},
      {cursor: "model.changed"}, {...modelInventory, nextCursor: "model.first"}, {ok: false, code: "headless.unavailable"});
    for (const substitution of ["none", "target", "digest"]) {
      const value = modelSourcePreview(), altered = structuredClone(value);
      if (substitution === "target") Object.assign(altered.source, {modelId: "Qwen/changed"});
      if (substitution === "digest") altered.manifestDigest = "sha256:" + "f".repeat(64);
      await held({version, operation: "models.preview-source", input: {hostIncarnationId, workspaceId,
        modelId: "Qwen/synthetic-model", revision: "a".repeat(40)}},
      {workspaceId: foreign, modelId: "Qwen/changed", revision: "b".repeat(40)}, altered,
      substitution === "none" ? {ok: true, operation: "models.preview-source", value} : {ok: false, code: "headless.unavailable"});
    }
    assert.equal(count, 9, "One dispatch per case; no hidden retry");
  } finally {
    listener.closeAllConnections();
    await new Promise<void>(resolve => listener.close(() => resolve()));
  }
});

test("the pinned plan forwarder validates status and preserves uncertain writes", { timeout: 12_000 }, async () => {
  const { createHeadlessMcpReadForwarder } = await import("../createHeadlessMcpReadForwarder.mjs");
  const certificate = await selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], {
    keySize: 2048, extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }],
  });
  const fingerprint = "7a".repeat(32);
  const expiresAt = Date.now() + 60_000;
  let reportedSteps = 1;
  const localTarget = { hostIncarnationId, workspaceId, taskId: normalizeIngestionTaskId("ingestion.pinned-fixture"),
    fileId: normalizeIngestionTaskFileId("file.pinned-fixture"), taskRevision: 4 };
  const localValue = { workspaceId, taskId: localTarget.taskId, fileId: localTarget.fileId, taskRevision: 4,
    mediaType: "text/csv", fileBytes: 22, checkpointExpiresAt: expiresAt,
    effect: "save-local-source", externalProviderCalls: 0 };
  const localReplies = [localValue, { ...localValue, fileId: "file.other" },
    { ...localValue, privatePath: "synthetic-private.csv" }];
  let localRequests = 0;
  const stepReplies = [
    {status:503, body:{ok:false, code:"headless.not-started"}},
    {status:503, body:{ok:false, code:"headless.not-started", detail:"private"}},
    {status:400, body:{ok:false, code:"headless.not-started"}},
    {status:503, body:{ok:false, code:"headless.invalid-request"}},
    {status:503, body:{unexpected:true}},
    {status:404, body:{ok:false, code:"headless.invalid-request"}},
    {status:200, body:{ok:false, code:"headless.unavailable"}},
    {status:400, body:{ok:false, code:"headless.invalid-request"}},
    {status:409, body:{ok:false, code:"headless.host-changed"}},
    undefined,
  ];
  let stepRequests = 0;
  const listener = createServer({ key: certificate.private, cert: certificate.cert }, (incoming, response) => {
    incoming.resume();
    incoming.once("end", () => {
      if (incoming.url === HEADLESS_LOCAL_FILE_PREVIEW_PATH) {
        const value = JSON.stringify({ ok: true, value: localReplies[localRequests++] });
        response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(value) });
        response.end(value);
        return;
      }
      if (incoming.url === HEADLESS_PLAN_STEP_PATH) {
        const reply = stepReplies[stepRequests++];
        if (!reply) { incoming.socket.destroy(); return; }
        const value = JSON.stringify(reply.body);
        response.writeHead(reply.status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(value) });
        response.end(value);
        return;
      }
      assert.equal(incoming.url, HEADLESS_PLAN_REVIEW_PATH);
      const value = JSON.stringify({ ok: true, value: {
        fingerprint, revision: 2, stepCount: reportedSteps, status: "approved", expiresAt,
        approvedSteps: reportedSteps, mode: "whole-plan",
      } });
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(value) });
      response.end(value);
    });
  });
  try {
    await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
    const address = listener.address();
    assert.ok(address && typeof address === "object");
    const pin = new X509Certificate(certificate.cert).fingerprint256.replaceAll(":", "").toLowerCase();
    const forward = createHeadlessMcpReadForwarder("https://127.0.0.1:" + address.port, pin, "A".repeat(43), false, false, false, true);
    assert.ok(forward);
    const localRequest = { version, operation: "data.prepare-local-file", input: localTarget } as const;
    assert.deepEqual(await forward(localRequest), { ok: true, value: localValue });
    for (const _ of [1, 2])
      assert.deepEqual(await forward(localRequest), { ok: false, code: "headless.unavailable" });
    assert.equal(localRequests, 3);
    const request = readHeadlessPlanReviewAgentRequest({ version, operation: "plan.submit",
      input: { hostIncarnationId, workspaceId, fingerprint, steps: [{ operation: "systems.create", name: "Fixture proposal",
        templateId: "reference.secured-data-review@1.0.0", idempotencyKey: randomUUID() }] } }, hostIncarnationId);
    assert.ok(request.ok);
    assert.equal((await forward({ version, ...request.request })).ok, true);
    reportedSteps = 2;
    assert.deepEqual(await forward({ version, ...request.request }), { ok: false, code: "headless.unavailable" });
    const exact = {version, operation:"plan.run-step",
      input:{hostIncarnationId, workspaceId, fingerprint, approvalRevision:2, step:1}} as const;
    for (const code of ["headless.not-started", "headless.operation-unconfirmed", "headless.operation-unconfirmed",
      "headless.operation-unconfirmed", "headless.operation-unconfirmed",
      "headless.operation-unconfirmed", "headless.operation-unconfirmed", "headless.invalid-request", "headless.host-changed",
      "headless.operation-unconfirmed"]) {
      assert.deepEqual(await forward(exact), {ok:false, code});
    }
    assert.equal(stepRequests, stepReplies.length);
  } finally {
    await new Promise<void>(resolve => listener.close(() => resolve()));
  }
});

test("the portable reference matches the exact credential-free SDK discovery catalog", { timeout: 45_000 }, async () => {
  const { collectHeadlessMcpToolReference } = await import("../generateHeadlessMcpToolReference.mjs");
  const reference = await collectHeadlessMcpToolReference();
  const saved = await readFile("skills/control-ai-system-builder/references/mcp-tools.json", "utf8");
  assert.equal(JSON.stringify(reference, null, 2) + "\n", saved.replaceAll("\r\n", "\n"));
  const conversation = "aisb_send_approved_turn";
  assert.deepEqual(reference.modes, [
    { mode: "read", tools: expectedTools },
    { mode: "authoring", tools: [...expectedTools, ...authoringTools].sort() },
    { mode: "conversation", tools: [...expectedTools, conversation].sort() },
    { mode: "authoring-and-conversation", tools: [...expectedTools, ...authoringTools, conversation].sort() },
    { mode: "presentation", tools: [...expectedTools, ...presentationTools].sort() },
    { mode: "all", tools: [...expectedTools, ...authoringTools, conversation, ...presentationTools].sort() },
    { mode: "plan-review", tools: [...expectedTools, ...planReviewTools, desktopDataPreviewTool, desktopProviderPreviewTool].sort() },
    { mode: "managed-plan-review", tools: ["aisb_host_describe", "aisb_list_templates", "aisb_read_system",
      ...planReviewTools, desktopDataPreviewTool, desktopProviderPreviewTool].sort() },
    { mode: "model-task-control", tools: [...expectedTools, ...planReviewTools, desktopDataPreviewTool, desktopProviderPreviewTool,
      "aisb_cancel_model_download"].sort() },
    { mode: "managed-model-task-control", tools: ["aisb_host_describe", "aisb_list_templates", "aisb_read_system",
      ...planReviewTools, desktopDataPreviewTool, desktopProviderPreviewTool, "aisb_cancel_model_download"].sort() },
  ]);
  const schemas = new Map(reference.tools.map(({ name, inputSchema }) => [name, inputSchema]));
  const assertExactObject = (name: string, required: string[], optional: string[] = []) => {
    const schema = schemas.get(name);
    assert.ok(schema, name);
    assert.equal(schema.additionalProperties, false, name);
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort(), name);
    assert.deepEqual([...(schema.required ?? [])].sort(), [...required].sort(), name);
    return schema;
  };
  const host = ["hostIncarnationId"];
  const workspace = [...host, "workspaceId"];
  const savedSystem = [...workspace, "systemId"];
  const base = [...savedSystem, "baseRecordRevision", "baseRevisionId"];
  const namedEdit = [...base, "idempotencyKey", "name"];
  assertExactObject("aisb_host_describe", []);
  assertExactObject("aisb_list_workspaces", host);
  for (const name of ["aisb_list_systems", "aisb_list_templates", "aisb_saved_system_snapshot"]) assertExactObject(name, workspace);
  assertExactObject("aisb_read_system", savedSystem);
  assertExactObject("aisb_read_context", [...workspace, "contextId"]);
  assertExactObject("aisb_cancel_model_download", [...workspace, "selection"]);
  assertExactObject("aisb_preview_context_rebuild", [...workspace, "reference"]);
  assertExactObject("aisb_preview_context_query", [...workspace, "reference", "query", "maximumResults", "embeddingDevice"]);
  assertExactObject("aisb_saved_system_changes", [...workspace, "cursor"]);
  assertExactObject("aisb_list_workflows", [...workspace, "sourceKind"]);
  assertExactObject("aisb_prepare_workflow", [...workspace, "profileId", "source"]);
  assertExactObject("aisb_read_conversation_task", [...workspace, "sessionId", "turnId"]);
  assertExactObject("aisb_create_system", [...workspace, "templateId", "name", "idempotencyKey"]);
  assertExactObject("aisb_rename_system", namedEdit, ["description"]);
  assertExactObject("aisb_clone_system", namedEdit);
  assertExactObject("aisb_plan_capabilities", workspace);
  assertExactObject("aisb_preview_build_plan", [...workspace, "steps"]);
  assertExactObject("aisb_request_build_plan_approval", [...workspace, "fingerprint", "steps"]);
  assertExactObject("aisb_build_plan_approval_status", [...workspace, "fingerprint"]);
  const queryStepSchema = assertExactObject("aisb_run_approved_build_step", [...workspace, "fingerprint", "approvalRevision", "step"], ["contextQuery"]);
  assert.deepEqual(queryStepSchema.properties?.contextQuery, {type: "string", minLength: 1, maxLength: 2000});
  assertExactObject(desktopDataPreviewTool, [...workspace, "taskId", "fileId", "taskRevision"]);
  assertExactObject(desktopProviderPreviewTool, [...workspace, "taskId", "fileId", "taskRevision"]);
  assertExactObject("aisb_preview_edits", [...base, "edits"]);
  assertExactObject("aisb_apply_edits", [...base, "edits", "previewDigest", "idempotencyKey"]);
  const turn = assertExactObject(conversation, [...workspace, "planId", "planRevision", "sessionId", "snapshotRevision", "key", "text"]);
  assert.deepEqual(turn.properties?.text, { type: "string", minLength: 1, maxLength: 2_000 });
  assertExactObject("aisb_list_windows", workspace);
  assertExactObject("aisb_request_window", ["target", "taskId", "requestKey"]);
  const presentationSchema = assertExactObject("aisb_present_in_window", ["target", "commandId", "intent"]);
  const choices = (presentationSchema.properties?.intent as {oneOf: {additionalProperties: boolean; properties: Record<string, any>}[]}).oneOf;
  assert.deepEqual(choices.map(value => value.properties.action.const).sort(), [...UI_PRESENTATION_ACTIONS].sort());
  const queryWindow = choices.find(value => value.properties.action.const === "show-context-query");
  assert.ok(queryWindow); assert.equal(queryWindow.additionalProperties, false);
  assert.deepEqual(Object.keys(queryWindow.properties).sort(), ["action", "taskId"]);
  assert.equal(queryWindow.properties.taskId.type, "string");
  assert.deepEqual(queryWindow.properties.taskId, choices.find(value => value.properties.action.const === "show-context-task")!.properties.taskId);
  const contextReference = choices.find(value => value.properties.action.const === "show-context-artifact")!.properties.reference;
  assert.equal(contextReference.additionalProperties, false);
  assert.deepEqual(Object.keys(contextReference.properties).sort(), ["workspaceId", "contextId", "taskId", "kind", "artifactDigest"].sort());
  assert.deepEqual([...contextReference.required].sort(), Object.keys(contextReference.properties).sort());
  for (const name of ["aisb_window_context", "aisb_window_status", "aisb_release_window", "aisb_renew_window"]) {
    assertExactObject(name, ["target"]);
  }
});

function pair(connector: { endpoint: string; fingerprint: string }, pairingCode: string) {
  return new Promise<string>((resolve, reject) => {
    const body = JSON.stringify({ pairingCode });
    const req = request(new URL("/aisb-headless/v1/pair", connector.endpoint), {
      method: "POST", agent: createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint),
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8").on("data", (chunk: string) => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(text) as { value?: { credential?: string } };
          if (res.statusCode !== 200 || !parsed.value?.credential) throw new Error("Fixture pairing failed.");
          resolve(parsed.value.credential);
        } catch { reject(new Error("Fixture pairing failed.")); }
      });
    });
    req.setTimeout(5_000, () => req.destroy(new Error("Fixture pairing timed out.")));
    req.on("error", reject).end(body);
  });
}

test("Desktop SDK cancellation is opt-in, pinned, detached and never retried after uncertain effects", {timeout: 12_000}, async () => {
  const {createHeadlessMcpReadForwarder} = await import("../createHeadlessMcpReadForwarder.mjs");
  const registry = createDesktopHeadlessClientAuthority({documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity: {organizationId, principalId: "principal.cancel-fixture"}, canReadWorkspace: async id => id === workspaceId,
    canReviewPlans: async id => id === workspaceId});
  const taskId = randomUUID(), plan = {fingerprint: "a".repeat(64), step: 1};
  const value = {workspaceId, taskId, plan, state: "running", percent: null, registration: "requires-separate-approval",
    runtimeReadiness: "not-checked", cancellationAccepted: true};
  let calls = 0, mode = "valid";
  const connector = await startDesktopHeadlessLoopback({registrations: registry,
    read: async () => ({ok: false, code: "headless.forbidden"}),
    planReview: {hostIncarnationId, execute: async () => ({ok: false, code: "headless.forbidden"})},
    modelTaskControl: {hostIncarnationId, async execute(input, grant) {
      calls++; assert.equal(input.operation, "models.cancel-download"); assert.equal(grant.isOperationCurrent?.(), true);
      if (input.input.selection.kind === "task") assert.equal(input.input.selection.taskId, taskId);
      if (mode === "throw") throw new Error("private/model/path");
      if (mode.startsWith("headless.")) return {ok: false, code: mode} as never;
      return {ok: true, operation: "models.cancel-download", value: {...value,
        ...(mode === "plan" ? {plan: {fingerprint: "b".repeat(64), step: 1}} : {})}} as never;
    }}});
  try {
    const pending = await registry.beginPairing(workspaceId, () => true, "plan-review"); assert.equal(pending.status, "ready");
    const credential = await pair(connector, pending.pairingCode);
    const disabled = createHeadlessMcpReadForwarder(connector.endpoint, connector.fingerprint, credential, false, false, false, true);
    const enabled = createHeadlessMcpReadForwarder(connector.endpoint, connector.fingerprint, credential, false, false, false, true, true);
    assert.ok(disabled && enabled);
    const command = {version, operation: "models.cancel-download" as const, input: {hostIncarnationId, workspaceId,
      selection: {kind: "task" as const, taskId}}};
    assert.deepEqual(await disabled(command), {ok: false, code: "headless.forbidden"}); assert.equal(calls, 0);
    const result = enabled(command); command.input.selection.taskId = randomUUID();
    assert.deepEqual(await result, {ok: true, operation: "models.cancel-download", value});
    mode = "plan";
    assert.deepEqual(await enabled({...command, input: {...command.input, selection: {kind: "plan-step", ...plan}}}),
      {ok: false, code: "headless.operation-unconfirmed"});
    mode = "throw";
    assert.deepEqual(await enabled({...command, input: {...command.input, selection: {kind: "task", taskId}}}),
      {ok: false, code: "headless.operation-unconfirmed"});
    for (const next of ["headless.invalid-request", "headless.unsupported-operation", "headless.host-changed"]) {
      mode = next;
      assert.deepEqual(await enabled({...command, input: {...command.input, selection: {kind: "task", taskId}}}),
        {ok: false, code: "headless.operation-unconfirmed"});
    }
    assert.equal(calls, 6, "Each explicit cancellation sends exactly one request, including uncertain outcomes.");
  } finally {registry.close(); await connector.close();}
});

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const block = result.content?.[0];
  assert.equal(block?.type, "text");
  if (block?.type !== "text") throw new Error("Expected a text result.");
  return JSON.parse(block.text);
}

function checkedPlan(result: unknown) {
  assert.ok(result && typeof result === "object" && "ok" in result && result.ok === true && "value" in result);
  const value = result.value;
  assert.ok(value && typeof value === "object" && "fingerprint" in value);
  const { fingerprint, ...plan } = value;
  assert.ok(typeof fingerprint === "string");
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint, createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex"));
  return { fingerprint, plan };
}

test("the opt-in stdio tool requires a separately granted, exact approved turn", { timeout: 25_000 }, async () => {
  const registry = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity: { organizationId, principalId: "mcp-fixture-user" },
    canReadWorkspace: async (id) => id === workspaceId,
  });
  const host = hostIncarnationId;
  assert.ok(isHeadlessHostIncarnationId(host));
  const active = new Set<string>();
  let calls = 0;
  let withhold = false;
  let invalidResult = false;
  let previousFingerprint: string | undefined;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        if (!grant || !active.has(grant.registeredClientId)) return grant;
        return { ...grant, conversation: true, isCurrent: () => active.has(grant.registeredClientId) && grant.isCurrent() };
      },
    },
    async read() { return { ok: false, code: "headless.unavailable" }; },
    conversation: {
      hostIncarnationId: host,
      async execute(input, authority) {
        calls++;
        assert.equal(input.text, "Synthetic turn");
        assert.ok(!("hostIncarnationId" in input));
        assert.ok(await authority.currentGrant());
        const fingerprint = authority.fingerprint("synthetic fingerprint input");
        assert.match(fingerprint, /^[a-f0-9]{64}$/);
        if (previousFingerprint !== undefined) assert.equal(fingerprint, previousFingerprint);
        previousFingerprint = fingerprint;
        if (withhold) active.delete(authority.grant.registeredClientId);
        return { ok: true, value: { turnId: "fixture-turn", runId: "fixture-run",
          ...(invalidResult ? { diagnostic: "synthetic internal text" } : {}) } };
      },
    },
  });
  const client = new Client({ name: "ai-system-builder-conversation-fixture", version: "1.0.0" });
  try {
    const pending = await registry.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const credential = await pair(connector, pending.pairingCode);
    const grant = await registry.verifyCredential(credential);
    assert.ok(grant);
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", entrypoint],
      env: { AISB_HEADLESS_ENDPOINT: connector.endpoint, AISB_HEADLESS_FINGERPRINT: connector.fingerprint,
        AISB_HEADLESS_CREDENTIAL: credential, AISB_HEADLESS_ENABLE_CONVERSATION: "1", TSX_DISABLE_CACHE: "1" },
      stderr: "ignore", maxBufferSize: 256 * 1024,
    });
    await client.connect(transport);
    const name = "aisb_send_approved_turn";
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), [...expectedTools, name].sort());
    const args = { hostIncarnationId, workspaceId, planId: "fixture-plan", planRevision: "revision-1",
      snapshotRevision: "snapshot-1", sessionId: "fixture-session", key: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", text: "Synthetic turn" };
    const invoke = async (input: Record<string, unknown> = args) => resultText(await client.callTool({ name, arguments: input }));
    const unconfirmed = { ok: false, code: "headless.operation-unconfirmed" };
    assert.deepEqual(await invoke(), unconfirmed);
    active.add(grant.registeredClientId);
    assert.deepEqual(await invoke({ ...args, hostIncarnationId: args.key }), { ok: false, code: "headless.host-changed" });
    assert.deepEqual(await invoke({ ...args, workspaceId: createWorkspaceId("other-workspace") }), unconfirmed);
    const extra = await client.callTool({ name, arguments: { ...args, approvalId: "untrusted" } });
    assert.equal(Boolean(extra.isError), true);
    assert.equal(calls, 0);
    assert.deepEqual(await invoke(), { ok: true, value: { turnId: "fixture-turn", runId: "fixture-run" } });
    invalidResult = true;
    assert.deepEqual(await invoke(), unconfirmed);
    invalidResult = false;
    withhold = true;
    assert.deepEqual(await invoke(), unconfirmed);
    assert.deepEqual(await invoke(), unconfirmed);
    assert.equal(calls, 3);
  } finally {
    await client.close();
    registry.close();
    await connector.close();
  }
});

test("official stdio opt-in lists only finite authoring tools and forwards without retries", { timeout: 20_000 }, async () => {
  const registrations = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity: { organizationId, principalId: "mcp-fixture-user" },
    canReadWorkspace: async (id) => id === workspaceId,
    canAuthorWorkspace: async (id) => id === workspaceId,
  });
  let calls = 0;
  let unknown = false;
  let revokeAfterDispatch = false;
  let readCalls = 0;
  if (!isHeadlessHostIncarnationId(hostIncarnationId)) throw new Error("Invalid test host");
  const connector = await startDesktopHeadlessLoopback({
    registrations,
    async read(input, currentGrant) {
      const parsed = parseHeadlessReadRequest(input, hostIncarnationId);
      if (!parsed.ok) return parsed;
      if (parsed.request.operation !== "templates.list" && parsed.request.operation !== "plan.capabilities")
        return {ok:false, code:"headless.unsupported-operation"};
      const grant = await currentGrant();
      if (!grant?.workspaceIds.includes(parsed.request.input.workspaceId)) return {ok:false, code:"headless.forbidden"};
      readCalls++;
      if (parsed.request.operation === "plan.capabilities") return {
        ok:true, operation:"plan.capabilities", value:{workspaceId,
          actions:grant.authoring?.includes("systems.create") ? ["systems.create"] : [], approval:"required"},
      };
      return {ok:true, operation:"templates.list", value:[{
        templateId:"reference.secured-data-review@1.0.0", displayName:"Saved fixture template",
      }]};
    },
    authoring: {
      hostIncarnationId,
      async execute(input, grant) {
        calls++;
        assert.equal(input.operation, "systems.create");
        if (revokeAfterDispatch) assert.equal(await registrations.revokeClient(grant.registeredClientId), true);
        return unknown ? { ok: false, code: "headless.operation-unconfirmed" }
          : { ok: true, value: { kind: "committed", reference: { systemId, revisionId: "mcp-fixture-system.r1", recordRevision: 1 } } };
      },
    },
  });
  const client = new Client({ name: "ai-system-builder-authoring-fixture", version: "1.0.0" });
  try {
    const pending = await registrations.beginPairing(workspaceId, () => true, "author");
    assert.equal(pending.status, "ready");
    const credential = await pair(connector, pending.pairingCode);
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", entrypoint],
      env: { AISB_HEADLESS_ENDPOINT: connector.endpoint, AISB_HEADLESS_FINGERPRINT: connector.fingerprint,
        AISB_HEADLESS_CREDENTIAL: credential, AISB_HEADLESS_ENABLE_AUTHORING: "1", TSX_DISABLE_CACHE: "1" },
      stderr: "ignore", maxBufferSize: 256 * 1024,
    });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name).sort(), [...expectedTools, ...authoringTools].sort());
    assert.equal(calls, 0);
    const args = { hostIncarnationId, workspaceId, templateId: "reference.secured-data-review@1.0.0",
      name: "Synthetic system", idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a" };
    const {hostIncarnationId: planHost, workspaceId: planWorkspace, ...newSystem} = args;
    const capabilities = await client.callTool({name:"aisb_plan_capabilities", arguments:{hostIncarnationId, workspaceId}});
    assert.deepEqual(resultText(capabilities), {ok:true, operation:"plan.capabilities",
      value:{workspaceId, actions:["systems.create"], approval:"required"}});
    const plan = {hostIncarnationId: planHost, workspaceId: planWorkspace, steps:[{operation: "systems.create", ...newSystem}]};
    const preview = await client.callTool({name:"aisb_preview_build_plan", arguments:plan});
    assert.deepEqual(checkedPlan(resultText(preview)).plan, {
      version:"aisb-build-plan-preview-v1", hostIncarnationId, workspaceId, approval:"required",
      steps:[{operation:"systems.create", input:newSystem, effect:"saved-system-write", externalProviderCalls:0}],
    });
    const extra = await client.callTool({name:"aisb_preview_build_plan",
      arguments:{...plan, steps:[{...plan.steps[0], approval:"claimed"}]}});
    assert.equal(Boolean(extra.isError), true);
    assert.equal(readCalls, 2);
    assert.equal(calls, 0);
    const invalid = await client.callTool({ name: "aisb_create_system", arguments: { ...args, credential: "unexpected" } });
    assert.equal(Boolean(invalid.isError), true);
    assert.equal(calls, 0);
    const saved = await client.callTool({ name: "aisb_create_system", arguments: args });
    assert.deepEqual(resultText(saved), { ok: true, value: { kind: "committed", reference: { systemId, revisionId: "mcp-fixture-system.r1", recordRevision: 1 } } });
    unknown = true;
    const uncertain = await client.callTool({ name: "aisb_create_system", arguments: args });
    assert.deepEqual(resultText(uncertain), { ok: false, code: "headless.operation-unconfirmed" });
    assert.equal(calls, 2);
    unknown = false;
    revokeAfterDispatch = true;
    const revoked = await client.callTool({ name: "aisb_create_system", arguments: args });
    assert.deepEqual(resultText(revoked), { ok: false, code: "headless.operation-unconfirmed" });
    assert.equal(calls, 3);
  } finally { try { await client.close(); } finally { registrations.close(); await connector.close(); } }
});

test("official stdio client finds finite read tools and uses the already running connector in both protocol eras", { timeout: 20_000 }, async () => {
  const registrations = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity: { organizationId, principalId: "mcp-fixture-user" },
    canReadWorkspace: async (id) => id === workspaceId,
  });
  let reads = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations,
    async read(input, currentGrant) {
      const grant = await currentGrant();
      if (!grant) return { ok: false, code: "headless.forbidden" };
      reads++;
      const parsed = parseHeadlessReadRequest(input, hostIncarnationId);
      if (!parsed.ok) return parsed;
      if (parsed.request.operation === "host.describe") return {
        ok: true, operation: "host.describe",
        value: { version, hostIncarnationId, workspaces: grant.workspaceIds, operations: grant.operations },
      };
      if (parsed.request.operation === "systems.read") {
        if (!grant.workspaceIds.includes(parsed.request.input.workspaceId)) return { ok: false, code: "headless.forbidden" };
        return { ok: true, operation: "systems.read", value: { systemId, name: "Fixture system", revision: 4, status: "draft" } };
      }
      if (parsed.request.operation === "systems.snapshot") {
        return { ok: true, operation: "systems.snapshot", value: { systems: [],
          cursor: { hostIncarnationId, sequence: 3, scopeTag: "a".repeat(64) } } };
      }
      if (parsed.request.operation === "systems.changes") {
        const { cursor } = parsed.request.input;
        return { ok: true, operation: "systems.changes", value: {
          kind: "changes", events: [{ systemId, recordRevision: 4, revisionId: null, sequence: 4 }],
          cursor: { ...cursor, sequence: 4, scopeTag: "b".repeat(64) }, more: false,
        } };
      }
      if (parsed.request.operation === "conversation-tasks.read") {
        const { sessionId, turnId } = parsed.request.input;
        return { ok: true, operation: "conversation-tasks.read", value: {
          sessionId, turnId, turnStatus: "generating", run: { runId: "run.fixture", status: "running" },
        } };
      }
      return { ok: false, code: "headless.unsupported-operation" };
    },
  });
  try {
    const pending = await registrations.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const credential = await pair(connector, pending.pairingCode);
    for (const mode of ["legacy", "auto"] as const) {
      const client = new Client({ name: "ai-system-builder-stdio-fixture", version: "1.0.0" }, { versionNegotiation: { mode } });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", entrypoint],
        env: { AISB_HEADLESS_ENDPOINT: connector.endpoint, AISB_HEADLESS_FINGERPRINT: connector.fingerprint, AISB_HEADLESS_CREDENTIAL: credential, TSX_DISABLE_CACHE: "1" },
        stderr: "ignore",
        maxBufferSize: 256 * 1024,
      });
      try {
        const prior = reads;
        await client.connect(transport);
        const listed = await client.listTools();
        assert.deepEqual(listed.tools.map(({ name }) => name).sort(), expectedTools);
        assert.equal(reads, prior);
        const negotiated = client.getNegotiatedProtocolVersion();
        assert.equal(negotiated, mode === "auto" ? "2026-07-28" : "2025-11-25");
        const described = await client.callTool({ name: "aisb_host_describe", arguments: {} });
        assert.equal(Boolean(described.isError), false);
        assert.deepEqual(resultText(described), {
          ok: true, operation: "host.describe", value: { version, hostIncarnationId, workspaces: [workspaceId],
            operations: HEADLESS_READ_OPERATIONS.filter(operation => operation !== "models.preview-source") },
        });
        const read = await client.callTool({ name: "aisb_read_system", arguments: { hostIncarnationId, workspaceId, systemId } });
        assert.deepEqual(resultText(read), { ok: true, operation: "systems.read", value: { systemId, name: "Fixture system", revision: 4, status: "draft" } });
        const cursor: HeadlessChangeCursor = { hostIncarnationId, sequence: 3, scopeTag: "a".repeat(64) };
        const snapshot = await client.callTool({ name: "aisb_saved_system_snapshot", arguments: { hostIncarnationId, workspaceId } });
        assert.deepEqual(resultText(snapshot), { ok: true, operation: "systems.snapshot", value: { systems: [], cursor } });
        const changes = await client.callTool({ name: "aisb_saved_system_changes", arguments: { hostIncarnationId, workspaceId, cursor } });
        assert.deepEqual(resultText(changes), { ok: true, operation: "systems.changes", value: {
          kind: "changes", events: [{ systemId, recordRevision: 4, revisionId: null, sequence: 4 }],
          cursor: { ...cursor, sequence: 4, scopeTag: "b".repeat(64) }, more: false,
        } });
        const task = await client.callTool({ name: "aisb_read_conversation_task", arguments: {
          hostIncarnationId, workspaceId, sessionId: "session.fixture", turnId: "turn.fixture",
        } });
        assert.deepEqual(resultText(task), { ok: true, operation: "conversation-tasks.read", value: {
          sessionId: "session.fixture", turnId: "turn.fixture", turnStatus: "generating", run: { runId: "run.fixture", status: "running" },
        } });
        const invalid = await client.callTool({ name: "aisb_read_system", arguments: {
          hostIncarnationId, workspaceId, systemId, endpoint: "http://other.invalid",
        } });
        assert.equal(invalid.isError, true);
        assert.equal(reads, prior + 5);
      } finally {
        await client.close();
      }
    }
  } finally {
    registrations.close();
    await connector.close();
  }
});

test("a replacement peer at the configured address receives no HTTP request or credential", { timeout: 10_000 }, async () => {
  const certificate = await selfsigned.generate([{ name: "commonName", value: "127.0.0.1" }], { keySize: 2048 });
  let applicationRequests = 0;
  let connected = 0;
  const replacement = createServer({ cert: certificate.cert, key: certificate.private, minVersion: "TLSv1.3" }, (_req, res) => {
    applicationRequests++;
    res.writeHead(500).end();
  });
  replacement.on("connection", () => { connected++; });
  await new Promise<void>((resolve, reject) => {
    replacement.once("error", reject);
    replacement.listen(0, "127.0.0.1", resolve);
  });
  const address = replacement.address();
  assert.ok(address && typeof address !== "string");
  const client = new Client({ name: "peer-verification-fixture", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: ["--import", "tsx", entrypoint], stderr: "ignore",
      env: {
        AISB_HEADLESS_ENDPOINT: `https://127.0.0.1:${address.port}`,
        AISB_HEADLESS_FINGERPRINT: "0".repeat(64),
        AISB_HEADLESS_CREDENTIAL: "a".repeat(43),
        TSX_DISABLE_CACHE: "1",
      },
    }));
    const reply = await client.callTool({ name: "aisb_host_describe", arguments: {} });
    assert.deepEqual(resultText(reply), { ok: false, code: "headless.unavailable" });
    assert.equal(reply.isError, true);
    assert.equal(applicationRequests, 0);
    // Ensure the replacement was reachable; the denial was not a refused TCP connection.
    assert.ok(connected > 0);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => {
      replacement.close((error) => error ? reject(error) : resolve());
      replacement.closeAllConnections();
    });
  }
});

test("stdio closes before a non-reading client can queue unbounded output", async () => {
  const stdin = new PassThrough();
  let release: (() => void) | undefined;
  const stdout = new Writable({ highWaterMark: 16, write(_chunk, _encoding, done) { release = done; } });
  let limits = 0;
  const transport = boundHeadlessMcpStdio(stdin, stdout, () => {
    limits++;
    stdout.destroy(new Error("Fixture stopped."));
  });
  await transport.start();
  try {
    const pending = Array.from({ length: 5 }, (_, index) => transport.send({
      jsonrpc: "2.0", id: index, result: { value: "x".repeat(100) },
    }));
    await assert.rejects(pending[4]!);
    assert.equal(limits, 1);
    assert.ok(stdout.writableLength <= 4 * 200);
    release?.();
    await Promise.allSettled(pending);
  } finally {
    stdin.destroy();
    stdout.destroy();
    await transport.close();
  }
});

test("stdio admits only eight unanswered requests from one client", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let limits = 0;
  let accepted = 0;
  const transport = boundHeadlessMcpStdio(stdin, stdout, () => { limits++; });
  transport.onmessage = () => { accepted++; };
  try {
    await transport.start();
    stdin.write(Array.from({ length: 10 }, (_, id) => JSON.stringify({ jsonrpc: "2.0", id, method: "ping" })).join("\n") + "\n");
    assert.equal(accepted, 8);
    assert.equal(limits, 1);
  } finally {
    await transport.close();
    stdin.destroy();
    stdout.destroy();
  }
});

test("does not queue no-ID traffic while the SDK pump has not retired an admitted request", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const accepted: string[] = [];
  const transport = boundHeadlessMcpStdio(stdin, stdout, () => assert.fail("Finite traffic unexpectedly closed."));
  transport.onmessage = (message) => { accepted.push("method" in message ? message.method : "response"); };
  const write = (message: object) => stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  try {
    await transport.start();
    write({ id: 1, method: "ping" });
    for (let i = 0; i < 20; i++) {
      write({ method: "notifications/initialized" });
      write({ method: "notifications/cancelled", params: { requestId: 1 } });
      write({ method: "notifications/cancelled", params: { requestId: i + 10 } });
      write({ method: "unknown.notify" });
      write({ id: i + 10, result: {} });
    }
    assert.deepEqual(accepted, ["ping", "notifications/initialized", "notifications/cancelled"]);
  } finally {
    await transport.close();
    stdin.destroy();
    stdout.destroy();
  }
});

function recordedTrainingHistory(workspace: unknown, taskId: string, plan: {fingerprint: string; step: number}) {
  return {workspaceId: workspace, taskId, plan: {...plan}, provenance: {modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-21T00:00:00.000Z",
    datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64),
    recipeDigest: "sha256:" + "b".repeat(64), proposalDigest: "sha256:" + "c".repeat(64), trainingTask: "llm-instruction", method: "lora",
    trainingInputCount: 1, validationInputCount: 1, inputBytes: 128, recipeBytes: 64},
    candidate: {requestedName: "Small trial", artifactForm: "adapter", serializationFormat: "adapter-safetensors", recordedSizeBytes: 256},
    comparison: {state: "not-recorded"}, verification: {inputs: "recorded-not-rechecked", retainedFiles: "not-checked",
      runtimeReadiness: "not-checked", hardware: "not-recorded", outputQuality: "not-evaluated"}, registration: "requires-separate-approval"} as const;
}

/** Fixed historical numeric protocol fixture only; no model or scoring runs. */
function recordedTrainingMeasurement() {
  return {state: "recorded", report: {protocol: "fixed-first-32-validation-loss-v1", maximumRows: 32,
    sampleCount: 2, baselineLoss: 2, trainedLoss: 1.5, lossDelta: -0.5, interpretation: "measurement-only"}} as const;
}
