import assert from "node:assert/strict";
import test, {mock} from "node:test";
import filesystem from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises";
import {existsSync, readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {ContextGenerationUseCase} from "../context-generation.use-case";
import {contextCommandDigest} from "../approved-context-generation-admission";
import {OwnedTaskReconcilerService} from "../../../services/runtime/owned-task-reconciler.service";
import {TaskPowerLifecycleService, type TaskPowerLifecyclePort} from "../../../services/runtime/task-power-lifecycle.service";
import type {ApprovedContextGenerationAdmission, ApprovedContextResultSaveAdmission, ContextResultByteStoragePort} from "../../../ports/context-management";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createOrganizationId} from "../../../../contracts/organization";
import type {StartContextGenerationCommand} from "../../../../contracts/context-management";
import {TaskType, type ContextGenerationTaskRequest} from "../../../../contracts/runtime";
import {readHeadlessPlanStepResult, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {createFilesystemArtifactObjectStorageAdapter, createFilesystemContextResultByteStorageAdapter,
  createFilesystemContextResultOutputSourceAdapter} from "../../../../adapters/storage/filesystem/artifact-store";
import type {ArtifactObjectStoragePort} from "../../../ports/storage";
import type {RuntimeTaskRegistryPort} from "../../../ports/runtime";
import {createPythonRuntimeTaskRegistryAdapter} from "../../../../adapters/runtime/python/createPythonRuntimeTaskRegistryAdapter";
import {createRuntimeTaskRegistryRouter} from "../../../../adapters/runtime/createRuntimeTaskRegistryRouter";

const workspaceId = createWorkspaceId("workspace.context-admission"), organizationId = createOrganizationId("org.context-admission");
const originalBytes = new TextEncoder().encode("text\nSynthetic release documentation.\n");
const hash = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const artifactId = "private/synthetic/context.csv";
test("known Context non-start wire reports require its capability and cannot disclose extra fields", () => {
  const exact = {hostIncarnationId: "95f65f77-e882-441a-a7db-cb0b99a5f1ad" as HeadlessHostIncarnationId,
    workspaceId, fingerprint: "a".repeat(64), approvalRevision: 2, step: 1};
  const result = {ok: false, code: "headless.not-started"};
  for (const options of [{allowContextPackGeneration: true}, {allowContextRagGeneration: true}])
    assert.deepEqual(readHeadlessPlanStepResult(result, exact, options), result);
  for (const options of [undefined, {}, {allowContextResultSave: true}, {allowContextRagGeneration: false}])
    assert.deepEqual(readHeadlessPlanStepResult(result, exact, options), {ok: false, code: "headless.unavailable"});
  for (const extra of [{detail: "private"}, {value: {}}, {taskId: "guessed-task"}, {path: "private"}])
    assert.deepEqual(readHeadlessPlanStepResult({...result, ...extra}, exact, {allowContextPackGeneration: true}),
      {ok: false, code: "headless.unavailable"});
  assert.deepEqual(readHeadlessPlanStepResult({ok: false, code: "headless.operation-unconfirmed"}, exact),
    {ok: false, code: "headless.operation-unconfirmed"});
});
function command(): StartContextGenerationCommand {return {kind: "markdown-context-pack", name: "Synthetic context",
  sources: [{artifactId}], chunking: {strategy: "topic-aware", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]},
  contextPack: {inputMode: "source-materials", method: "none", cleaningPreset: "standard"}};}
function ragCommand(): StartContextGenerationCommand {return {kind: "rag-database", name: "Synthetic retrieval",
  sources: [{artifactId}], chunking: {...command().chunking, strategy: "fixed-length"},
  embedding: {provider: "transformers", modelId: "local/test-embedding", batchSize: 2, device: "cpu"},
  sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false,
    requireConsentMetadata: false, includeSourceAttribution: true}};}

