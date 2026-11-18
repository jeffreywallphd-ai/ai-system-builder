import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
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
import {createInMemoryStructuredDocumentStore} from "../../../adapters/persistence/shared";
import {createStructuredDatasetVersionRepository} from "../../../adapters/persistence/dataset-version";
import {createSha256DatasetVersionHasher} from "../../../adapters/storage/dataset-version";
import {DatasetVersionFinalizationService} from "../../services/dataset-version";
import type {ArtifactObjectStoragePort} from "../../ports/storage";
import type {PreparedLocalDatasetSaveAdmission} from "../../ports/dataset-version";

const context = {workspaceId: "workspace.synthetic", organizationId: createOrganizationId("org.synthetic"), principalId: "synthetic-user"};
const source = Buffer.from("question,answer\nWhere is Help?,Open Help from the menu.\nHow do I save?,Use Save.\n");
const digest = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex") as `sha256:${string}`;
const command = {sourceArtifactIds: ["source.one"],
  recipe: {task: {taskType: "llm-instruction" as const, textInputMode: "provided" as const, promptStyle: "instruction-response" as const,
    providedRowMapping: {instructionColumn: "question", outputColumn: "answer"}, sourceContextPolicy: "omit" as const}},
  split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42, shuffle: true},
  output: {format: "jsonl" as const, destinations: {local: {enabled: true}}},
  quality: {policy: {preset: "recommended" as const, maxRowsPerSource: 1000}, reviewRequired: true}};

