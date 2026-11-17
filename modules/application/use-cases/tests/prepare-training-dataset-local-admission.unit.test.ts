import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import test, {mock} from "node:test";
import {createOrganizationId} from "../../../contracts/organization";
import {createDefaultDatasetQualityPolicyProvider} from "../../services/dataset-preparation/default-dataset-quality-policy-provider.service";
import {OwnedTaskReconcilerService} from "../../services/runtime/owned-task-reconciler.service";
import type {LocalDatasetPreparationAdmission} from "../../ports/runtime";
import {PrepareTrainingDatasetFromArtifactsUseCase} from "../prepare-training-dataset-from-artifacts.use-case";

const context = {workspaceId: "workspace.synthetic", organizationId: createOrganizationId("org.synthetic"), principalId: "synthetic-user"};
const source = Buffer.from("question,answer\nWhere is Help?,Open Help from the menu.\nHow do I save?,Use Save.\n");
const digest = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex") as `sha256:${string}`;
const command = {sourceArtifactIds: ["source.one"],
  recipe: {task: {taskType: "llm-instruction" as const, textInputMode: "provided" as const, promptStyle: "instruction-response" as const,
    inputField: "question", outputField: "answer", sourceContextPolicy: "omit" as const}},
  split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42, shuffle: true},
  output: {format: "jsonl" as const, destinations: {local: {enabled: true}}},
  quality: {policy: {preset: "recommended" as const, maxRowsPerSource: 1000}, reviewRequired: true}};