async function withHarness(run: (h: Awaited<ReturnType<typeof harness>>) => Promise<void>, withoutOwner = false, withoutModels = false, withoutSave = false) {
  const originalTemp = process.env.TEMP, originalTmp = process.env.TMP;
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "context-admission-test-")));
  process.env.TEMP = base; process.env.TMP = base;
  const h = await harness(base, withoutOwner, withoutModels, withoutSave);
  try {await run(h);} finally {
    await h.stop();
    if (originalTemp === undefined) delete process.env.TEMP; else process.env.TEMP = originalTemp;
    if (originalTmp === undefined) delete process.env.TMP; else process.env.TMP = originalTmp;
    // This empty sandbox was created by this test. Never inspect or clean any
    // retained application/offload tree outside its exact resolved root.
    assert.equal(await realpath(base), base);
    await rm(base, {recursive: true, force: true});
  }
}
async function harness(base: string, withoutOwner: boolean, withoutModels = false, withoutSave = false) {
  const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
  const context = {workspaceId, organizationId, principalId: "principal.synthetic", requestId: "caller-correlation"};
  let allowed = true, issueCount = 0, readCount = 0, dispatchCount = 0, statusCount = 0, cancelCount = 0, maximumReadBytes = 0;
  let taskId = randomUUID(), lastRequest: {requestId?: string; workspaceId?: string; payload: ContextGenerationTaskRequest} | undefined;
  let bytes = new Uint8Array(originalBytes), descriptorPatch: Record<string, unknown> = {}, bindingKey: string | undefined;
  let issue: () => Promise<"issued" | "denied" | "unconfirmed"> = async () => "issued";
  let dispatch: () => Promise<{requestId: string; status: string}> = async () => ({requestId: taskId, status: "queued"});
  let afterRead = () => {}, afterCatalog = () => {}, powerFails = false;
  let statusPatch: Record<string, unknown> = {}, cancelPatch: Record<string, unknown> = {}, powerCompletions = 0;
  let powerLifecycle: TaskPowerLifecyclePort | undefined;
  let sourceReader: ArtifactObjectStoragePort["retrieveArtifact"] | undefined;
  let installedStart: "accepted" | "unavailable" | "unconfirmed" = "accepted", installedSupported = true;
  let installedBridge: RuntimeTaskRegistryPort["startTaskWithoutInstalling"];
  let modelReference: string | undefined = path.join(base, "synthetic-installed-model"), modelChecks = 0;
  let afterModel = () => {};
  let outputReads = 0, resultWrites = 0;
  const resultRoot = path.join(base, "result-objects");
  const resultBytes = createFilesystemContextResultByteStorageAdapter({rootDirectory: resultRoot});
  const resultSource = createFilesystemContextResultOutputSourceAdapter();
  let publishHook: ContextResultByteStoragePort["publishResult"] | undefined;
  const useCase = new ContextGenerationUseCase({taskReconciler: withoutOwner ? undefined : reconciler,
    ...(withoutSave ? {} : {
      resultBytes: {async publishResult(input, supplied) {resultWrites++; return publishHook ? publishHook(input, supplied) : resultBytes.publishResult(input, supplied);}},
      resultSource: {readOutput(input) {outputReads++; return resultSource.readOutput(input);}},
    }),
    ...(withoutModels ? {} : {embeddingModels: {async resolveExistingModel(witness, modelContext, stillAllowed) {
      modelChecks++; assert.equal(witness.modelId, ragCommand().embedding!.modelId);
      assert.equal(modelContext.workspaceId, workspaceId); assert.ok(await stillAllowed()); afterModel();
      return modelReference ? {localModelReference: modelReference} : undefined;
    }}}),
    runtimeTaskRegistry: {
      get startTaskWithoutInstalling() {return installedSupported ? async (request: never) => {
        if (installedBridge) return installedBridge(request);
        if (installedStart !== "accepted") return {kind: installedStart};
        dispatchCount++; lastRequest = request as typeof lastRequest;
        assert.deepEqual(await readFile((lastRequest!.payload).sources[0].localPath), Buffer.from(originalBytes));
        return {kind: "accepted", value: await dispatch()};
      } : undefined;},
      async startTask(request) {
        dispatchCount++; lastRequest = request as typeof lastRequest;
        assert.deepEqual(await readFile((request.payload as ContextGenerationTaskRequest).sources[0].localPath), Buffer.from(originalBytes));
        return await dispatch() as never;
      },
      async getTaskStatus(id) {statusCount++; return {requestId: id, workspaceId, taskType: TaskType.CONTEXT_GENERATION,
        status: "running", concurrencyClass: "cpu-heavy", ...statusPatch} as never;},
      async cancelTask(id) {cancelCount++; return {requestId: id, status: "cancelled", cancelled: true, ...cancelPatch} as never;},
      async listTasks() {assert.fail("Start admission cannot discover or adopt existing tasks.");},
    },
    storageBindings: {async readArtifactStorageBindings() {return {ok: true, value: {artifactId, bindings: bindingKey
      ? [{artifactId, workspaceId, role: "primary", backing: {kind: "artifact-object", provider: "local", locator: bindingKey}}] : []}} as never;},
      async upsertArtifactStorageBinding() {assert.fail("Start cannot save a result.");}},
    storage: {
      async retrieveArtifact(request) {readCount++; assert.equal(request.key, artifactId);
        maximumReadBytes = request.maximumBytes;
        assert.ok([4 * 1024 * 1024, 64 * 1024 * 1024].includes(request.maximumBytes));
        if (sourceReader) return sourceReader(request, context);
        afterRead(); return {ok: true, value: {descriptor: {key: artifactId, mediaType: "text/csv", sizeBytes: bytes.length,
          metadata: {originalFileName: "synthetic.csv"}, ...descriptorPatch}, content: bytes}} as never;},
      async storeArtifact() {assert.fail("Start cannot publish or save an artifact.");},
      async deleteArtifact() {assert.fail("Start cannot delete source artifacts.");},
    } as never,
    artifactCatalog: {async readArtifactCatalogRecord() {afterCatalog(); return {ok: false, error: {code: "not-found", message: "Synthetic missing catalog"}} as never;},
      async appendArtifactCatalogRecord() {assert.fail("Review and separate save are required.");},
      async deleteArtifactCatalogRecord() {assert.fail("Source records are immutable inputs.");}},
    taskPowerLifecycle: {async startTask(...args) {if (powerFails) throw new Error("private/path synthetic bookkeeping failure");
      await powerLifecycle?.startTask(...args);},
      async completeTask(...args) {powerCompletions++; await powerLifecycle?.completeTask(...args);}},
  });
  const admission = (selectedCommand = command()): ApprovedContextGenerationAdmission => ({taskId, organizationId, workspaceId,
    principalId: context.principalId, commandDigest: contextCommandDigest(selectedCommand), sources: [{artifactId, storageKey: artifactId,
      digest: hash(originalBytes), sizeBytes: originalBytes.length, mediaType: "text/csv", format: "csv"}],
    ...(selectedCommand.kind === "rag-database" ? {embeddingModel: {modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-18T00:00:00.000Z",
      modelId: selectedCommand.embedding!.modelId, recordDigest: "sha256:" + "a".repeat(64)}} : {}),
    isCurrent: () => allowed, stillAllowed: async () => allowed,
    async issue() {issueCount++; return issue();}});
  return {base, useCase, context, reconciler, admission,
    resultRoot, resultBytes, resultCounts: () => ({outputReads, resultWrites}), setPublishHook(value: typeof publishHook) {publishHook = value;},
    taskId: () => taskId, nextTask() {taskId = randomUUID();},
    counts: () => ({issueCount, readCount, dispatchCount, statusCount, cancelCount}), lastRequest: () => lastRequest, maximumReadBytes: () => maximumReadBytes,
    setAllowed(value: boolean) {allowed = value;}, setBytes(value: Uint8Array) {bytes = value;},
    setDescriptor(value: Record<string, unknown>) {descriptorPatch = value;}, setBinding(value: string) {bindingKey = value;},
    setSourceReader(value: ArtifactObjectStoragePort["retrieveArtifact"]) {sourceReader = value;},
    setIssue(value: typeof issue) {issue = value;}, setDispatch(value: typeof dispatch) {dispatch = value;},
    setInstalledStart(value: typeof installedStart) {installedStart = value;}, setInstalledSupported(value: boolean) {installedSupported = value;},
    setInstalledBridge(value: typeof installedBridge) {installedBridge = value;},
    setAfterRead(value: typeof afterRead) {afterRead = value;}, setPowerFails(value: boolean) {powerFails = value;},
    setAfterCatalog(value: typeof afterCatalog) {afterCatalog = value;}, mutateReturnedBytes() {bytes.fill(120);},
    setStatus(value: Record<string, unknown>) {statusPatch = value;}, setCancel(value: Record<string, unknown>) {cancelPatch = value;},
    powerCompletions: () => powerCompletions,
    setPowerLifecycle(value: TaskPowerLifecyclePort) {powerLifecycle = value;},
    setModelReference(value: string | undefined) {modelReference = value;}, modelChecks: () => modelChecks,
    setAfterModel(value: typeof afterModel) {afterModel = value;},
    async roots() {return await readdir(base);},
    async stop() {await reconciler.settleAfterRuntimeStop(["python"]);},
  };
}