async function fixture(options: {
  evidence?: boolean;
  versioning?: boolean; lostSaveCommitAck?: boolean; loseCallerOnSaveIssue?: boolean; retainedReview?: boolean;
  saveIssue?: "issued" | "denied" | "unconfirmed";
  omittedDescriptorMedia?: boolean; conflictingDescriptorMedia?: boolean;
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
  const descriptor = {key: "source.one", mediaType: options.omittedDescriptorMedia ? undefined : options.conflictingDescriptorMedia ? "application/pdf" : "text/csv",
    metadata: {originalName: "source.csv", privateNote: "Synthetic private metadata."}};
  let runtimeRequest: any;
  let statusOverride: any;
  const saved = new Map<string, any>();
  const versions = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore().forOrganization(context.organizationId));
  const hasher = createSha256DatasetVersionHasher();
  let saveIssues = 0, versionCommits = 0;
  const storage: ArtifactObjectStoragePort = {async retrieveArtifact(request) {reads.push(request); if (options.revokeAfterRead) current = false;
    if (saved.has(request.key)) return {ok: true, value: saved.get(request.key)} as any;
    return {ok: true, value: {descriptor, content: options.corrupt ? Buffer.from("changed") : input}} as any;},
    async storeArtifact(request) {
      if (!options.evidence) throw new Error("Unexpected output save.");
      saved.set(request.descriptor.key, {descriptor: request.descriptor, content: new Uint8Array(request.content as Uint8Array)});
      return {ok: true, value: request.descriptor} as any;
    }, async deleteArtifact(request) {
      if (!options.evidence || !saved.has(request.key)) throw new Error("Unexpected source deletion.");
      saved.delete(request.key); return {ok: true, value: {deleted: true}} as any;
    },
    async hasArtifact(request) {return {ok: true, value: {exists: saved.has(request.key),
      ...(saved.has(request.key) ? {descriptor: saved.get(request.key).descriptor} : {})}} as any;}};
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
      async getTaskStatus() {statusReads++; return statusOverride ?? {requestId: admission.taskId, status: "running", taskType: "dataset-preparation",
        workspaceId: context.workspaceId} as any;},
      async cancelTask() {cancellations++; return {} as any;}, async listTasks() {return {tasks: []};},
    },
    storageBindings: {async readArtifactStorageBindings() {return {ok: true, value: {bindings: [{workspaceId: context.workspaceId,
      artifactId: "source.one", role: "primary", backing: options.remote ? {kind: "imported-source", target: {provider: "huggingface"}} :
        {kind: "artifact-object", provider: "local-filesystem", locator: "source.one"}}]}} as any;},
      async upsertArtifactStorageBinding() {throw new Error("Unexpected localization.");}, async deleteArtifactStorageBindings() {throw new Error("Unexpected binding deletion.");}},
    storage,
    artifactRepoStorage: {async retrieveArtifactFromRepo() {providerReads++; throw new Error("Unexpected provider access.");}} as any,
    artifactCatalog: {async readArtifactCatalogRecord() {
      if (options.mutateDuringCatalog) input.fill(0);
      if (options.mutateDescriptorDuringCatalog) {descriptor.mediaType = "application/pdf"; descriptor.metadata.originalName = "source.pdf";}
      return {ok: true, value: {record: {workspaceId: context.workspaceId, storageKey: "source.one", mediaType: "text/csv", originalName: "source.csv"}}} as any;
    }} as any,
    taskPowerLifecycle: {async startTask() {}, async completeTask() {}}, taskReconciler: reconciler,
    sourceIntegrityHasher: {digest(bytes) {verifications++; return digest(bytes);}},
    datasetQualityPolicyProvider: createDefaultDatasetQualityPolicyProvider(),
    ...(options.versioning ? {datasetVersioning: {hasher,
      finalizer: new DatasetVersionFinalizationService({repository: versions, artifacts: storage, hasher})}} : {}),
    runtimeCapabilityGuard: {async requireCapabilityReady() {
      activations++; assert.equal(issues, 1); assert.equal(verifications, 1);
      if (options.stopDuringActivation) reconciler.stopAccepting();
      if (options.activationFailure) throw new Error("Private synthetic runtime diagnostic.");
    }},
  });
  const approval = {requestId: admission.taskId, reportFingerprint: "a".repeat(64), outputBaseName: "Synthetic reviewed answers"};
  const saveAdmission: PreparedLocalDatasetSaveAdmission = {...context, effectId: randomUUID(), taskId: admission.taskId,
    reportFingerprint: approval.reportFingerprint, outputBaseName: approval.outputBaseName,
    isCurrent: () => current, stillAllowed: async () => current,
    async issue() {saveIssues++; if (options.loseCallerOnSaveIssue) current = false; return options.saveIssue ?? "issued";},
    async commit(version) {
      // This core-only fixture supplies its commit admission independently of
      // caller liveness. Actual host/adapter tests must fence publication policy.
      versionCommits++;
      const record = await versions.createVersion(version);
      if (options.lostSaveCommitAck) throw new Error("Synthetic private commit acknowledgement failure.");
      return {version: record, created: true};
    }};
  return {useCase, admission, reconciler, parent, reads, versions, approval, saveAdmission,
    save(a = saveAdmission) {return useCase.saveAdmittedLocalProvidedDataset(approval, context, a);},
    savedCount: () => saved.size,
    setStatus(value: any) {statusOverride = value;},
    async finishForReview() {
      reconciler.stopObservation();
      const fingerprint = "a".repeat(64);
      const qualityReport = {schemaVersion: "1", status: "needs-attention", reportFingerprint: fingerprint,
        policy: runtimeRequest.payload.quality.effectivePolicy, mapping: {taskType: "llm-instruction", status: "complete",
          mappedFields: ["instruction", "output"], missingRequiredFields: []}, fields: [],
        distributions: {sources: [{label: "source.one", count: 2}]},
        counts: {inputRows: 2, acceptedRows: 1, quarantinedRows: 1}, reasonCounts: {"schema-invalid": 1}, samples: [],
        reviewRequired: true, approvalAllowed: true};
      const outputs = ["dataset", "train", "report", "review", "quarantine"].map(role => ({name: "synthetic-" + role, role,
        outputHandle: role + (role === "report" ? ".json" : ".jsonl"),
        mediaType: role === "report" ? "application/json" : "application/x-ndjson",
        ...(role === "review" ? {metadata: {rowCount: 1, reportFingerprint: fingerprint}} : {})}));
      for (const output of outputs) await writeFile(join(runtimeRequest.payload.runtime.runtimeWorkingDirectory, output.outputHandle),
        output.role === "report" ? JSON.stringify(qualityReport) : output.role === "quarantine"
          ? JSON.stringify({sourceArtifactId: "source.one", sourceRowIndex: 1, reasonCodes: ["schema-invalid"],
            row: {instruction: "Synthetic rejected row"}}) + "\n"
          : '{"instruction":"Synthetic question","output":"Synthetic answer","sourceArtifactId":"source.one"}\n');
      statusOverride = {requestId: admission.taskId, taskType: "dataset-preparation", workspaceId: context.workspaceId,
        status: "succeeded", data: {outputs, qualityReport, summary: {sourceDocumentCount: 1, normalizedDocumentCount: 1,
          skippedDocumentCount: 0, chunkCount: 2, generatedExampleCount: 2, datasetRowCount: 1, trainRowCount: 1,
          validationRowCount: 0, testRowCount: 0, acceptedRowCount: 1, quarantinedRowCount: 1}}};
    },
    counts: () => ({starts, issues, providerReads, statusReads, cancellations, activations, saveIssues, versionCommits}),
    start: (a = admission, c = command) => useCase.startAdmittedLocalProvidedDataset(c, {...context, requestId: "caller-correlation"}, a),
    async directories() {return readdir(parent);},
    async close() {
      reconciler.stopObservation();
      // The fake registry creates no worker. This is a simulated successful owned
      // runtime stop; native lifecycle qualification is a separate host journey.
      try {
        await reconciler.settleAfterRuntimeStop(["python"]);
        const directories = await readdir(parent);
        if (options.retainedReview) assert.equal(directories.length, 1, "An uncertain save must retain its synthetic review stage.");
        else assert.deepEqual(directories, []);
        // Only this fresh unit-test directory is removed. Its registry and
        // version storage are in memory; this is no native retirement proof.
        await rm(parent, {recursive: true, force: true});
      } finally {
        if (prior.TEMP === undefined) delete process.env.TEMP; else process.env.TEMP = prior.TEMP;
        if (prior.TMP === undefined) delete process.env.TMP; else process.env.TMP = prior.TMP;
      }
    },
  };
}

