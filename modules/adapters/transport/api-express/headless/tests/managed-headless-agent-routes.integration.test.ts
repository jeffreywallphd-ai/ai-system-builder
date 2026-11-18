import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import path from "node:path";

import { HEADLESS_CONTRACT_VERSION, HEADLESS_PLAN_REVIEW_MAX_REQUEST_BYTES, parseHeadlessBuildPlanProposal,
  UI_CONTROL_VERSION, type HeadlessHostIncarnationId, type HeadlessPlanStepResult } from "../../../../../contracts/headless";
import { MANAGED_HEADLESS_AGENT_SESSION_HEADER } from "../../../../../contracts/headless";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId } from "../../../../../contracts/ingestion";
import { createOrganizationId } from "../../../../../contracts/organization";
import { type AuthContext, createSecurityApplicationError } from "../../../../../contracts/security";
import { normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId } from "../../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import { MANAGED_HEADLESS_AGENT_PATHS, resolveApiRoutePolicy } from "../../security/apiRouteSecurityPolicy";
import { createExpressSecurityMiddleware } from "../../security/createExpressSecurityMiddleware";
import { registerManagedHeadlessAgentRoutes, type ManagedAgentRouteHandlers } from "../registerManagedHeadlessAgentRoutes";

test("managed agent routes stay exact in the central deny-by-default API", () => {
  for (const [kind, path] of Object.entries(MANAGED_HEADLESS_AGENT_PATHS)) {
    const scopes = kind === "local-file-preview" || kind === "provider-file-preview" ? ["workspace:read", "artifact:read"] :
      ["workspace:read", "asset:read", ...(kind === "plan-review" || kind === "plan-step" ? ["asset:write"] : [])];
    assert.deepEqual(resolveApiRoutePolicy("POST", path), {public: false, scopes});
    for (const method of ["GET", "HEAD", "DELETE", "PATCH"])
      assert.equal(resolveApiRoutePolicy(method, path).deny, true);
    for (const variant of [path + "/", path.toUpperCase(), path.replace("agent", "%61gent"), path + "/other"])
      assert.equal(resolveApiRoutePolicy("POST", variant).deny, true);
  }
});