test("approved Context dispatch uses exact staged bytes and reserved identity once, retaining explicit result review", async () => withHarness(async h => {
  const selected = command(), admission = h.admission(selected);
  const result = await h.useCase.startAdmittedContext(selected, h.context, admission);
  assert.ok(result.ok); assert.equal(result.value.requestId, h.taskId());
  assert.equal(h.lastRequest()?.requestId, h.taskId()); assert.equal(h.lastRequest()?.workspaceId, workspaceId);
  assert.equal(h.lastRequest()?.payload.contextPack?.method, "none");
  assert.equal(h.lastRequest()?.payload.sources[0].sourceDigest, hash(originalBytes));
  assert.equal(h.maximumReadBytes(), 4 * 1024 * 1024);
  assert.equal((await h.roots()).length, 1);
  assert.equal((await h.useCase.startAdmittedContext(selected, h.context, admission)).ok, false);
  assert.deepEqual(h.counts(), {issueCount: 1, readCount: 1, dispatchCount: 1, statusCount: 0, cancelCount: 0});
  await h.stop(); assert.deepEqual(await h.roots(), []);
}));

test("the Context owner proves only fresh pre-dispatch or closed no-POST non-starts, never duplicate or unknown attempts", async () => {
  for (const variant of ["missing-model", "missing-runtime", "closed-unavailable", "unknown-issue", "unknown-dispatch", "accepted"] as const)
    await withHarness(async h => {
      const selected = variant === "missing-model" ? ragCommand() : command();
      if (variant === "missing-model") h.setModelReference(undefined);
      if (variant === "missing-runtime") h.setInstalledSupported(false);
      if (variant === "closed-unavailable") h.setInstalledStart("unavailable");
      if (variant === "unknown-issue") h.setIssue(async () => "unconfirmed");
      if (variant === "unknown-dispatch") h.setInstalledBridge(async () => ({kind: "unconfirmed", admittedStartOutcome: "not-started"} as never));
      const result = await h.useCase.startAdmittedContext(selected, h.context, h.admission(selected));
      const proven = ["missing-model", "missing-runtime", "closed-unavailable"].includes(variant);
      assert.equal(result.admittedStartOutcome, proven ? "not-started" : undefined, variant);
      assert.equal(result.ok, variant === "accepted", variant);
      if (variant === "missing-model" || variant === "missing-runtime") {
        assert.equal(h.counts().readCount, 0); assert.equal(h.counts().dispatchCount, 0); assert.equal(h.counts().issueCount, 0);
      }
      if (variant === "unknown-issue" || variant === "unknown-dispatch" || variant === "accepted" || variant === "closed-unavailable") {
        const duplicate = await h.useCase.startAdmittedContext(selected, h.context, h.admission(selected));
        assert.equal(duplicate.ok, false); assert.equal(duplicate.admittedStartOutcome, undefined, variant);
      }
    });
});

test("declared source terms are copied from admission instead of unbound object metadata", async () => withHarness(async h => {
  const selected = command(), original = h.admission(selected);
  const source = {...original.sources[0], declaredLicense: "LicenseRef-Proprietary"};
  const admission = {...original, sources: [source]};
  h.setDescriptor({metadata: {originalFileName: "synthetic.csv", license: "cc0-1.0"}});
  h.setAfterRead(() => {source.declaredLicense = "changed-after-admission";});
  assert.ok((await h.useCase.startAdmittedContext(selected, h.context, admission)).ok);
  assert.deepEqual(h.lastRequest()?.payload.sources[0].sourceInformation, {license: "LicenseRef-Proprietary"});
  const before = h.counts();
  assert.equal((await h.useCase.start(selected, {...h.context, requestId: h.taskId()})).ok, false);
  assert.deepEqual(h.counts(), before, "An ordinary correlation cannot replace an already issued Headless task.");
  assert.deepEqual(await h.useCase.readAdmittedContextTask(h.taskId(), h.context), {taskId: h.taskId(), state: "running", review: null});
  const reads = h.counts().statusCount;
  assert.equal(await h.useCase.readAdmittedContextTask(h.taskId(), {...h.context, principalId: "foreign"}), undefined);
  assert.equal(await h.useCase.readAdmittedContextTask(randomUUID(), h.context), undefined);
  assert.equal(h.counts().statusCount, reads);
}));

test("malformed or secret-like declared terms deny before source access", async () => withHarness(async h => {
  const original = h.admission();
  for (const declaredLicense of ["", " padded ", "x".repeat(513), "hf_" + "a".repeat(32), "bad\u0000terms", {license: "mit"}])
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context,
      {...original, sources: [{...original.sources[0], declaredLicense}]} as never)).ok, false);
  assert.equal(h.counts().readCount, 0); assert.equal(h.counts().issueCount, 0); assert.equal(h.counts().dispatchCount, 0);
}));

test("installed-only support is required before bytes, proven refusals clean staging and uncertain starts retain it", async () => {
  await withHarness(async h => {
    h.setInstalledSupported(false);
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
    assert.equal(h.counts().readCount, 0); assert.equal(h.counts().issueCount, 0); assert.deepEqual(await h.roots(), []);
  });
  await withHarness(async h => {
    h.setInstalledStart("unavailable");
    const admission = h.admission();
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, admission)).ok, false);
    assert.equal(h.counts().issueCount, 1); assert.equal(h.counts().dispatchCount, 0); assert.deepEqual(await h.roots(), []);
    h.setInstalledStart("accepted");
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, admission)).ok, false);
    assert.equal(h.counts().readCount, 1); assert.equal(h.counts().dispatchCount, 0);
  });
  await withHarness(async h => {
    h.setInstalledStart("unconfirmed");
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
    assert.equal((await h.roots()).length, 1); assert.equal(h.counts().statusCount, 0);
    await h.stop(); assert.deepEqual(await h.roots(), []);
  });
});

test("actual Context owner, router and Python registry carry the staged command through installed-only dispatch", async () => withHarness(async h => {
  let installs = 0, verifications = 0, dispatches = 0;
  const python = createPythonRuntimeTaskRegistryAdapter({async startTask() {assert.fail("Approved work cannot use ordinary Python start.");},
    async startTaskWithoutInstalling(request) {
    dispatches++;
    assert.equal(request.taskType, "generate-context-artifact"); assert.equal(request.requestId, h.taskId());
    const payload = request.payload as ContextGenerationTaskRequest;
    assert.equal(payload.contextPack?.method, "none");
    assert.deepEqual(await readFile(payload.sources[0].localPath), Buffer.from(originalBytes));
    return {requestId: request.requestId, taskType: request.taskType, accepted: true, status: "queued"};
  }} as never, {async ensureRuntimeReady() {installs++;}, async ensureRuntimeReadyWithoutInstalling() {verifications++;}});
  const router = createRuntimeTaskRegistryRouter({python, image: {} as never});
  h.setInstalledBridge(router.startTaskWithoutInstalling);
  const result = await h.useCase.startAdmittedContext(command(), h.context, h.admission());
  assert.ok(result.ok); assert.equal(installs, 0); assert.equal(verifications, 1); assert.equal(dispatches, 1);
  assert.equal((await h.roots()).length, 1);
  await h.stop(); assert.deepEqual(await h.roots(), []);
}));