async function readyForReview(f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal((await f.start()).ok, true);
  await f.finishForReview();
  const result = await f.useCase.readPrepareTrainingDataset(f.admission.taskId, context);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(result.value.status, "review-required");
}

test("admitted review metadata is detached, scoped and passive, and saving requires a configured version finalizer", async () => {
  const f = await fixture({evidence: true});
  try {
    await readyForReview(f);
    const before = f.counts(), stored = f.savedCount();
    const review = f.useCase.peekAdmittedLocalDatasetReview(f.admission.taskId, context);
    assert.ok(review); assert.equal(review.saveAvailable, false);
    assert.deepEqual(review.counts, {inputRows: 2, acceptedRows: 1, quarantinedRows: 1});
    assert.deepEqual(review.splits, {trainRows: 1, validationRows: 0, testRows: 0});
    assert.equal("samples" in review, false); assert.equal("outputs" in review, false);
    review.counts.acceptedRows = 99;
    assert.equal(f.useCase.peekAdmittedLocalDatasetReview(f.admission.taskId, context)?.counts.acceptedRows, 1);
    for (const other of [{...context, principalId: "foreign"}, {...context, workspaceId: "other.workspace"},
      {...context, organizationId: createOrganizationId("other.org")}])
      assert.equal(f.useCase.peekAdmittedLocalDatasetReview(f.admission.taskId, other), undefined);
    assert.equal((await f.save()).ok, false);
    assert.deepEqual(f.counts(), before); assert.equal(f.savedCount(), stored);
  } finally {await f.useCase.cancelPrepareTrainingDataset(f.admission.taskId, context); await f.close();}
});

test("one admitted result save produces the existing immutable version and concurrent/repeated calls do not save again", async () => {
  const f = await fixture({evidence: true, versioning: true});
  try {
    await readyForReview(f);
    assert.equal(f.useCase.peekAdmittedLocalDatasetReview(f.admission.taskId, context)?.saveAvailable, true);
    for (const narrowed of [{...f.saveAdmission, reportFingerprint: "b".repeat(64)},
      {...f.saveAdmission, taskId: randomUUID()}, {...f.saveAdmission, principalId: "foreign"},
      {...f.saveAdmission, workspaceId: "foreign.workspace"}, {...f.saveAdmission, effectId: "not-an-effect"}])
      assert.equal((await f.save(narrowed)).ok, false);
    assert.equal(f.counts().saveIssues, 0); assert.equal(f.counts().versionCommits, 0);
    const outcomes = await Promise.all([f.save(), f.save()]);
    assert.ok(outcomes.every(value => value.ok), JSON.stringify(outcomes));
    const versions = await f.versions.listVersions(context.workspaceId);
    assert.equal(versions.length, 1); assert.equal(versions[0]!.lineage.split?.seed, 42);
    assert.equal(versions[0]!.lineage.sources.length, 1);
    assert.equal(versions[0]!.lineage.quality.reportFingerprint, "sha256:" + f.approval.reportFingerprint);
    assert.equal((await f.save()).ok, true);
    assert.equal(f.counts().saveIssues, 1); assert.equal(f.counts().versionCommits, 1); assert.equal(f.counts().starts, 1);
    assert.equal(f.useCase.peekAdmittedLocalDatasetReview(f.admission.taskId, context), undefined);
    assert.deepEqual(await f.useCase.readAdmittedLocalDatasetStatus(f.admission.taskId, context),
      {taskId: f.admission.taskId, state: "succeeded"});
  } finally {await f.close();}
});