async function fixture(options: {
  remote?: boolean; corrupt?: boolean; mutateDuringCatalog?: boolean; revokeAfterRead?: boolean;
  mutateDescriptorDuringCatalog?: boolean; activationFailure?: boolean; stopDuringActivation?: boolean;
  stopOnIssue?: boolean; revokeOnIssue?: boolean;
  issueEntered?: () => void; issueWait?: Promise<void>;
  issue?: "issued" | "denied" | "unconfirmed" | "throw"; start?: "correct" | "wrong-id" | "missing-status" | "throw";
} = {}) {
  const parent = await mkdtemp(join(tmpdir(), "provided-admission-"));
  const prior = {TEMP: process.env.TEMP, TMP: process.env.TMP};
  process.env.TEMP = process.env.TMP = parent;
  const reconciler = new OwnedTaskReconcilerService();
  let current = true, starts = 0, issues = 0, providerReads = 0, statusReads = 0, cancellations = 0, activations = 0, verifications = 0;
  const reads: unknown[] = [], input = Buffer.from(source);
  const descriptor = {key: "source.one", mediaType: "text/csv", metadata: {originalName: "source.csv", privateNote: "Synthetic private metadata."}};
  let runtimeRequest: any;
  const admission: LocalDatasetPreparationAdmission = {taskId: randomUUID(), sources: [{artifactId: "source.one", storageKey: "source.one",
    mediaType: "text/csv", format: "csv", sizeBytes: source.byteLength, digest: digest(source)}],
    isCurrent: () => current, stillAllowed: async () => current,
    issue: async () => {
      issues++;
      options.issueEntered?.();
      await options.issueWait;
      if (options.stopOnIssue) reconciler.stopAccepting();
      if (options.revokeOnIssue) current = false;
      if (options.issue === "throw") throw new Error("Private synthetic issue diagnostic.");
      return options.issue ?? "issued";
    }};
  const useCase = new PrepareTrainingDatasetFromArtifactsUseCase({
    runtimeTaskRegistry: {
      async startTask(request) {
        starts++; runtimeRequest = request;
        const payload = request.payload as any;
        assert.equal(request.requestId, admission.taskId);
        assert.equal(payload.recipe.task.textInputMode, "provided");
        assert.equal(payload.recipe.generation, undefined);
        assert.equal(payload.quality.reviewRequired, true);
        assert.equal(payload.quality.effectivePolicy.maxRowsPerSource, 1000);
        assert.equal(payload.sourceInputs[0].mediaType, "text/csv");
        assert.equal(payload.sourceInputs[0].originalName, "source.csv");
        assert.equal(payload.sourceInputs[0].metadata, undefined);
        assert.deepEqual(await readFile(payload.sourceInputs[0].localPath), source);
        if (options.start === "throw") throw new Error("Private synthetic worker diagnostic.");
        return {requestId: options.start === "wrong-id" ? randomUUID() : admission.taskId,
          ...(options.start === "missing-status" ? {} : {status: "queued" as const})};
      },
      async getTaskStatus() {statusReads++; return {requestId: admission.taskId, status: "running", taskType: "dataset-preparation",
        workspaceId: context.workspaceId} as any;},
      async cancelTask() {cancellations++; return {} as any;}, async listTasks() {return {tasks: []};},
    },
    storageBindings: {async readArtifactStorageBindings() {return {ok: true, value: {bindings: [{workspaceId: context.workspaceId,
      artifactId: "source.one", role: "primary", backing: options.remote ? {kind: "imported-source", target: {provider: "huggingface"}} :
        {kind: "artifact-object", provider: "local-filesystem", locator: "source.one"}}]}} as any;},
      async upsertArtifactStorageBinding() {throw new Error("Unexpected localization.");}, async deleteArtifactStorageBindings() {throw new Error("Unexpected binding deletion.");}},
    storage: {async retrieveArtifact(request) {reads.push(request); if (options.revokeAfterRead) current = false;
      return {ok: true, value: {descriptor,
        content: options.corrupt ? Buffer.from("changed") : input}} as any;},
      async storeArtifact() {throw new Error("Unexpected output save.");}, async deleteArtifact() {throw new Error("Unexpected source deletion.");},
      async hasArtifact() {return {} as any;}},
    artifactRepoStorage: {async retrieveArtifactFromRepo() {providerReads++; throw new Error("Unexpected provider access.");}} as any,
    artifactCatalog: {async readArtifactCatalogRecord() {
      if (options.mutateDuringCatalog) input.fill(0);
      if (options.mutateDescriptorDuringCatalog) {descriptor.mediaType = "application/pdf"; descriptor.metadata.originalName = "source.pdf";}
      return {ok: true, value: {record: {workspaceId: context.workspaceId, storageKey: "source.one", mediaType: "text/csv", originalName: "source.csv"}}} as any;
    }} as any,
    taskPowerLifecycle: {async startTask() {}, async completeTask() {}}, taskReconciler: reconciler,
    sourceIntegrityHasher: {digest(bytes) {verifications++; return digest(bytes);}},
    datasetQualityPolicyProvider: createDefaultDatasetQualityPolicyProvider(),
    runtimeCapabilityGuard: {async requireCapabilityReady() {
      activations++; assert.equal(issues, 1); assert.equal(verifications, 1);
      if (options.stopDuringActivation) reconciler.stopAccepting();
      if (options.activationFailure) throw new Error("Private synthetic runtime diagnostic.");
    }},
  });
  return {useCase, admission, reconciler, parent, reads,
    counts: () => ({starts, issues, providerReads, statusReads, cancellations, activations}),
    start: (a = admission, c = command) => useCase.startAdmittedLocalProvidedDataset(c, {...context, requestId: "caller-correlation"}, a),
    async directories() {return readdir(parent);},
    async close() {
      reconciler.stopObservation();
      // The fake registry creates no worker. This is a simulated successful owned
      // runtime stop; native lifecycle qualification is a separate host journey.
      await reconciler.settleAfterRuntimeStop(["python"]);
      assert.deepEqual(await readdir(parent), []);
      if (prior.TEMP === undefined) delete process.env.TEMP; else process.env.TEMP = prior.TEMP;
      if (prior.TMP === undefined) delete process.env.TMP; else process.env.TMP = prior.TMP;
      await rm(parent, {recursive: true, force: true});
    },
  };
}

test("an admitted provided-data task uses bounded copied bytes, the owned ID and existing workspace quality policy", async () => {
  const f = await fixture({mutateDuringCatalog: true, mutateDescriptorDuringCatalog: true});
  try {
    const result = await f.start(); assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.requestId, f.admission.taskId);
    assert.equal((f.reads[0] as any).maximumBytes, source.byteLength);
    assert.equal(f.counts().starts, 1); assert.equal(f.counts().issues, 1);
    assert.equal((await f.start()).ok, false);
    assert.equal(f.counts().starts, 1);
  } finally {await f.close();}
});