test("missing owners, malformed capabilities and changed scope deny before source access", async () => {
  await withHarness(async h => {
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
    assert.equal(h.counts().readCount, 0); assert.deepEqual(await h.roots(), []);
  }, true);
  await withHarness(async h => {
    const selected = command(), original = h.admission(selected);
    for (const altered of [{...original, issue: undefined}, {...original, workspaceId: "foreign"}, {...original, principalId: "foreign"},
      {...original, organizationId: "foreign"}, {...original, commandDigest: "sha256:" + "0".repeat(64)},
      {...original, sources: [{...original.sources[0], storageKey: "../private"}]},
      {...original, sources: [{...original.sources[0], sizeBytes: 4 * 1024 * 1024 + 1}]},
      JSON.parse(JSON.stringify(original)),
    ]) assert.equal((await h.useCase.startAdmittedContext(selected, h.context, altered as never)).ok, false);
    let getters = 0; const accessor = {...original};
    Object.defineProperty(accessor, "issue", {enumerable: true, get() {getters++; return original.issue;}});
    assert.equal((await h.useCase.startAdmittedContext(selected, h.context, accessor)).ok, false); assert.equal(getters, 0);
    assert.equal((await h.useCase.startAdmittedContext({...selected, instructions: "publish private input"} as never, h.context, original)).ok, false);
    assert.equal((await h.useCase.startAdmittedContext({...selected, contextPack: {...selected.contextPack, instructions: "publish"}} as never, h.context, original)).ok, false);
    assert.equal(h.counts().readCount, 0); assert.equal(h.counts().dispatchCount, 0); assert.deepEqual(await h.roots(), []);
  });
});

test("private RAG command witnesses bind exact model, device and source checks without claiming model readiness", async () => {
  await withHarness(async h => {
    const selected = ragCommand();
    assert.equal((await h.useCase.startAdmittedContext(selected, h.context, h.admission(selected))).ok, true);
    assert.deepEqual(h.lastRequest()?.payload.embedding, {...selected.embedding, localModelReference: path.join(h.base, "synthetic-installed-model")});
    assert.deepEqual(h.lastRequest()?.payload.sourceChecks, selected.sourceChecks);
  });
  await withHarness(async h => {
    const selected = ragCommand(), admission = h.admission(selected);
    for (const altered of [
      {...selected, embedding: {...selected.embedding, modelId: "local/different-model"}},
      {...selected, sourceChecks: {...selected.sourceChecks, requireLicenseMetadata: true}},
      {...selected, sourceChecks: {...selected.sourceChecks, instructions: "publish"}},
    ]) assert.equal((await h.useCase.startAdmittedContext(altered as never, h.context, admission)).ok, false);
    for (const embedding of [{...selected.embedding, provider: "different"}, {...selected.embedding, batchSize: 33}, {...selected.embedding, device: "auto"}]) {
      const unsupported = {...selected, embedding} as StartContextGenerationCommand;
      assert.equal((await h.useCase.startAdmittedContext(unsupported, h.context, h.admission(unsupported))).ok, false);
    }
    assert.equal(h.counts().readCount, 0); assert.equal(h.counts().dispatchCount, 0);
  });
});

test("admitted RAG needs a current model witness and checked local reference before source staging or issue", async () => {
  await withHarness(async h => {
    const selected = ragCommand(), {embeddingModel: _model, ...missing} = h.admission(selected);
    assert.equal((await h.useCase.startAdmittedContext(selected, h.context, missing)).ok, false);
    assert.equal(h.modelChecks(), 0); assert.equal(h.counts().readCount, 0);
    h.setModelReference(undefined);
    assert.equal((await h.useCase.startAdmittedContext(selected, h.context, h.admission(selected))).ok, false);
    assert.equal(h.modelChecks(), 1); assert.equal(h.counts().readCount, 0); assert.equal(h.counts().issueCount, 0);
    h.setModelReference("relative/model");
    assert.equal((await h.useCase.startAdmittedContext(selected, h.context, h.admission(selected))).ok, false);
    assert.equal(h.counts().readCount, 0);
    h.setModelReference(path.join(h.base, "synthetic-installed-model")); h.setAfterModel(() => h.setAllowed(false));
    assert.equal((await h.useCase.startAdmittedContext(selected, h.context, h.admission(selected))).ok, false);
    assert.equal(h.counts().readCount, 0); assert.equal(h.counts().dispatchCount, 0); assert.deepEqual(await h.roots(), []);
  });
  await withHarness(async h => {
    assert.equal((await h.useCase.startAdmittedContext(ragCommand(), h.context, h.admission(ragCommand()))).ok, false);
    assert.equal(h.counts().readCount, 0); assert.equal(h.counts().issueCount, 0);
  }, false, true);
});

test("public Context generation cannot supply the private installed model reference", async () => withHarness(async h => {
  const selected = ragCommand();
  const result = await h.useCase.start({...selected, embedding: {...selected.embedding, localModelReference: path.join(h.base, "private-injected-model")}} as never, h.context);
  assert.equal(result.ok, false); assert.equal(h.modelChecks(), 0); assert.equal(h.counts().readCount, 0);
  assert.equal(h.counts().dispatchCount, 0); assert.equal(JSON.stringify(result).includes("private-injected-model"), false);
}));