test("unconfirmed save issuance preserves review evidence and denies repeated save, ordinary approval and cancellation", async () => {
  const f = await fixture({evidence: true, versioning: true, saveIssue: "unconfirmed", retainedReview: true});
  try {
    await readyForReview(f); const stored = f.savedCount();
    assert.equal((await f.save()).ok, false); assert.equal((await f.save()).ok, false);
    assert.equal((await f.useCase.approvePreparedTrainingDataset(f.approval, context)).ok, false);
    assert.equal((await f.useCase.cancelPrepareTrainingDataset(f.admission.taskId, context)).ok, false);
    const foreign = await f.useCase.approvePreparedTrainingDataset(f.approval, {...context, principalId: "foreign"});
    assert.equal(foreign.ok, false); if (!foreign.ok) assert.equal(foreign.error.code, "not-found");
    assert.equal(f.counts().saveIssues, 1); assert.equal(f.counts().versionCommits, 0);
    assert.equal(f.savedCount(), stored);
    assert.equal(f.useCase.peekAdmittedLocalDatasetReview(f.admission.taskId, context)?.saveAvailable, false);
  } finally {await f.close();}
});

test("a lost result-commit acknowledgement cannot delete or adopt the stored version or start a second save", async () => {
  const f = await fixture({evidence: true, versioning: true, lostSaveCommitAck: true, retainedReview: true});
  try {
    await readyForReview(f);
    assert.equal((await f.save()).ok, false);
    const versions = await f.versions.listVersions(context.workspaceId);
    assert.equal(versions.length, 1);
    const stored = f.savedCount();
    assert.equal((await f.save()).ok, false);
    assert.equal((await f.useCase.approvePreparedTrainingDataset(f.approval, context)).ok, false);
    assert.equal((await f.useCase.cancelPrepareTrainingDataset(f.admission.taskId, context)).ok, false);
    assert.equal(f.savedCount(), stored); assert.equal(f.counts().versionCommits, 1);
    assert.equal(f.counts().saveIssues, 1); assert.equal(f.counts().starts, 1);
    assert.equal(f.useCase.peekAdmittedLocalDatasetReview(f.admission.taskId, context)?.saveAvailable, false);
  } finally {await f.close();}
});

test("an ordinary approval queued before the save attempt is installed cannot bypass later unconfirmed admission", async () => {
  const f = await fixture({evidence: true, versioning: true, saveIssue: "unconfirmed", retainedReview: true});
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const entry = new Promise<void>(resolve => {entered = resolve;});
  let scheduling: ReturnType<typeof mock.method> | undefined;
  try {
    await readyForReview(f); const stored = f.savedCount();
    // Hold the real owner's queue before its first callback. Both public calls
    // still use their production validation, serialization and save methods.
    const owner = f.useCase as any;
    const serialize = owner.serialize.bind(owner);
    let held = false;
    scheduling = mock.method(owner, "serialize", (id: string, operation: () => Promise<unknown>) => serialize(id, async () => {
      if (!held) {held = true; entered(); await gate;}
      return operation();
    }));
    const admitted = f.save();
    await entry;
    const ordinary = f.useCase.approvePreparedTrainingDataset(f.approval, context);
    release();
    assert.equal((await admitted).ok, false); assert.equal((await ordinary).ok, false);
    assert.equal(f.counts().saveIssues, 1); assert.equal(f.counts().versionCommits, 0);
    assert.equal((await f.versions.listVersions(context.workspaceId)).length, 0);
    assert.equal(f.savedCount(), stored);
  } finally {release(); scheduling?.mock.restore(); await f.close();}
});

