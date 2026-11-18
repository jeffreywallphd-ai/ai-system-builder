import assert from "node:assert/strict";
import test from "node:test";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises";
import {existsSync, readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {ContextGenerationUseCase} from "../context-generation.use-case";
import {contextCommandDigest} from "../approved-context-generation-admission";
import {OwnedTaskReconcilerService} from "../../../services/runtime/owned-task-reconciler.service";
import {TaskPowerLifecycleService, type TaskPowerLifecyclePort} from "../../../services/runtime/task-power-lifecycle.service";
import type {ApprovedContextGenerationAdmission} from "../../../ports/context-management";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createOrganizationId} from "../../../../contracts/organization";
import type {StartContextGenerationCommand} from "../../../../contracts/context-management";
import {TaskType, type ContextGenerationTaskRequest} from "../../../../contracts/runtime";
import {createFilesystemArtifactObjectStorageAdapter} from "../../../../adapters/storage/filesystem/artifact-store";
import type {ArtifactObjectStoragePort} from "../../../ports/storage";
import type {RuntimeTaskRegistryPort} from "../../../ports/runtime";
import {createPythonRuntimeTaskRegistryAdapter} from "../../../../adapters/runtime/python/createPythonRuntimeTaskRegistryAdapter";
import {createRuntimeTaskRegistryRouter} from "../../../../adapters/runtime/createRuntimeTaskRegistryRouter";

const workspaceId = createWorkspaceId("workspace.context-admission"), organizationId = createOrganizationId("org.context-admission");
const originalBytes = new TextEncoder().encode("text\nSynthetic release documentation.\n");
const hash = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const artifactId = "private/synthetic/context.csv";
function command(): StartContextGenerationCommand {return {kind: "markdown-context-pack", name: "Synthetic context",
  sources: [{artifactId}], chunking: {strategy: "topic-aware", chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"]},
  contextPack: {inputMode: "source-materials", method: "none", cleaningPreset: "standard"}};}
function ragCommand(): StartContextGenerationCommand {return {kind: "rag-database", name: "Synthetic retrieval",
  sources: [{artifactId}], chunking: {...command().chunking, strategy: "fixed-length"},
  embedding: {provider: "transformers", modelId: "local/test-embedding", batchSize: 2, device: "cpu"},
  sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false,
    requireConsentMetadata: false, includeSourceAttribution: true}};}

async function withHarness(run: (h: Awaited<ReturnType<typeof harness>>) => Promise<void>, withoutOwner = false) {
  const originalTemp = process.env.TEMP, originalTmp = process.env.TMP;
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "context-admission-test-")));
  process.env.TEMP = base; process.env.TMP = base;
  const h = await harness(base, withoutOwner);
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
async function harness(base: string, withoutOwner: boolean) {
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
  const useCase = new ContextGenerationUseCase({taskReconciler: withoutOwner ? undefined : reconciler,
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
    isCurrent: () => allowed, stillAllowed: async () => allowed,
    async issue() {issueCount++; return issue();}});
  return {base, useCase, context, reconciler, admission,
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
  const python = createPythonRuntimeTaskRegistryAdapter({async startTask(request) {
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
    assert.deepEqual(h.lastRequest()?.payload.embedding, selected.embedding);
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