test("admitted RAG review binds logical model and source policy without exporting the private reference", async () => {
  for (const variant of ["attribution", "no-attribution", "wrong-model", "private-reference", "unexpected-attribution", "changed-license",
    "changed-source-policy", "reordered-policy"]) await withHarness(async h => {
    const selected = ragCommand(), includeAttribution = !["no-attribution", "unexpected-attribution"].includes(variant);
    const checks = {...selected.sourceChecks!, includeSourceAttribution: includeAttribution};
    const chosen = {...selected, sourceChecks: checks};
    const original = h.admission(chosen), admission = {...original, sources: original.sources.map(source => ({...source, declaredLicense: "LicenseRef-Proprietary"}))};
    const bytes = Buffer.from("Synthetic runtime output; worker is simulated in this test.");
    h.setDispatch(async () => {
      await writeFile(path.join(h.lastRequest()!.payload.runtime.runtimeWorkingDirectory, "synthetic.lancedb.zip"), bytes);
      return {requestId: h.taskId(), status: "queued"};
    });
    assert.ok((await h.useCase.startAdmittedContext(chosen, h.context, admission)).ok, variant);
    const source = h.lastRequest()!.payload.sources[0];
    const common = {artifactId: source.artifactId, digest: source.sourceDigest, mediaType: source.mediaType, sizeBytes: source.sizeBytes};
    const actualPolicy = variant === "reordered-policy" ? {includeSourceAttribution: checks.includeSourceAttribution,
      requireConsentMetadata: checks.requireConsentMetadata, requireLicenseMetadata: checks.requireLicenseMetadata,
      allowedLanguages: checks.allowedLanguages, preset: checks.preset} : {...checks,
        ...(variant === "changed-source-policy" ? {requireConsentMetadata: true} : {})};
    h.setStatus({status: "succeeded", data: {
      output: {name: "synthetic.lancedb.zip", outputHandle: "synthetic.lancedb.zip",
        mediaType: "application/vnd.ai-system-builder.rag-database+lancedb+zip", sizeBytes: bytes.length, digest: hash(bytes)},
      sourceInspections: [{...common, ready: true, sourceKind: "structured", format: "csv", textFields: ["text"], alreadyChunked: false,
        chunkCount: 1, sourceInformation: {license: "LicenseRef-Proprietary"}}],
      preview: {kind: "rag-database", name: chosen.name, sourceCount: 1, manualEntryCount: 0, chunkCount: 1,
        items: [{id: "chunk.synthetic", kind: "chunk", text: "Synthetic answer", citations: [{sourceArtifactId: source.artifactId, chunkIndex: 0}]}]},
      manifest: {schemaVersion: "1", kind: "rag-database", name: chosen.name,
        mediaType: "application/vnd.ai-system-builder.rag-database+lancedb+zip", createdAt: "2026-11-18T00:00:00.000Z",
        sources: [{...common, chunkCount: 1, chunkingMode: "extracted", ...(includeAttribution || variant === "unexpected-attribution"
          ? {sourceInformation: {license: variant === "changed-license" ? "cc0-1.0" : "LicenseRef-Proprietary"}} : {})}],
        manualEntries: [], chunking: chosen.chunking, sourceChecks: actualPolicy,
        embedding: {provider: "transformers", modelId: variant === "wrong-model" ? "local/other" : chosen.embedding!.modelId, dimensions: 3,
          ...(variant === "private-reference" ? {localModelReference: path.join(h.base, "synthetic-installed-model")} : {})}},
    }});
    const review = await h.useCase.read(h.taskId(), h.context);
    const expected = ["attribution", "no-attribution", "reordered-policy"].includes(variant);
    assert.equal(review.ok, expected, variant);
    if (review.ok) {
      assert.equal(review.value.state, "review-required", variant);
      const task = await h.useCase.readAdmittedContextTask(h.taskId(), h.context);
      assert.equal(task?.state, "review-required", variant);
      assert.equal(task?.review?.kind, "rag-database", variant);
      assert.equal(task?.review?.requiresExplicitSave, true);
      assert.doesNotMatch(JSON.stringify(task), /localModelReference|synthetic-installed-model|Synthetic answer|sourceInformation/);
    }
    assert.equal(JSON.stringify(review).includes("synthetic-installed-model"), false, variant);
  });
});

async function prepareReviewedSave(h: Awaited<ReturnType<typeof harness>>) {
  const selected = ragCommand(), bytes = Buffer.from("Synthetic reviewed Context result; no real embedding model is executed.");
  const handle = "synthetic.lancedb.zip";
  h.setDispatch(async () => {
    await writeFile(path.join(h.lastRequest()!.payload.runtime.runtimeWorkingDirectory, handle), bytes);
    return {requestId: h.taskId(), status: "queued"};
  });
  assert.ok((await h.useCase.startAdmittedContext(selected, h.context, h.admission(selected))).ok);
  const source = h.lastRequest()!.payload.sources[0];
  const common = {artifactId: source.artifactId, digest: source.sourceDigest, mediaType: source.mediaType, sizeBytes: source.sizeBytes};
  h.setStatus({status: "succeeded", data: {
    output: {name: handle, outputHandle: handle, mediaType: "application/vnd.ai-system-builder.rag-database+lancedb+zip", sizeBytes: bytes.length, digest: hash(bytes)},
    sourceInspections: [{...common, ready: true, sourceKind: "structured", format: "csv", textFields: ["text"], alreadyChunked: false, chunkCount: 1}],
    preview: {kind: "rag-database", name: selected.name, sourceCount: 1, manualEntryCount: 0, chunkCount: 1,
      items: [{id: "synthetic.chunk", kind: "chunk", text: "Synthetic answer", citations: [{sourceArtifactId: source.artifactId, chunkIndex: 0}]}]},
    manifest: {schemaVersion: "1", kind: "rag-database", name: selected.name,
      mediaType: "application/vnd.ai-system-builder.rag-database+lancedb+zip", createdAt: "2026-11-18T00:00:00.000Z",
      sources: [{...common, chunkCount: 1, chunkingMode: "extracted"}], manualEntries: [], chunking: selected.chunking,
      sourceChecks: selected.sourceChecks, embedding: {provider: "transformers", modelId: selected.embedding!.modelId, dimensions: 3}},
  }});
  const read = await h.useCase.read(h.taskId(), h.context);
  assert.ok(read.ok); assert.equal(read.value.state, "review-required");
  const review = h.useCase.peekAdmittedContextReview(h.taskId(), h.context)!;
  assert.ok(review);
  let saveIssues = 0, saveCommits = 0;
  const effectId = randomUUID();
  let issue: ApprovedContextResultSaveAdmission["issue"] = async () => "issued";
  let commit: ApprovedContextResultSaveAdmission["commit"] = async artifact => artifact;
  const admission: ApprovedContextResultSaveAdmission = {effectId, taskId: h.taskId(), reportFingerprint: review.reportFingerprint,
    organizationId, workspaceId, principalId: h.context.principalId, isCurrent: () => true, stillAllowed: async () => true,
    async issue() {saveIssues++; return issue();}, async commit(artifact) {saveCommits++; return commit(artifact);}};
  const request = {taskId: h.taskId(), reportFingerprint: review.reportFingerprint};
  const outputPath = path.join(h.lastRequest()!.payload.runtime.runtimeWorkingDirectory, handle);
  return {request, admission, bytes, outputPath, key: `workspaces/${workspaceId}/artifacts/context/${effectId.replace(/-/g, "")}`,
    counts: () => ({saveIssues, saveCommits, ...h.resultCounts()}), setSaveIssue(value: typeof issue) {issue = value;}, setCommit(value: typeof commit) {commit = value;},
    save: (provided = admission) => h.useCase.saveAdmittedContextResult(request, h.context, provided)};
}