test("managed plan routes admit only exact proposals, status and an approved step result", {timeout:10_000}, async () => {
  const organizationId = createOrganizationId("managed-plan-fixture");
  const workspaceId = createWorkspaceId("fixture-workspace");
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const planIdentity = {role:"plan-review" as const};
  let enabled = true;
  let publish = true;
  let current = true;
  let calls = 0;
  let sends = 0;
  let previewCalls = 0;
  let providerCalls = 0;
  let previewState: "selected" | "stale" | "expired" | "malformed" = "selected";
  let previewFence = true;
  let previewCurrent = true;
  let supportsLocalSave = false;
  let statusMismatch = false;
  let statusExtra = false;
  let withdrawStatus = false;
  let statusCalls = 0;
  let preparationReady = true;
  const acceptedDatasetTaskId = randomUUID();
  let savedFile: {workspaceId:typeof workspaceId; taskId:ReturnType<typeof normalizeIngestionTaskId>;
    fileId:ReturnType<typeof normalizeIngestionTaskFileId>; taskRevision:number} | undefined;
  const expiresAt = Date.now() + 30_000;
  let stepExpiresAt = expiresAt;
  const app = express();
  app.enable("case sensitive routing");
  app.use(createExpressSecurityMiddleware({mode:"oidc-bearer", authRequired:true, httpsRequired:false,
    async verifyToken({token}): Promise<AuthContext> {
      return {authenticated:true, authMethod:"oidc-bearer", oidcAccessTokenClientId:token,
        principal:{kind:"user", principalId:"principal-fixture", roles:[], scopes:[]}};
    },
  }));
  const retire = registerManagedHeadlessAgentRoutes(app, (): ManagedAgentRouteHandlers<typeof planIdentity> => ({
    hostIncarnationId,
    allowLocalFileSave:supportsLocalSave,
    identify: (request, kind) => (kind === "plan-review" || kind === "plan-step" ||
      kind === "local-file-preview" || kind === "provider-file-preview" || kind === "read") &&
      request.organizationHeader === organizationId &&
      request.auth?.oidcAccessTokenClientId === "fixture-plan" ? planIdentity : undefined,
    isCurrent: identity => identity === planIdentity && current,
    async read(request) {
      if (request.operation === "host.describe") return {ok: true, operation: request.operation, value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId, workspaces: [], operations: ["data.ingestion-status", "data.dataset-versions", "data.compare-dataset-versions", "data.preview-dataset-preparation"],
      }};
      if (request.operation === "context.models") {
        if (withdrawStatus) current = false;
        return {ok: true, operation: request.operation, value: {workspaceId: statusMismatch ? "foreign" as never : request.input.workspaceId,
          models: [], truncated: false, runtimeReadiness: "not-checked", ...(statusExtra ? {privatePath: "private/model"} : {})}};
      }
      if (request.operation === "context.preview-generation") {
        if (withdrawStatus) current = false;
        return {ok: true, operation: request.operation, value: {workspaceId: request.input.workspaceId, name: request.input.name,
          sources: request.input.sources.map(reference => ({reference, sizeBytes: 32, digest: "sha256:" + "a".repeat(64), format: "csv", licenseStatus: "unknown" as const})),
          settings: request.input.settings, totalBytes: 32, runtimeReadiness: statusMismatch ? "ready" as never : "not-checked",
          approvalRequired: true, reviewRequired: true, modelCalls: 0, externalProviderCalls: 0, ...(statusExtra ? {command: {private: "private"}} : {})}};
      }
      if (request.operation === "data.dataset-task-status") {
        if (withdrawStatus) current = false;
        return {ok: true, operation: request.operation, value: {
          taskId: statusMismatch ? randomUUID() : acceptedDatasetTaskId, state: "review-required",
          ...(statusExtra ? {outputPath: "private"} : {}),
        }};
      }
      if (request.operation === "data.preview-dataset-preparation") {
        if (withdrawStatus) current = false;
        if (!preparationReady) return {ok: false, code: "headless.source-not-ready"};
        return {ok: true, operation: request.operation, value: {workspaceId: request.input.workspaceId,
          sources: request.input.sources.map((source, index) => ({...source,
            fileId: statusMismatch ? "foreign" as never : source.fileId, sourceSnapshotId: "snapshot.preview." + index,
            format: "csv", sizeBytes: 32, digest: "sha256:" + "a".repeat(64), licenseStatus: "unknown" as const})),
          recipe: request.input.recipe, split: request.input.split, qualityPreset: request.input.qualityPreset,
          totalBytes: 32 * request.input.sources.length, maximumRowsPerSource: 1000, outputFormat: "jsonl", reviewRequired: true,
          externalProviderCalls: 0, modelCalls: 0, ...(statusExtra ? {command: {sourceArtifactIds: ["private"]}} : {}),
        }};
      }
      if (request.operation === "data.dataset-versions") {
        if (withdrawStatus) current = false;
        return {ok: true, operation: request.operation, value: {
          workspaceId: request.input.workspaceId, datasetId: statusMismatch ? "foreign" as never : request.input.datasetId,
          versions: request.input.versionIds.map(versionId => ({versionId, versionDigest: `sha256:${"a".repeat(64)}` as const,
            createdAt: "2026-11-17T00:00:00.000Z", totalRows: 10, sourceCount: 1, artifactCount: 1,
            parentVersionId: null, splitSeed: null, recipeDigest: `sha256:${"b".repeat(64)}` as const,
            quality: {policyFingerprint: `sha256:${"c".repeat(64)}` as const, reportFingerprint: `sha256:${"d".repeat(64)}` as const},
            splits: [{role: "train" as const, rowCount: null}, {role: "validation" as const, rowCount: null}, {role: "test" as const, rowCount: null}]})),
          ...(statusExtra ? {path: "private"} : {}),
        }};
      }
      if (request.operation === "data.compare-dataset-versions") {
        if (withdrawStatus) current = false;
        return {ok: true, operation: request.operation, value: {
          fromVersionId: request.input.fromVersionId, toVersionId: statusMismatch ? "foreign" as never : request.input.toVersionId,
          identical: false, rowDelta: 1, sources: {added: 0, removed: 0, changed: 0}, changedArtifactRoles: ["dataset"],
          recipeChanged: false, qualityPolicyChanged: false, documentationChanged: false,
          ...(statusExtra ? {recipeSnapshot: "private"} : {}),
        }};
      }
      if (request.operation !== "data.ingestion-status") throw new Error("Unexpected plan read.");
      statusCalls++;
      if (withdrawStatus) current = false;
      return {ok: true, operation: request.operation, value: {
        taskId: statusMismatch ? normalizeIngestionTaskId("wrong-task") : request.input.taskId,
        state: "queued", sourceKind: "file-batch", revision: 1,
        progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 4},
        ...(statusExtra ? {filename: "private-source.csv"} : {}),
      }};
    },
    async author() { throw new Error("Unexpected direct write."); },
    ...(enabled ? {async planReview(request) {
      calls += 1;
      return {ok:true, value:{fingerprint:request.target.fingerprint, revision:1, stepCount:publish ? 1 : 2,
        approvedSteps:0, expiresAt, status:"pending"}};
    }, async planStep({input}) {
      const shared = {kind:"committed" as const, fingerprint:input.fingerprint, step:input.step,
        approvalRevision:input.approvalRevision, expiresAt:stepExpiresAt};
      const result:HeadlessPlanStepResult = {ok:true, value:savedFile
        ? {...shared, operation:"data.save-local-source", reference:savedFile}
        : {...shared, reference:{systemId:normalizeSystemBuilderSystemId("system.fixture"),
          revisionId:normalizeSystemBuilderRevisionId("revision.fixture"), recordRevision:1}}};
      return {
        result,
        async publishIfCurrent(send) {
          if (!publish) current = false;
          const result = send();
          if (result) sends += 1;
          return result;
        }
      };
    }, async localFilePreview({input}) {
      previewCalls += 1;
      const {workspaceId, taskId, fileId, taskRevision} = input;
      const value = {workspaceId, taskId, fileId, taskRevision, mediaType:"text/csv", fileBytes:22,
        checkpointExpiresAt:previewState === "expired" ? Date.now() - 1 : expiresAt,
        effect:"save-local-source" as const, externalProviderCalls:0 as const};
      return {
        result:previewState === "stale" ? {ok:false, code:"headless.stale"} :
          {ok:true, value:previewState === "malformed" ? {...value, localPath:"private-synthetic.csv"} : value},
        async publishIfCurrent(send) {
          if (!previewCurrent) current = false;
          return previewFence && send();
        },
      };
    }, async providerFilePreview({input}) {
      providerCalls++;
      const {workspaceId, taskId, fileId, taskRevision} = input;
      const value = {workspaceId, taskId, fileId, taskRevision, provider:"huggingface" as const,
        providerRevision:"b".repeat(40), mediaType:"application/vnd.apache.parquet" as const,
        selectionExpiresAt:previewState === "expired" ? Date.now() - 1 : expiresAt,
        approvalRequired:true as const, externalProviderCalls:0 as const};
      return {
        result:previewState === "stale" ? {ok:false, code:"headless.stale"} :
          {ok:true, value:previewState === "malformed" ? {...value, path:"synthetic/private.parquet"} : value},
        async publishIfCurrent(send) {
          if (!previewCurrent) current = false;
          return previewFence && send();
        },
      };
    }} : {}),
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const scope = {hostIncarnationId, workspaceId};
    const steps = [{operation:"systems.create", name:"Synthetic proposal",
      templateId:"reference.secured-data-review@1.0.0", idempotencyKey:randomUUID()}];
    const built = parseHeadlessBuildPlanProposal({...scope, steps}, hostIncarnationId);
    assert.ok(built.ok);
    const fingerprint = createHash("sha256").update(JSON.stringify(built.preview)).digest("hex");
    const proposal = {version:HEADLESS_CONTRACT_VERSION, operation:"plan.submit", input:{...scope, fingerprint, steps}};
    const planPath = MANAGED_HEADLESS_AGENT_PATHS["plan-review"];
    async function request(body: object | string, token = "fixture-plan", route = planPath, org = organizationId) {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
        method:"POST", headers:{authorization:`Bearer ${token}`, "x-organization-id":org, "content-type":"application/json"},
        body:typeof body === "string" ? body : JSON.stringify(body),
      });
      return {status:response.status, cache:response.headers.get("cache-control"), body:await response.json()};
    }
    const readRoute = MANAGED_HEADLESS_AGENT_PATHS.read;
    const datasetTaskRequest = {version: HEADLESS_CONTRACT_VERSION, operation: "data.dataset-task-status",
      input: {...scope, selection: {kind: "task", taskId: acceptedDatasetTaskId}}};
    assert.deepEqual(await request(datasetTaskRequest, "fixture-plan", readRoute), {status: 200, cache: "no-store",
      body: {ok: true, operation: "data.dataset-task-status", value: {taskId: acceptedDatasetTaskId, state: "review-required"}}});
    assert.equal((await request({...datasetTaskRequest, input: {...scope, selection: {kind: "plan-step", fingerprint, step: 1}}},
      "fixture-plan", readRoute)).status, 200);
    statusMismatch = true;
    assert.equal((await request(datasetTaskRequest, "fixture-plan", readRoute)).status, 503);
    statusMismatch = false; statusExtra = true;
    assert.equal((await request(datasetTaskRequest, "fixture-plan", readRoute)).status, 503);
    statusExtra = false; withdrawStatus = true;
    assert.equal((await request(datasetTaskRequest, "fixture-plan", readRoute)).status, 403);
    withdrawStatus = false; current = true;
    assert.equal((await request(datasetTaskRequest, "fixture-agent", readRoute)).status, 403);
    enabled = false;
    assert.equal((await request(datasetTaskRequest, "fixture-plan", readRoute)).status, 400);
    enabled = true;
    for (const [operation, target] of [["context.models", {}], ["context.preview-generation", {name: "Synthetic context",
      sources: [{kind: "ingestion-file", taskId: "task.synthetic", fileId: "file.synthetic", taskRevision: 1}],
      settings: {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500,
        overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]}}]] as const) {
      const query = {version: HEADLESS_CONTRACT_VERSION, operation, input: {...scope, ...target}};
      assert.equal((await request(query, "fixture-plan", readRoute)).status, 200);
      statusMismatch = true; assert.equal((await request(query, "fixture-plan", readRoute)).status, 503);
      statusMismatch = false; statusExtra = true; assert.equal((await request(query, "fixture-plan", readRoute)).status, 503);
      statusExtra = false; withdrawStatus = true; assert.equal((await request(query, "fixture-plan", readRoute)).status, 403);
      withdrawStatus = false; current = true; assert.equal((await request(query, "fixture-agent", readRoute)).status, 403);
      enabled = false; assert.equal((await request(query, "fixture-plan", readRoute)).status, 400); enabled = true;
    }
    const preparationRequest = {version: HEADLESS_CONTRACT_VERSION, operation: "data.preview-dataset-preparation", input: {...scope,
      sources: [{taskId: "task.preview", fileId: "file.preview", taskRevision: 3}],
      recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
      split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}};
    const validPreparation = await request(preparationRequest, "fixture-plan", readRoute);
    assert.equal(validPreparation.status, 200);
    assert.equal("command" in validPreparation.body.value, false);
    statusExtra = true;
    assert.equal((await request(preparationRequest, "fixture-plan", readRoute)).status, 503);
    statusExtra = false; statusMismatch = true;
    assert.equal((await request(preparationRequest, "fixture-plan", readRoute)).status, 503);
    statusMismatch = false; withdrawStatus = true;
    assert.equal((await request(preparationRequest, "fixture-plan", readRoute)).status, 403);
    withdrawStatus = false; current = true; preparationReady = false;
    const unavailablePreparation = await request(preparationRequest, "fixture-plan", readRoute);
    assert.equal(unavailablePreparation.status, 409);
    assert.deepEqual(unavailablePreparation.body, {ok: false, code: "headless.source-not-ready"});
    preparationReady = true;
    assert.equal((await request(preparationRequest, "fixture-agent", readRoute)).status, 403);
    for (const [operation, target] of [["data.dataset-versions", {datasetId: "dataset.synthetic", versionIds: ["version.001"]}],
      ["data.compare-dataset-versions", {fromVersionId: "version.001", toVersionId: "version.002"}]]) {
      const query = {version: HEADLESS_CONTRACT_VERSION, operation, input: {...scope, ...target}};
      assert.equal((await request(query, "fixture-plan", readRoute)).status, 200);
      statusMismatch = true;
      assert.equal((await request(query, "fixture-plan", readRoute)).status, 503);
      statusMismatch = false; statusExtra = true;
      assert.equal((await request(query, "fixture-plan", readRoute)).status, 503);
      statusExtra = false; withdrawStatus = true;
      assert.equal((await request(query, "fixture-plan", readRoute)).status, 403);
      withdrawStatus = false; current = true;
      assert.equal((await request(query, "fixture-agent", readRoute)).status, 403);
    }
    const statusRequest = {version: HEADLESS_CONTRACT_VERSION, operation: "data.ingestion-status",
      input: {...scope, taskId: normalizeIngestionTaskId("task.synthetic")}};
    const dataStatus = await request(statusRequest, "fixture-plan", readRoute);
    assert.equal(dataStatus.status, 200);
    assert.deepEqual(dataStatus.body.value, {taskId: "task.synthetic", state: "queued", sourceKind: "file-batch", revision: 1,
      progress: {completedItems: 0, totalItems: 1, acceptedBytes: 0, totalBytes: 4}});
    statusMismatch = true;
    assert.equal((await request(statusRequest, "fixture-plan", readRoute)).status, 503);
    statusMismatch = false; statusExtra = true;
    assert.equal((await request(statusRequest, "fixture-plan", readRoute)).status, 503);
    statusExtra = false; withdrawStatus = true;
    assert.equal((await request(statusRequest, "fixture-plan", readRoute)).status, 403);
    withdrawStatus = false; current = true;
    assert.equal(statusCalls, 4);
    assert.equal((await request(statusRequest, "fixture-agent", readRoute)).status, 403);
    enabled = false;
    assert.equal((await request(statusRequest, "fixture-plan", readRoute)).status, 400);
    assert.equal(statusCalls, 4);
    enabled = true;
    const discovery = await request({version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {}}, "fixture-plan", readRoute);
    assert.ok(discovery.body.value.operations.includes("data.ingestion-status"));
    assert.equal((await request(proposal, "fixture-agent")).status, 403);
    assert.equal((await request(proposal, "fixture-browser")).status, 403);
    assert.equal((await request(proposal, "fixture-plan", MANAGED_HEADLESS_AGENT_PATHS.author)).status, 403);
    assert.equal((await request(proposal, "fixture-plan", planPath, createOrganizationId("other-fixture"))).status, 403);
    assert.equal((await request({...proposal, input:{...proposal.input, fingerprint:"not-a-digest"}})).status, 400);
    assert.equal((await request({...proposal, input:{...proposal.input, approve:true}})).status, 400);
    assert.equal((await request("x".repeat(HEADLESS_PLAN_REVIEW_MAX_REQUEST_BYTES + 1))).status, 413);
    assert.equal(calls, 0);
    enabled = false;
    assert.equal((await request(proposal)).status, 404);
    enabled = true;
    const result = await request(proposal);
    assert.deepEqual(result, {status:200, cache:"no-store", body:{ok:true,
      value:{fingerprint, revision:1, stepCount:1, approvedSteps:0, expiresAt, status:"pending"}}});
    assert.deepEqual(await request({version:HEADLESS_CONTRACT_VERSION, operation:"plan.status", input:{...scope, fingerprint}}), result);
    const previewPath = MANAGED_HEADLESS_AGENT_PATHS["local-file-preview"];
    const preview = {version:HEADLESS_CONTRACT_VERSION, operation:"data.prepare-local-file",
      input:{...scope, taskId:normalizeIngestionTaskId("ingestion.preview-fixture"),
        fileId:normalizeIngestionTaskFileId("file.preview-fixture"), taskRevision:4}};
    const readFile = (body:object = preview, token = "fixture-plan", org = organizationId) =>
      request(body, token, previewPath, org);
    for (const token of ["fixture-agent", "fixture-browser"])
      assert.equal((await readFile(preview, token)).status, 403);
    assert.equal((await readFile(preview, "fixture-plan", createOrganizationId("other-fixture"))).status, 403);
    assert.equal((await readFile({...preview, input:{...preview.input, name:"synthetic.csv"}})).status, 400);
    assert.equal(previewCalls, 0);
    const {hostIncarnationId: _boundHost, ...file} = preview.input;
    assert.deepEqual(await readFile(), {status:200, cache:"no-store", body:{ok:true,
      value:{...file, mediaType:"text/csv", fileBytes:22, checkpointExpiresAt:expiresAt, effect:"save-local-source",
        externalProviderCalls:0}}});
    const denied = {status:403, cache:"no-store", body:{ok:false, code:"headless.forbidden"}};
    previewState = "stale";
    assert.deepEqual(await readFile(), {status:409, cache:"no-store", body:{ok:false, code:"headless.stale"}});
    previewFence = false;
    assert.deepEqual(await readFile(), denied);
    previewFence = true;
    previewState = "expired";
    assert.deepEqual(await readFile(), denied);
    previewState = "malformed";
    assert.deepEqual(await readFile(), {status:503, cache:"no-store", body:{ok:false, code:"headless.unavailable"}});
    previewState = "selected";
    previewCurrent = false;
    assert.deepEqual(await readFile(), denied);
    current = true;
    previewCurrent = true;
    const providerPath = MANAGED_HEADLESS_AGENT_PATHS["provider-file-preview"];
    const provider = {...preview, operation:"data.prepare-provider-file"};
    const readProvider = (body:object = provider, token = "fixture-plan", org = organizationId) =>
      request(body, token, providerPath, org);
    for (const token of ["fixture-agent", "fixture-browser"])
      assert.equal((await readProvider(provider, token)).status, 403);
    assert.equal((await readProvider(provider, "fixture-plan", createOrganizationId("other-fixture"))).status, 403);
    assert.equal((await readProvider(preview)).status, 400);
    assert.equal((await readFile(provider)).status, 400);
    assert.equal((await readProvider({...provider, input:{...provider.input, path:"synthetic/private.parquet"}})).status, 400);
    assert.equal(providerCalls, 0);
    assert.deepEqual(await readProvider(), {status:200, cache:"no-store", body:{ok:true,
      value:{...file, provider:"huggingface", providerRevision:"b".repeat(40), mediaType:"application/vnd.apache.parquet",
        selectionExpiresAt:expiresAt, approvalRequired:true, externalProviderCalls:0}}});
    previewState = "stale";
    assert.deepEqual(await readProvider(), {status:409, cache:"no-store", body:{ok:false, code:"headless.stale"}});
    previewFence = false;
    assert.deepEqual(await readProvider(), denied);
    previewFence = true;
    previewState = "expired";
    assert.deepEqual(await readProvider(), denied);
    previewState = "malformed";
    assert.deepEqual(await readProvider(), {status:503, cache:"no-store", body:{ok:false, code:"headless.unavailable"}});
    previewState = "selected";
    previewCurrent = false;
    assert.deepEqual(await readProvider(), denied);
    previewCurrent = current = true;
    const stepPath = MANAGED_HEADLESS_AGENT_PATHS["plan-step"];
    const step = {version:HEADLESS_CONTRACT_VERSION, operation:"plan.run-step", input:{...scope, fingerprint, approvalRevision:2, step:1}};
    assert.equal((await request(step, "fixture-agent", stepPath)).status, 403);
    assert.equal((await request(step, "fixture-browser", stepPath)).status, 403);
    assert.equal((await request({...step, input:{...step.input, name:"Another name"}}, "fixture-plan", stepPath)).status, 400);
    assert.equal((await request(step, "fixture-plan", stepPath)).status, 200);
    assert.equal(sends,1);
    stepExpiresAt = Date.now() - 1;
    assert.equal((await request(step, "fixture-plan", stepPath)).status, 403);
    assert.equal(sends,1);
    stepExpiresAt = expiresAt;
    publish = false;
    assert.equal((await request(proposal)).status, 503);
    assert.equal(calls, 3);
    assert.deepEqual(await request(step, "fixture-plan", stepPath), {status:403, cache:"no-store",
      body:{ok:false, code:"headless.forbidden"}});
    assert.equal(sends,1);
    current = true;
    publish = true;
    const {workspaceId: _targetWorkspace, ...selected} = file;
    const fileSteps = [{...selected,operation:"data.save-local-source",idempotencyKey:randomUUID()}];
    const filePlan = parseHeadlessBuildPlanProposal({...scope,steps:fileSteps},hostIncarnationId,{allowLocalFileSave:true});
    assert.ok(filePlan.ok);
    const fileFingerprint = createHash("sha256").update(JSON.stringify(filePlan.preview)).digest("hex");
    const fileProposal = {...proposal,input:{...scope,steps:fileSteps,fingerprint:fileFingerprint}};
    const fileRun = {...step,input:{...step.input,fingerprint:fileFingerprint}};
    savedFile = {...file,taskRevision:file.taskRevision+2};
    assert.equal((await request(fileProposal)).status,400);
    assert.equal((await request(fileRun,"fixture-plan",stepPath)).status,503);
    supportsLocalSave = true;
    assert.equal((await request(fileProposal,"fixture-browser")).status,403);
    assert.equal((await request(fileProposal)).status,200);
    assert.equal((await request(fileRun,"fixture-agent",stepPath)).status,403);
    assert.deepEqual(await request(fileRun,"fixture-plan",stepPath),{status:200,cache:"no-store",body:{ok:true,value:{
      kind:"committed",operation:"data.save-local-source",fingerprint:fileFingerprint,step:1,
      approvalRevision:2,expiresAt,reference:savedFile,
    }}});
  } finally {
    retire();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("managed stdio exposes presentation only when both managed options are enabled", async () => {
  for (const [consent, presentation] of [[false, false], [false, true], [true, false], [true, true]]) {
    const client = new Client({name: "consent-catalog-fixture", version: "1.0.0"});
    try {
      await client.connect(new StdioClientTransport({command: process.execPath, args: ["--import", "tsx",
        path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")], stderr: "ignore", env: {
        AISB_HEADLESS_MODE: "managed", AISB_HEADLESS_ENABLE_MANAGED_CONSENT: consent ? "1" : "0",
        AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION: presentation ? "1" : "0",
        AISB_HEADLESS_MANAGED_ORIGIN: "https://127.0.0.1:1", AISB_HEADLESS_MANAGED_CREDENTIAL: "unused-fixture-value",
        AISB_HEADLESS_MANAGED_ORGANIZATION_ID: "fixture-organization", AISB_HEADLESS_MANAGED_WORKSPACE_ID: "fixture-workspace",
      }}));
      const names = (await client.listTools()).tools.map(tool => tool.name).sort();
      const expected = ["aisb_host_describe", "aisb_list_templates", "aisb_read_system",
        ...(consent ? ["aisb_list_windows", "aisb_release_window", "aisb_request_window", "aisb_window_status"] : []),
        ...(consent && presentation ? ["aisb_present_in_window", "aisb_renew_window", "aisb_window_context"] : [])].sort();
      assert.deepEqual(names, expected);
      if (consent) {
        const denied = await client.callTool({name: "aisb_list_windows", arguments: {hostIncarnationId: randomUUID(), workspaceId: "other-workspace"}});
        assert.equal(denied.isError, true);
        assert.deepEqual(denied.content, [{type: "text", text: '{"ok":false,"code":"headless.forbidden"}'}]);
      }
    } finally { await client.close(); }
  }
});

test("exact managed requests respect authentication, framing, authority lifetime and safe results", { timeout: 10_000 }, async () => {
  const org = createOrganizationId("managed-agent-fixture");
  const principalId = "synthetic-agent";
  const app = express();
  app.enable("case sensitive routing");
  app.use(createExpressSecurityMiddleware({ mode: "oidc-bearer", authRequired: true, httpsRequired: false,
    async verifyToken({token}): Promise<AuthContext> {
      if (token !== "fixture-agent" && token !== "fixture-browser")
        throw createSecurityApplicationError("security.invalid-token", "The token is invalid.");
      return {authenticated: true, authMethod: "oidc-bearer", oidcAccessTokenClientId: token,
        principal: {kind: "user", principalId, roles: [], scopes: []}};
    },
  }));
  let retired = false;
  const agent = {};
  let count = 0;
  let generalParser = 0;
  let enabled = true;
  let holdAuthoring = false;
  let wrongRecord = false;
  let wrongCapabilityScope = false;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const session = randomUUID();
  const tab = {hostIncarnationId, workspaceId: createWorkspaceId("fixture-workspace"), windowId: randomUUID(), uiIncarnationId: randomUUID()};
  let windowOutcome = tab;
  let windowCalls = 0;
  let windowAvailable = true;
  let deliveryEnabled = false;
  let wrongCommandReceipt = false;
  let wrongRenewedGeneration = false;
  const handlers: ManagedAgentRouteHandlers<typeof agent> = {
    hostIncarnationId,
    identify: ({auth, organization, organizationHeader}) =>
      auth?.oidcAccessTokenClientId === "fixture-agent" && organization?.organizationId === org &&
      organizationHeader === org ? agent : undefined,
    isCurrent: held => held === agent && !retired,
    window: {
      get deliveryEnabled() { return deliveryEnabled; },
      async execute(input, identity, suppliedSession, current) {
        windowCalls += 1;
        assert.equal(identity, agent);
        assert.equal(suppliedSession, session);
        assert.equal(current(), true);
        if (input.operation === "window.present") return {ok: true, value: {kind: "command", duplicate: false,
          receipt: {commandId: wrongCommandReceipt ? randomUUID() : input.input.commandId, sequence: 1, status: "accepted"}}};
        if (input.operation === "window.context") return {ok: true, value: {kind: "context",
          context: {view: "other", ready: true, dirtyNavigationBlocked: false}}};
        if (input.operation === "window.renew") {
          const {leaseId, generation, ...attempt} = input.input.target;
          return {ok: true, value: {kind:"request", request:{target:attempt, agentSessionId:randomUUID(),
            taskId:randomUUID(), status:"active", expiresAt:50_000},
            lease:{...attempt, leaseId, generation:wrongRenewedGeneration ? generation + 1 : generation}}};
        }
        return {ok: true, value: {kind: "windows", windows: [windowOutcome]}};
      },
      canPublish() { return windowAvailable; },
    },
    async read(input) {
      count += 1;
      if (input.operation === "plan.capabilities") return {ok:true, operation:input.operation, value:{
        workspaceId:wrongCapabilityScope ? createWorkspaceId("other-workspace") : input.input.workspaceId,
        actions:["systems.clone"], approval:"required",
      }};
      if (input.operation === "systems.read") {
        if (!wrongRecord) return {ok: false, code: "synthetic-private-driver-detail".repeat(6_000) as "headless.unavailable"};
        return {ok: true, operation: "systems.read", value: {systemId: "fixture.neighbor" as typeof input.input.systemId,
          name: "Private neighboring system", revision: 1, status: "draft"}};
      }
      if (input.operation !== "host.describe") return {ok: false, code: "headless.not-found"};
      return {ok: true, operation: input.operation, value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId, workspaces: [], operations: [],
      }};
    },
    async author(_input, _agent, current) {
      count += 1;
      assert.equal(current(), true);
      if (holdAuthoring) {
        entered.resolve();
        await release.promise;
        assert.equal(current(), false);
      }
      return {ok: true, value: {kind: "committed",
        reference: {systemId: "fixture.system", recordRevision: 1, revisionId: "fixture.revision"}}};
    },
  };
  const retire = registerManagedHeadlessAgentRoutes(app, () => enabled ? handlers : undefined);
  app.use(express.json({verify() {generalParser += 1;}}));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const { port } = address;
    async function send(relative: string, body: object | string, token = "fixture-agent", contentType = "application/json", connection?: string) {
      const response = await fetch(`http://127.0.0.1:${port}${relative}`, { method: "POST",
        headers: {...(token ? {authorization: `Bearer ${token}`} : {}), "x-organization-id": org, "content-type": contentType,
          ...(connection ? {[MANAGED_HEADLESS_AGENT_SESSION_HEADER]: connection} : {})},
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
      return {status: response.status, cache: response.headers.get("Cache-Control"), body: await response.json()};
    }
    const {read, author} = MANAGED_HEADLESS_AGENT_PATHS;
    const discovery = {version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {}};
    assert.equal((await send(read, discovery, "")).status, 401);
    assert.equal((await send(read, discovery, "fixture-browser")).status, 403);
    assert.equal((await send(read + "?credential=example", discovery)).status, 400);
    assert.equal((await send(read, discovery, "fixture-agent", "text/plain")).status, 415);
    assert.equal((await send(read, "x".repeat(8_193))).status, 413);
    assert.equal((await send(read, {...discovery, input: {role: "browser"}})).status, 400);
    assert.equal((await send(read, JSON.stringify(discovery, null, 2))).status, 400);
    assert.equal(count, 0);
    enabled = false;
    assert.equal((await send(read, discovery)).status, 404);
    enabled = true;
    const described = await send(read, discovery);
    assert.equal(described.status, 200);
    assert.equal(described.cache, "no-store");
    assert.deepEqual(described.body.value.operations, ["host.describe", "templates.list", "systems.read"]);
    const systemRead = {version: HEADLESS_CONTRACT_VERSION, operation: "systems.read",
      input: {hostIncarnationId, workspaceId: "fixture-workspace", systemId: "fixture.system"}};
    assert.deepEqual((await send(read, systemRead)).body, {ok: false, code: "headless.unavailable"});
    wrongRecord = true;
    assert.deepEqual((await send(read, systemRead)).body, {ok: false, code: "headless.unavailable"});
    assert.equal(generalParser, 0);
    const capabilities = {version:HEADLESS_CONTRACT_VERSION, operation:"plan.capabilities",
      input:{hostIncarnationId, workspaceId:tab.workspaceId}};
    assert.equal((await send(read, capabilities, "fixture-browser")).status, 403);
    assert.deepEqual((await send(read, capabilities)).body, {ok:true, operation:capabilities.operation,
      value:{workspaceId:tab.workspaceId, actions:["systems.clone"], approval:"required"}});
    wrongCapabilityScope = true;
    assert.deepEqual((await send(read, capabilities)).body, {ok:false, code:"headless.unavailable"});
    const windowPath = MANAGED_HEADLESS_AGENT_PATHS.window;
    const listTabs = {version: UI_CONTROL_VERSION, operation: "window.list", input: {hostIncarnationId, workspaceId: tab.workspaceId}};
    const invalidContext = {version: UI_CONTROL_VERSION, operation: "window.context", input: {target: {...tab,
      requestId: randomUUID(), attemptId: randomUUID(), leaseId: randomUUID(), generation: 1}}};
    assert.equal((await send(windowPath, listTabs)).status, 400);
    assert.equal((await send(windowPath, listTabs, "fixture-browser", "application/json", session)).status, 403);
    assert.equal((await send(windowPath, invalidContext, "fixture-agent", "application/json", session)).status, 400);
    assert.equal(windowCalls, 0);
    assert.deepEqual((await send(windowPath, listTabs, "fixture-agent", "application/json", session)).body,
      {ok: true, value: {kind: "windows", windows: [tab]}});
    windowOutcome = {...tab, workspaceId: createWorkspaceId("different-workspace")};
    assert.deepEqual((await send(windowPath, listTabs, "fixture-agent", "application/json", session)).body,
      {ok: false, code: "headless.unavailable"});
    deliveryEnabled = true;
    const present = {version: UI_CONTROL_VERSION, operation: "window.present", input: {
      target: invalidContext.input.target, commandId: randomUUID(),
      intent: {action: "open-system", systemId: "fixture.system", revisionId: "revision-1"},
    }};
    assert.equal((await send(windowPath, present, "fixture-agent", "application/json", session)).body.value.receipt.commandId,
      present.input.commandId);
    assert.equal((await send(windowPath, invalidContext, "fixture-agent", "application/json", session)).body.value.context.ready, true);
    const renew = {...invalidContext, operation:"window.renew"};
    const renewed = await send(windowPath, renew, "fixture-agent", "application/json", session);
    assert.equal(renewed.status, 200);
    assert.deepEqual(renewed.body.value.lease, renew.input.target);
    wrongRenewedGeneration = true;
    assert.deepEqual((await send(windowPath, renew, "fixture-agent", "application/json", session)).body,
      {ok:false, code:"headless.unavailable"});
    wrongCommandReceipt = true;
    assert.deepEqual((await send(windowPath, present, "fixture-agent", "application/json", session)).body,
      {ok: false, code: "headless.unavailable"});
    windowAvailable = false;
    assert.deepEqual((await send(windowPath, invalidContext, "fixture-agent", "application/json", session)).body,
      {ok: false, code: "headless.forbidden"});
    assert.deepEqual((await send(windowPath, listTabs, "fixture-agent", "application/json", session)).body,
      {ok: false, code: "headless.forbidden"});
    const request = {version: HEADLESS_CONTRACT_VERSION, operation: "systems.create",
      input: {hostIncarnationId, workspaceId: "fixture-workspace", name: "Synthetic", idempotencyKey: randomUUID(),
        templateId: "reference.secured-data-review@1.0.0"}};
    assert.equal((await send(author, request)).status, 200);
    holdAuthoring = true;
    const pending = send(author, request);
    await entered.promise;
    retired = true;
    release.resolve();
    assert.deepEqual((await pending).body, {ok: false, code: "headless.forbidden"});
    assert.equal(count, 7);
  } finally {
    release.resolve();
    retire();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