for (const options of [{corrupt: true}, {remote: true}, {revokeAfterRead: true}, {issue: "denied" as const}])
  test(`source or authority denial starts no worker: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    try {
      assert.equal((await f.start()).ok, false);
      assert.equal(f.counts().starts, 0); assert.equal(f.counts().providerReads, 0);
      assert.equal(f.counts().activations, 0);
      assert.deepEqual(await f.directories(), []); assert.equal(f.reconciler.status.pending, 0);
      if (!options.issue) assert.equal(f.counts().issues, 0);
    } finally {await f.close();}
  });

for (const options of [{issue: "unconfirmed" as const}, {issue: "throw" as const}, {start: "wrong-id" as const},
  {start: "missing-status" as const}, {start: "throw" as const}, {activationFailure: true}, {stopDuringActivation: true}])
  test(`uncertain effects retain owned staging without adoption or retry: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options);
    try {
      const result = await f.start(); assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes("Private synthetic"), false);
      assert.equal((await f.directories()).length, 1); assert.equal(f.reconciler.status.pending, 1);
      const initial = f.counts(); assert.equal((await f.start()).ok, false);
      await f.reconciler.reconcileNow(); await f.reconciler.cancelAndReconcile();
      assert.deepEqual(f.counts(), initial);
      assert.equal((await f.directories()).length, 1);
    } finally {await f.close();}
  });

test("the local provided profile cannot add generation, remote destinations or bypass the four pending slots", async () => {
  const f = await fixture({issue: "unconfirmed"});
  try {
    for (const invalid of [
      {...command, recipe: {...command.recipe, generation: {mode: "qa"}}},
      {...command, output: {...command.output, destinations: {huggingFace: {enabled: true, repository: "synthetic"}}}},
      {...command, quality: {...command.quality, reviewRequired: false}},
    ]) assert.equal((await f.start(f.admission, invalid as any)).ok, false);
    assert.equal(f.counts().issues, 0); assert.deepEqual(await f.directories(), []);
    const document = {...f.admission, sources: [{...f.admission.sources[0], format: "pdf" as const, mediaType: "application/pdf"}]};
    assert.equal((await f.start(document)).ok, false);
    assert.equal((await f.start({...f.admission, sources: [{...f.admission.sources[0], mediaType: "application/pdf"}]})).ok, false);
    assert.equal(f.counts().activations, 0); assert.equal(f.reads.length, 0);
    for (let i = 0; i < 4; i++) assert.equal((await f.start({...f.admission, taskId: randomUUID()})).ok, false);
    assert.equal(f.counts().issues, 4);
    assert.equal((await f.start({...f.admission, taskId: randomUUID()})).ok, false);
    assert.equal(f.counts().issues, 4); assert.equal((await f.directories()).length, 4);
  } finally {await f.close();}
});

test("host shutdown during issue prevents a new runtime call and retains the owned attempt", async () => {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  const wait = new Promise<void>(resolve => {release = resolve;});
  const f = await fixture({issueEntered: entered, issueWait: wait});
  try {
    const running = f.start(); await ready; f.reconciler.stopAccepting(); release();
    assert.equal((await running).ok, false);
    assert.equal(f.counts().issues, 1); assert.equal(f.counts().starts, 0);
    assert.equal((await f.directories()).length, 1); assert.equal(f.reconciler.status.pending, 1);
  } finally {await f.close();}
});

test("failed staging cleanup remains accounted until proven runtime stop and a confirmed cleanup retry", async () => {
  const f = await fixture({issue: "denied"});
  const original = fs.promises.rm;
  let denials = 0;
  const patched = mock.method(fs.promises, "rm", async (target: any, options: any) => {
    if (String(target).startsWith(f.parent) && String(target) !== f.parent) {denials++; throw new Error("Synthetic retained cleanup failure.");}
    return original(target, options);
  });
  syncBuiltinESMExports();
  try {
    assert.equal((await f.start()).ok, false);
    assert.ok(denials > 0);
    assert.equal(f.counts().starts, 0); assert.equal(f.reconciler.status.pending, 1);
    await f.reconciler.settleAfterRuntimeStop(["python"]);
    assert.equal(f.reconciler.status.pending, 1); assert.equal((await f.directories()).length, 1);
  } finally {patched.mock.restore(); syncBuiltinESMExports(); await f.close();}
});

test("acknowledged issuance preserves its owned business task after later permission withdrawal", async () => {
  const f = await fixture({revokeOnIssue: true});
  try {
    assert.equal((await f.start()).ok, true);
    assert.equal(f.counts().issues, 1); assert.equal(f.counts().starts, 1);
    assert.equal(f.counts().cancellations, 0);
    // Host transport publication must still apply its separate current fence.
  } finally {await f.close();}
});