test("admitted Context save publishes once after exact review and commits without ordinary metadata writes", async () => withHarness(async h => {
  const f = await prepareReviewedSave(h);
  const saved = await f.save();
  assert.ok(saved.ok); assert.equal(saved.value.state, "saved");
  assert.deepEqual(f.counts(), {saveIssues: 1, saveCommits: 1, outputReads: 1, resultWrites: 1});
  assert.deepEqual(await readFile(path.join(h.resultRoot, f.key)), f.bytes);
  assert.equal(existsSync(f.outputPath), false);
  assert.ok((await f.save()).ok);
  assert.equal((await f.save({...f.admission, effectId: randomUUID()})).ok, false);
  assert.deepEqual(f.counts(), {saveIssues: 1, saveCommits: 1, outputReads: 1, resultWrites: 1});
}));

test("admitted Context save rejects stale review, foreign actor and missing support before issue or output reads", async () => {
  await withHarness(async h => {
    const f = await prepareReviewedSave(h);
    for (const patch of [{reportFingerprint: "b".repeat(64)}, {taskId: randomUUID()}, {principalId: "foreign"},
      {workspaceId: createWorkspaceId("foreign")}, {organizationId: createOrganizationId("foreign")}, {effectId: "invalid"},
      {isCurrent: () => false}, {stillAllowed: async () => false}])
      assert.equal((await f.save({...f.admission, ...patch})).ok, false);
    assert.deepEqual(f.counts(), {saveIssues: 0, saveCommits: 0, outputReads: 0, resultWrites: 0});
  });
  await withHarness(async h => {
    const f = await prepareReviewedSave(h);
    assert.equal(h.useCase.peekAdmittedContextSaveInputs(h.taskId(), h.context), undefined);
    assert.equal((await f.save()).ok, false);
    assert.deepEqual(f.counts(), {saveIssues: 0, saveCommits: 0, outputReads: 0, resultWrites: 0});
  }, false, false, true);
});

for (const failure of ["issue-unconfirmed", "lost-byte-reply", "wrong-byte-ack", "changed-output", "commit-lost"] as const) {
  test(`admitted Context save retains ${failure} and forbids duplicate saves or ordinary cleanup bypass`, async () => withHarness(async h => {
    const f = await prepareReviewedSave(h);
    if (failure === "issue-unconfirmed") f.setSaveIssue(async () => "unconfirmed");
    if (failure === "lost-byte-reply") h.setPublishHook(async (input, context) => {
      assert.ok((await h.resultBytes.publishResult(input, context)).ok);
      throw new Error("private/path synthetic lost acknowledgement");
    });
    if (failure === "wrong-byte-ack") h.setPublishHook(async (input, context) => {
      const result = await h.resultBytes.publishResult(input, context); assert.ok(result.ok);
      return {...result, value: {...result.value, sizeBytes: result.value.sizeBytes! + 1}};
    });
    if (failure === "changed-output") await writeFile(f.outputPath, new Uint8Array(f.bytes.length).fill(0));
    if (failure === "commit-lost") f.setCommit(async () => {throw new Error("private/path synthetic metadata acknowledgement");});
    const result = await f.save(); assert.equal(result.ok, false); assert.doesNotMatch(JSON.stringify(result), /private\/path/);
    const counts = f.counts();
    assert.equal((await f.save()).ok, false);
    assert.equal((await f.save({...f.admission, effectId: randomUUID()})).ok, false);
    for (const action of ["save", "discard", "cancel"] as const) assert.equal((await h.useCase[action](h.taskId(), h.context)).ok, false);
    assert.deepEqual(f.counts(), counts);
    assert.ok(existsSync(f.outputPath));
    assert.equal(h.counts().cancelCount, 0);
    if (["lost-byte-reply", "wrong-byte-ack", "commit-lost"].includes(failure)) assert.deepEqual(await readFile(path.join(h.resultRoot, f.key)), f.bytes);
  }));
}

test("a proven pre-issue Context save denial permits a fresh approved attempt without byte effects", async () => withHarness(async h => {
  const f = await prepareReviewedSave(h);
  f.setSaveIssue(async () => "denied");
  assert.equal((await f.save()).ok, false);
  assert.deepEqual(f.counts(), {saveIssues: 1, saveCommits: 0, outputReads: 0, resultWrites: 0});
  f.setSaveIssue(async () => "issued");
  assert.ok((await f.save()).ok);
  assert.deepEqual(f.counts(), {saveIssues: 2, saveCommits: 1, outputReads: 1, resultWrites: 1});
}));

test("a confirmed Context save survives outward permission loss and can later replay without another write", async () => withHarness(async h => {
  const f = await prepareReviewedSave(h); let allowed = true;
  const admission = {...f.admission, isCurrent: () => allowed};
  f.setCommit(async artifact => {allowed = false; return artifact;});
  assert.equal((await f.save(admission)).ok, false);
  assert.deepEqual(await readFile(path.join(h.resultRoot, f.key)), f.bytes);
  allowed = true;
  const replay = await f.save(admission);
  assert.ok(replay.ok); assert.equal(replay.value.state, "saved");
  assert.deepEqual(f.counts(), {saveIssues: 1, saveCommits: 1, outputReads: 1, resultWrites: 1});
}));

test("concurrent Context saves cannot dispatch a second effect while publication awaits", async () => withHarness(async h => {
  const f = await prepareReviewedSave(h);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), waiting = new Promise<void>(resolve => {entered = resolve;});
  h.setPublishHook(async (input, context) => {entered(); await gate; return h.resultBytes.publishResult(input, context);});
  const first = f.save(); await waiting;
  const second = f.save({...f.admission, effectId: randomUUID()});
  release(); assert.ok((await first).ok); assert.equal((await second).ok, false);
  assert.deepEqual(f.counts(), {saveIssues: 1, saveCommits: 1, outputReads: 1, resultWrites: 1});
}));

test("a Context staging cleanup error cannot erase or repeat its already committed save", async () => withHarness(async h => {
  const f = await prepareReviewedSave(h), actualRemove = filesystem.rm;
  let cleanupFailures = 0;
  const replacement = mock.method(filesystem, "rm", async (...args: Parameters<typeof filesystem.rm>) => {
    if (String(args[0]) === path.dirname(f.outputPath)) {cleanupFailures++; throw new Error("private/path synthetic cleanup refusal");}
    return actualRemove(...args);
  });
  syncBuiltinESMExports();
  try {
    const result = await f.save();
    assert.ok(result.ok); assert.equal(result.value.state, "saved");
    assert.equal(cleanupFailures, 1);
    assert.ok(existsSync(f.outputPath), "Unretired staging stays owned; committed bytes must not be compensated.");
    assert.deepEqual(await readFile(path.join(h.resultRoot, f.key)), f.bytes);
    assert.ok((await f.save()).ok);
    assert.deepEqual(f.counts(), {saveIssues: 1, saveCommits: 1, outputReads: 1, resultWrites: 1});
    assert.doesNotMatch(JSON.stringify(result), /private\/path/);
  } finally {replacement.mock.restore(); syncBuiltinESMExports();}
}));