test("losing outward caller access does not bypass the supplied publication callback or erase its confirmed result", async () => {
  const f = await fixture({evidence: true, versioning: true, loseCallerOnSaveIssue: true});
  try {
    await readyForReview(f);
    assert.equal((await f.save()).ok, true);
    assert.equal((await f.versions.listVersions(context.workspaceId)).length, 1);
    assert.equal((await f.save()).ok, false);
    const unknown = await f.save(); assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.error.code, "forbidden");
    assert.equal(f.counts().saveIssues, 1); assert.equal(f.counts().versionCommits, 1);
  } finally {await f.close();}
});

test("known save denial retains ordinary app review and an ordinary save cannot become a new admitted receipt", async () => {
  const f = await fixture({evidence: true, versioning: true, saveIssue: "denied"});
  try {
    await readyForReview(f);
    assert.equal((await f.save()).ok, false);
    assert.equal(f.useCase.peekAdmittedLocalDatasetReview(f.admission.taskId, context)?.saveAvailable, true);
    assert.equal((await f.useCase.approvePreparedTrainingDataset(f.approval, context)).ok, true);
    assert.equal((await f.save()).ok, false);
    assert.equal((await f.versions.listVersions(context.workspaceId)).length, 1);
    assert.equal(f.counts().saveIssues, 1); assert.equal(f.counts().versionCommits, 0);
  } finally {await f.close();}
});

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

test("passive admitted status rejects foreign and unknown tasks and never materializes worker output", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.start()).ok, true); f.reconciler.stopObservation();
    const id = f.admission.taskId;
    assert.deepEqual(await f.useCase.readAdmittedLocalDatasetStatus(id, context), {taskId: id, state: "running"});
    for (const other of [{...context, principalId: "foreign"}, {...context, workspaceId: "other.workspace"},
      {...context, organizationId: createOrganizationId("other.org")}])
      assert.equal(await f.useCase.readAdmittedLocalDatasetStatus(id, other), undefined);
    assert.equal(await f.useCase.readAdmittedLocalDatasetStatus(randomUUID(), context), undefined);
    f.setStatus({requestId: id, taskType: "dataset-preparation", status: "succeeded", data: {private: "Synthetic raw data"}});
    assert.deepEqual(await f.useCase.readAdmittedLocalDatasetStatus(id, context), {taskId: id, state: "processing-result"});
    assert.equal((await f.directories()).length, 1);
    const materialized = await f.useCase.readPrepareTrainingDataset(id, context);
    assert.equal(materialized.ok, false);
    assert.deepEqual(await f.useCase.readAdmittedLocalDatasetStatus(id, context), {taskId: id, state: "failed"});
    assert.equal((await f.directories()).length, 0);
  } finally {await f.close();}
});

test("an absent optional storage media type preserves the pinned source format while a conflict is denied", async () => {
  const accepted = await fixture({omittedDescriptorMedia: true});
  try {assert.equal((await accepted.start()).ok, true); assert.equal(accepted.counts().starts, 1);}
  finally {await accepted.close();}
  const denied = await fixture({conflictingDescriptorMedia: true});
  try {assert.equal((await denied.start()).ok, false); assert.equal(denied.counts().issues, 0); assert.equal(denied.counts().starts, 0);}
  finally {await denied.close();}
});

test("cancelling an actual pending review remains cancelled after the successful worker and stage cleanup", async () => {
  const f = await fixture({evidence: true});
  try {
    assert.equal((await f.start()).ok, true);
    await f.finishForReview();
    const id = f.admission.taskId;
    const review = await f.useCase.readPrepareTrainingDataset(id, context);
    assert.ok(review.ok, JSON.stringify(review));
    assert.equal(review.value.status, "review-required");
    assert.deepEqual(await f.useCase.readAdmittedLocalDatasetStatus(id, context), {taskId: id, state: "review-required"});
    const cancelled = await f.useCase.cancelPrepareTrainingDataset(id, context);
    assert.ok(cancelled.ok, JSON.stringify(cancelled)); assert.equal(cancelled.value.status, "cancelled");
    assert.deepEqual(await f.useCase.readAdmittedLocalDatasetStatus(id, context), {taskId: id, state: "cancelled"});
    assert.equal((await f.directories()).length, 0);
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