test("changed source bytes, descriptor, format and binding deny before one-use issuance", async () => {
  for (const patch of [{key: "private/foreign.csv"}, {sizeBytes: originalBytes.length + 1}, {mediaType: "text/plain"}]) await withHarness(async h => {
    h.setDescriptor(patch); const result = await h.useCase.startAdmittedContext(command(), h.context, h.admission());
    assert.equal(result.ok, false); assert.equal(h.counts().issueCount, 0); assert.equal(h.counts().dispatchCount, 0); assert.deepEqual(await h.roots(), []);
  });
  await withHarness(async h => {
    h.setBytes(new TextEncoder().encode("text\nChanged source of the same scope.\n"));
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
    assert.equal(h.counts().dispatchCount, 0); assert.deepEqual(await h.roots(), []);
  });
  await withHarness(async h => {
    h.setBinding("private/changed-binding.csv");
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
    assert.equal(h.counts().readCount, 0); assert.equal(h.counts().issueCount, 0); assert.deepEqual(await h.roots(), []);
  });
  await withHarness(async h => {
    const admission = h.admission();
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, {...admission, sources: [{...admission.sources[0], format: "json"}]})).ok, false);
    assert.equal(h.counts().issueCount, 0); assert.deepEqual(await h.roots(), []);
  });
});

test("revocation after source access or denied issuance cleans only this new attempt without dispatch", async () => {
  await withHarness(async h => {
    h.setAfterRead(() => h.setAllowed(false));
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
    assert.equal(h.counts().issueCount, 0); assert.equal(h.counts().dispatchCount, 0); assert.deepEqual(await h.roots(), []);
  });
  await withHarness(async h => {
    h.setIssue(async () => "denied");
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
    assert.equal(h.counts().issueCount, 1); assert.equal(h.counts().dispatchCount, 0); assert.deepEqual(await h.roots(), []);
  });
});

test("optional descriptor MIME/size use the approved source witness while actual bytes stay exact", async () => withHarness(async h => {
  h.setDescriptor({mediaType: undefined, sizeBytes: undefined});
  assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, true);
  assert.equal(h.lastRequest()?.payload.sources[0].mediaType, "text/csv");
  assert.equal(h.lastRequest()?.payload.sources[0].sourceDigest, hash(originalBytes));
}));

test("the real filesystem object reader admits approved source bytes without inventing descriptor MIME", async () => withHarness(async h => {
  const objects = path.join(h.base, "objects"), sourcePath = path.join(objects, ...artifactId.split("/"));
  await mkdir(path.dirname(sourcePath), {recursive: true}); await writeFile(sourcePath, originalBytes);
  const storage = createFilesystemArtifactObjectStorageAdapter({rootDirectory: objects});
  h.setSourceReader(storage.retrieveArtifact.bind(storage));
  const result = await h.useCase.startAdmittedContext(command(), h.context, h.admission());
  assert.equal(result.ok, true);
  assert.equal(h.lastRequest()?.payload.sources[0].mediaType, "text/csv");
  await h.stop();
  assert.deepEqual(await h.roots(), ["objects"]);
  assert.deepEqual(await readFile(sourcePath), Buffer.from(originalBytes), "Owned staging cleanup must preserve the original source.");
}));

test("uncertain issuance retains new staging until its Python owner stops without task discovery or adoption", async () => withHarness(async h => {
  h.setIssue(async () => "unconfirmed");
  const selected = command(), admission = h.admission();
  assert.equal((await h.useCase.startAdmittedContext(selected, h.context, admission)).ok, false);
  assert.equal((await h.roots()).length, 1); assert.equal(h.reconciler.status.pending, 1);
  await h.reconciler.reconcileNow(); await h.reconciler.cancelAndReconcile();
  await h.reconciler.settleAfterRuntimeStop(["image"]);
  assert.equal((await h.roots()).length, 1);
  assert.equal((await h.useCase.startAdmittedContext(selected, h.context, admission)).ok, false);
  assert.deepEqual(h.counts(), {readCount: 1, issueCount: 1, dispatchCount: 0, statusCount: 0, cancelCount: 0});
  await h.stop(); assert.deepEqual(await h.roots(), []); assert.equal(h.reconciler.status.pending, 0);
}));

test("lost or mismatched start replies retain the exact owned attempt and never repeat or adopt a task", async () => {
  for (const kind of ["lost", "different-id", "wrong-state"] as const) await withHarness(async h => {
    h.setDispatch(async () => {if (kind === "lost") throw new Error("private/path synthetic lost acknowledgement");
      return {requestId: kind === "different-id" ? randomUUID() : h.taskId(), status: kind === "wrong-state" ? "succeeded" : "queued"};});
    const admission = h.admission();
    const result = await h.useCase.startAdmittedContext(command(), h.context, admission);
    assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes("private/path"), false);
    assert.equal((await h.roots()).length, 1);
    assert.equal((await h.useCase.read(h.taskId(), h.context)).ok, false);
    assert.equal((await h.useCase.cancel(h.taskId(), h.context)).ok, false);
    assert.equal((await h.useCase.startAdmittedContext(command(), h.context, admission)).ok, false);
    await h.reconciler.reconcileNow();
    assert.deepEqual(h.counts(), {readCount: 1, issueCount: 1, dispatchCount: 1, statusCount: 0, cancelCount: 0});
    await h.stop(); assert.deepEqual(await h.roots(), []);
  });
});

test("in-flight command, source and correlation mutations cannot replace copied approved inputs", async () => withHarness(async h => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), waiting = new Promise<void>(resolve => {entered = resolve;});
  h.setIssue(async () => {entered(); await gate; return "issued";});
  const selected = command(), admission = h.admission(selected), context = {...h.context};
  const first = h.useCase.startAdmittedContext(selected, context, admission); await waiting;
  assert.equal((await h.useCase.startAdmittedContext(selected, context, admission)).ok, false);
  (selected as {name: string}).name = "Changed after acceptance";
  (admission.sources[0] as {digest: string}).digest = "sha256:" + "0".repeat(64);
  context.requestId = "changed-caller-correlation"; context.workspaceId = createWorkspaceId("foreign");
  release(); assert.equal((await first).ok, true);
  assert.equal(h.lastRequest()?.payload.name, "Synthetic context"); assert.equal(h.lastRequest()?.workspaceId, workspaceId);
  assert.equal(h.lastRequest()?.requestId, h.taskId()); assert.equal(h.counts().dispatchCount, 1);
}));

test("host shutdown after acknowledged issue cannot dispatch and retains staging for exact stop cleanup", async () => withHarness(async h => {
  h.setIssue(async () => {h.reconciler.stopAccepting(); return "issued";});
  assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
  assert.equal(h.counts().dispatchCount, 0); assert.equal((await h.roots()).length, 1);
  await h.stop(); assert.deepEqual(await h.roots(), []);
}));

test("retirement at the async permission handoff denies before the atomic issue callback", async () => withHarness(async h => {
  let current = true, retired = false;
  const admission = {...h.admission(), isCurrent: () => current, async stillAllowed() {
    const staged = readdirSync(h.base).some(name => name.startsWith("ai-system-builder-context-") &&
      existsSync(path.join(h.base, name, "source-0000.csv")));
    if (staged && !retired) {
      retired = true;
      // Retire after the async helper's final check, before its caller resumes.
      Promise.resolve().then(() => queueMicrotask(() => {current = false;}));
    }
    return true;
  }};
  const result = await h.useCase.startAdmittedContext(command(), h.context, admission);
  assert.equal(retired, true); assert.equal(result.ok, false);
  assert.equal(h.counts().issueCount, 0); assert.equal(h.counts().dispatchCount, 0); assert.deepEqual(await h.roots(), []);
}));

test("an adapter cannot change source bytes across awaited catalog checks after the binding hash passes", async () => withHarness(async h => {
  h.setAfterCatalog(() => h.mutateReturnedBytes());
  assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, true);
  assert.equal(h.lastRequest()?.payload.sources[0].sourceDigest, hash(originalBytes));
  assert.equal(h.counts().dispatchCount, 1);
}));

test("uncertain-start capacity stays bounded and later attempts do not read sources or dispatch", async () => withHarness(async h => {
  h.setDispatch(async () => {throw new Error("Synthetic lost reply");});
  for (let index = 0; index < 4; index++) {h.nextTask(); assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);}
  h.nextTask(); assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, false);
  assert.equal(h.counts().readCount, 4); assert.equal(h.counts().dispatchCount, 4); assert.equal((await h.roots()).length, 4);
  await h.stop(); assert.deepEqual(await h.roots(), []);
}));

test("ordinary confirmed Context work keeps staging and its lease if later power bookkeeping fails", async () => withHarness(async h => {
  h.setDispatch(async () => ({requestId: h.context.requestId, status: "queued"})); h.setPowerFails(true);
  const result = await h.useCase.start(command(), h.context);
  assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes("private/path"), false);
  assert.equal((await h.roots()).length, 1); assert.equal(h.reconciler.status.pending, 1);
  await h.reconciler.reconcileNow(); assert.equal(h.counts().statusCount, 1);
  assert.equal((await h.roots()).length, 1);
  await h.stop(); assert.deepEqual(await h.roots(), []);
}));

test("foreign terminal status never retires this admitted task's staging or power lease", async () => withHarness(async h => {
  assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, true);
  for (const patch of [
    {requestId: randomUUID()}, {taskType: TaskType.DATASET_PREPARATION}, {workspaceId: "foreign"}, {workspaceId: undefined},
    {metadata: {organizationId: "foreign"}}, {metadata: {principalId: "foreign"}}, {status: "unknown"},
  ]) {
    h.setStatus({status: "failed", ...patch});
    assert.equal((await h.useCase.read(h.taskId(), h.context)).ok, false);
    await h.reconciler.reconcileNow();
    assert.equal((await h.roots()).length, 1); assert.equal(h.reconciler.status.pending, 1); assert.equal(h.powerCompletions(), 0);
  }
  h.setStatus({status: "cancelled"});
  assert.equal((await h.useCase.read(h.taskId(), h.context)).ok, true);
  await h.reconciler.reconcileNow();
  assert.deepEqual(await h.roots(), []); assert.equal(h.reconciler.status.pending, 0);
}));

test("a wrong-ID or contradictory cancel acknowledgement cannot clean an owned Context task", async () => withHarness(async h => {
  assert.equal((await h.useCase.startAdmittedContext(command(), h.context, h.admission())).ok, true);
  for (const patch of [{requestId: randomUUID()}, {cancelled: false}]) {
    h.setCancel(patch);
    assert.equal((await h.useCase.cancel(h.taskId(), h.context)).ok, false);
    assert.equal((await h.roots()).length, 1); assert.equal(h.powerCompletions(), 0);
  }
  h.setCancel({});
  assert.equal((await h.useCase.cancel(h.taskId(), h.context)).ok, true);
  await h.reconciler.reconcileNow();
  assert.deepEqual(await h.roots(), []); assert.equal(h.reconciler.status.pending, 0);
}));

for (const mode of ["terminal", "runtime-stop"] as const) test(`${mode} cleanup waits for pending power registration and releases the actual lifecycle blocker`, async () => withHarness(async h => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => {enter = resolve;}), gate = new Promise<void>(resolve => {release = resolve;});
  const active = new Set<string>();
  h.setPowerLifecycle(new TaskPowerLifecycleService({
    async startBlocker() {enter(); await gate; active.add("owned-blocker"); return {blockerId: "owned-blocker", active: true};},
    async stopBlocker(id) {assert.equal(id, "owned-blocker"); active.delete(id); return {blockerId: id, active: false};},
    async listBlockers() {return [];},
  }));
  const started = h.useCase.startAdmittedContext(command(), h.context, h.admission());
  await entered;
  h.setStatus({status: "cancelled"});
  await h.reconciler.reconcileNow();
  assert.equal((await h.useCase.read(h.taskId(), h.context)).ok, false);
  assert.equal((await h.useCase.cancel(h.taskId(), h.context)).ok, false);
  assert.equal(h.counts().statusCount, 0); assert.equal(h.counts().cancelCount, 0);
  const stopped = mode === "runtime-stop" ? h.stop() : undefined;
  for (let turn = 0; turn < 4; turn++) await Promise.resolve();
  assert.equal(h.powerCompletions(), 0); assert.equal((await h.roots()).length, 1);
  release(); assert.equal((await started).ok, true);
  if (stopped) await stopped; else await h.reconciler.reconcileNow();
  assert.equal(active.size, 0); assert.equal(h.reconciler.status.pending, 0); assert.deepEqual(await h.roots(), []);
}));
