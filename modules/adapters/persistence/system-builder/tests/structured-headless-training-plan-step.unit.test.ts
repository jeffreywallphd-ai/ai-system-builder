import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test, {type TestContext} from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readModelDownloadSource} from "../../../../contracts/model";
import {isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal, readHeadlessModelTrainingInputsValue,
  type HeadlessModelTrainingInputsValue, type HeadlessModelTrainingPlanRequest} from "../../../../contracts/headless";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {PrepareHeadlessModelTrainingPlanUseCase} from "../../../../application/use-cases/model/headless-model-training-plan.use-case";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import {createStructuredHeadlessPlanReviewRepository} from "../createStructuredHeadlessPlanReviewRepository";
import {readModelTrainingReviewBindings, type ModelTrainingReviewBinding} from "../headlessModelTrainingReviewBindings";
import {prepareStructuredHeadlessPlanStep, prepareStructuredHeadlessPlanStepWithModels,
  prepareStructuredHeadlessPlanStepWithTraining, type CompileApprovedTrainingMetadata} from "../createStructuredHeadlessPlanStepOperationStore";

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tasks = "headless/models/training-plan-tasks", metadata = "qualification/training-metadata";
type Prepared = NonNullable<Awaited<ReturnType<CompileApprovedTrainingMetadata>>>;
async function fixture(t: TestContext, storage: "Core" | "SQLite" = "Core", options: {
  prefix?: boolean; suffix?: boolean; count?: number; eachChange?: boolean; legacy?: boolean; download?: boolean;
} = {}) {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(join(boundary, "tstep-")));
  const identity = await lstat(directory, {bigint: true});
  let database = storage === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  let base = database?.documents ?? createInMemoryStructuredDocumentStore();
  const state = {current: true, allowed: true, requestAllowed: true, now: 1000, compiles: 0, drops: 0,
    onCompile: undefined as (() => Promise<void>) | undefined,
    transform: undefined as ((value: Prepared) => unknown) | undefined,
    afterCommit: undefined as ((value: unknown) => Promise<void>) | undefined,
    dropWhen: undefined as ((value: unknown) => boolean) | undefined};
  function wrap(actual: StructuredDocumentStore) {
    const root = Object.create(actual) as StructuredDocumentStore;
    const transaction = actual.runInOwnedTransaction!.bind(actual);
    Object.defineProperty(root, "runInOwnedTransaction", {value: async <T,>(visit: (owner: StructuredDocumentStore) => Promise<T>, fence: () => void) => {
      const value = await transaction(visit, fence);
      await state.afterCommit?.(value);
      if (state.dropWhen?.(value)) {state.dropWhen = undefined; state.drops++; throw new Error("Synthetic lost reply after commit.");}
      return value;
    }});
    return root;
  }
  let root = wrap(base);
  t.after(async () => {
    await database?.close(); const current = await lstat(directory, {bigint: true});
    assert.equal(dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    await rm(directory, {recursive: true});
  });
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const scope = Object.freeze({organizationId: createOrganizationId("org.training-step"), workspaceId: createWorkspaceId("workspace.training-step"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()});
  const at = "2026-11-21T00:00:00.000Z";
  const training = () => ({operation: "models.train", idempotencyKey: randomUUID(), name: "Private trial",
    model: {modelRecordId: "model.synthetic", updatedAt: at},
    dataset: {datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64)},
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 2, seed: 0}, validation: {enabled: false}}});
  const ordinary = () => ({operation: "systems.create", idempotencyKey: randomUUID(), name: "Support system", templateId: "reference.secured-data-review@1.0.0"});
  const proposal = {hostIncarnationId: host, workspaceId: scope.workspaceId,
    steps: [...(options.prefix ? [ordinary()] : []), ...Array.from({length: options.count ?? 1}, training), ...(options.suffix ? [ordinary()] : [])]};
  if (options.download) {
    const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/download", revision: "a".repeat(40),
      format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
        path, sizeBytes: 10, integrity: {algorithm: "sha256", digest: "b".repeat(64)}})), totalBytes: 30, excludedFileCount: 0,
      sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
      {provider: "huggingface", modelId: "fixture/download", revision: "a".repeat(40)});
    (proposal.steps as unknown[]).push({operation: "models.download", idempotencyKey: randomUUID(), name: "Later model",
      sourceManifest: {source, manifestDigest: "sha256:" + sha(source)}, allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 1800});
  }
  const parsed = parseHeadlessBuildPlanProposal(proposal, host, {allowLocalFileSave: false, allowModelTraining: true, allowModelDownload: options.download === true}); assert.ok(parsed.ok);
  const selected = parsed.requests.find(value => value.operation === "models.train"); assert.ok(selected?.operation === "models.train");
  const inputs = readHeadlessModelTrainingInputsValue({workspaceId: scope.workspaceId,
    model: {...selected.input.model, source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface",
      modelId: "fixture/base", taskTags: ["chat"], serializationFormat: "safetensors"},
    dataset: {datasetId: selected.input.dataset.datasetId, version: {versionId: selected.input.dataset.versionId, versionDigest: selected.input.dataset.versionDigest,
      createdAt: at, totalRows: 10, sourceCount: 1, artifactCount: 4, parentVersionId: null, splitSeed: 0, recipeDigest: "sha256:" + "b".repeat(64),
      quality: {policyFingerprint: "sha256:" + "c".repeat(64), reportFingerprint: "sha256:" + "d".repeat(64)},
      splits: [{role: "train", rowCount: 6}, {role: "validation", rowCount: 2}, {role: "test", rowCount: 2}]}},
    verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked", resourceAdmission: "not-checked",
      licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"}, trainingApproval: "required"}, selected.input); assert.ok(inputs);
  const compileValue = async (request: HeadlessModelTrainingPlanRequest, value: HeadlessModelTrainingInputsValue) => {
    const result = await new PrepareHeadlessModelTrainingPlanUseCase({organizationId: scope.organizationId,
      inputs: {async execute() {return {ok: true, operation: "models.preview-training-inputs", value};}}}).execute(request,
      {hostIncarnationId: host, context: {organizationId: scope.organizationId, principalId: scope.principalId, workspaceId: scope.workspaceId},
        clientId: scope.registeredClientId, isCurrent: () => true, stillAllowed: async () => true});
    assert.ok(result.ok); return result.prepared;
  };
  const bindings: ModelTrainingReviewBinding[] = [];
  for (const [index, request] of parsed.requests.entries()) if (request.operation === "models.train") {
    const fresh = await compileValue(request, inputs);
    // A complete actual legacy metadata-producer encoding, not a partial hash.
    const stored = options.legacy ? {step: index + 1, inputs, proposalDigest: "sha256:" + sha({request, inputs})}
      : {step: index + 1, inputs: fresh.inputs, proposalDigest: fresh.proposalDigest};
    bindings.push(stored);
  }
  assert.ok(readModelTrainingReviewBindings(bindings, parsed.requests));
  const target = {hostIncarnationId: host, scope: {...scope}, fingerprint: sha(parsed.preview)};
  const isCurrent = () => state.current;
  const reviews = createStructuredHeadlessPlanReviewRepository(root, async () => state.allowed, () => state.now, async () => true,
    false, false, false, false, false, false, undefined, false, false,
    options.download ? async () => parsed.requests.flatMap((request, index) => request.operation === "models.download"
      ? [{step: index + 1, manifestDigest: request.input.sourceManifest.manifestDigest}] : []) : undefined,
    false, false, {bind: async () => bindings});
  assert.ok((await reviews.propose({target, proposal, isCurrent})).ok);
  const decide = (revision: number, step = 1) => new HeadlessBuildPlanReviewUseCase(reviews, () => state.now).decide({
    fingerprint: target.fingerprint, expectedRevision: revision, decision: options.eachChange ? {kind: "approve", mode: "each-change", step} : {kind: "approve", mode: "whole-plan"}},
    host, scope, {organizationId: scope.organizationId, principalId: scope.principalId, channel: options.eachChange ? "app-popup" : "authenticated-chat",
      isCurrent, canDecide: async () => state.allowed});
  assert.ok((await decide(1)).ok);
  const update = (value: HeadlessModelTrainingInputsValue) => root.runInOwnedTransaction!(owner =>
    owner.forOrganization(scope.organizationId).writeDocument(metadata, "current", copy(value)), () => {});
  await update(inputs);
  let lastCompiled: Prepared | undefined;
  const compile: CompileApprovedTrainingMetadata = async (owner, request, actual) => {
    state.compiles++; assert.deepEqual(actual, scope); assert.equal(owner.organizationId, undefined);
    const row = await owner.forOrganization(scope.organizationId).readDocument<HeadlessModelTrainingInputsValue>(metadata, "current");
    if (!row) return;
    const fresh = await compileValue(request, row.value); lastCompiled = fresh;
    await state.onCompile?.();
    return (state.transform ? state.transform(fresh) : fresh) as Prepared;
  };
  const authorize = async (_owner: StructuredDocumentStore, actual: Parameters<CompileApprovedTrainingMetadata>[2], request?: unknown) => state.allowed &&
    (!request || state.requestAllowed) && JSON.stringify(actual) === JSON.stringify(scope);
  const args = (step = options.prefix ? 2 : 1, approvalRevision = 2) => {
    const tuple: Parameters<typeof prepareStructuredHeadlessPlanStepWithTraining> = [root, {target, approvalRevision, step, isCurrent}, authorize, () => state.now];
    tuple[14] = compile; return tuple;
  };
  const prepare = async (step?: number, revision?: number) => {
    const value = await prepareStructuredHeadlessPlanStepWithTraining(...args(step, revision)); assert.ok(value?.kind === "model-training"); return value;
  };
  return {get root() {return root;}, get partition() {return root.forOrganization(scope.organizationId);}, scope, host, target, state, inputs, bindings,
    selected, parsed, args, prepare, compile, compileValue, decide, update, get lastCompiled() {return lastCompiled;},
    rows: () => root.forOrganization(scope.organizationId).listDocuments(tasks),
    async reopen() {assert.ok(database); await database.close(); database = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}); base = database.documents; root = wrap(base);}};
}

for (const storage of ["Core", "SQLite"] as const) {
  test(storage + ": training step uses actual approval and original ledger, with historical replay and no new compilation", async t => {
    const f = await fixture(t, storage), p = await f.prepare();
    assert.equal(f.state.compiles, 0); assert.deepEqual(await p.inspect(), {kind: "absent"});
    const reserved = await p.reserve(); assert.ok(reserved?.kind === "new"); assert.equal(f.state.compiles, 1);
    assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "issued"); assert.equal(f.state.compiles, 2);
    assert.equal(await p.accept(reserved.taskId), true); assert.equal(await p.accept(reserved.taskId), true);
    if (storage === "SQLite") await f.reopen();
    f.state.onCompile = async () => assert.fail("Historical lookup must not invoke a new compiler or runtime.");
    const replay = await f.prepare(); assert.deepEqual(await replay.inspect(), {kind: "accepted", reference: {workspaceId: f.scope.workspaceId, taskId: reserved.taskId}});
    assert.equal((await replay.reserve())?.kind, "accepted"); assert.equal(f.state.compiles, 2); assert.equal((await f.rows()).length, 1);
    assert.equal(await replay.issue(reserved.taskId, reserved.proposalDigest), "denied");
    assert.equal(await replay.accept(reserved.taskId), false); assert.equal(await replay.recordNotStarted(reserved.taskId, reserved.proposalDigest), false);
    assert.deepEqual(await replay.readReceipt(), {workspaceId: f.scope.workspaceId, taskId: reserved.taskId});
    let sends = 0; assert.equal(await replay.publishIfCurrent(() => {sends++; return true;}), true); assert.equal(sends, 1);
    f.state.requestAllowed = false; assert.equal(await replay.publishIfCurrent(() => {sends++; return true;}), false); assert.equal(sends, 1);
  });

  test(storage + ": training step preserves the original complete legacy digest through fresh canonical compilation", async t => {
    const f = await fixture(t, storage, {legacy: true}), p = await f.prepare(), reserved = await p.reserve();
    assert.ok(reserved?.kind === "new"); assert.ok(f.lastCompiled);
    assert.notEqual(f.lastCompiled.proposalDigest, f.bindings[0].proposalDigest);
    assert.equal(reserved.proposalDigest, f.bindings[0].proposalDigest);
    assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "issued"); assert.equal(await p.accept(reserved.taskId), true);
    const row = (await f.rows())[0].value as {proposalDigest: string}; assert.equal(row.proposalDigest, f.bindings[0].proposalDigest);
    assert.equal((await (await f.prepare()).inspect())?.kind, "accepted");
  });

  test(storage + ": training step refuses valid changed metadata before reservation and before issue", async t => {
    const f = await fixture(t, storage), p = await f.prepare(), changed = {...copy(f.inputs), model: {...copy(f.inputs.model), parameterCount: 64}};
    assert.ok(readHeadlessModelTrainingInputsValue(changed, f.selected.input));
    await f.update(changed); assert.equal(await p.reserve(), undefined); assert.equal((await f.rows()).length, 0);
    assert.ok(f.lastCompiled && readModelTrainingReviewBindings([{step: 1, inputs: f.lastCompiled.inputs, proposalDigest: f.lastCompiled.proposalDigest}], [f.selected]));
    await f.update(f.inputs); const reserved = await p.reserve(); assert.ok(reserved?.kind === "new");
    await f.update(changed); assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "denied");
    assert.equal(await p.recordNotStarted(reserved.taskId, reserved.proposalDigest), true);
    assert.deepEqual(await (await f.prepare()).inspect(), {kind: "not-started"}); assert.equal((await f.rows()).length, 1);
  });

  test(storage + ": training step rechecks specific permission after a valid compiler reply", async t => {
    const f = await fixture(t, storage), p = await f.prepare();
    f.state.onCompile = async () => {f.state.requestAllowed = false;};
    assert.equal(await p.reserve(), undefined); assert.equal(f.state.compiles, 1); assert.ok(f.lastCompiled);
    assert.equal((await f.rows()).length, 0);
  });

  test(storage + ": training step keeps a lost reservation unconfirmed without another compilation or task", async t => {
    const f = await fixture(t, storage), p = await f.prepare();
    f.state.dropWhen = value => Boolean(value && typeof value === "object" && "kind" in value && value.kind === "new");
    assert.equal(await p.reserve(), undefined); assert.equal(f.state.drops, 1); assert.deepEqual(await p.inspect(), {kind: "unconfirmed"});
    const replay = await f.prepare(); assert.deepEqual(await replay.reserve(), {kind: "unconfirmed"}); assert.equal(f.state.compiles, 1);
    assert.equal(await replay.accept(randomUUID()), false); assert.equal((await f.rows()).length, 1);
  });

  test(storage + ": training step retains a lost issuance reply and refuses a conflicting non-start or repeat issue", async t => {
    const f = await fixture(t, storage), p = await f.prepare(), reserved = await p.reserve(); assert.ok(reserved?.kind === "new");
    f.state.dropWhen = value => value === "issued";
    assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "unconfirmed"); assert.equal(f.state.drops, 1);
    assert.equal(await p.recordNotStarted(reserved.taskId, reserved.proposalDigest), false); assert.equal(await p.accept(reserved.taskId), false);
    assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "unconfirmed");
    const replay = await f.prepare(); assert.deepEqual(await replay.reserve(), {kind: "unconfirmed"});
    assert.equal(f.state.compiles, 2); assert.equal((await f.rows()).length, 1);
  });

  test(storage + ": training step reconciles a lost accepted reply only through the original historical receipt", async t => {
    const f = await fixture(t, storage), p = await f.prepare(), reserved = await p.reserve(); assert.ok(reserved?.kind === "new");
    assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "issued");
    f.state.dropWhen = value => value === true;
    assert.equal(await p.accept(reserved.taskId), false); assert.equal(f.state.drops, 1);
    assert.equal(await p.accept(reserved.taskId), false); assert.equal(await p.recordNotStarted(reserved.taskId, reserved.proposalDigest), false);
    f.state.onCompile = async () => assert.fail("Never recompile or restart an accepted original task.");
    const replay = await f.prepare(); assert.deepEqual(await replay.readReceipt(), {workspaceId: f.scope.workspaceId, taskId: reserved.taskId});
    assert.equal((await replay.reserve())?.kind, "accepted"); assert.equal(f.state.compiles, 2); assert.equal((await f.rows()).length, 1);
  });

  test(storage + ": training step records an admitted outcome after only the outward request ends", async t => {
    const f = await fixture(t, storage), p = await f.prepare(), reserved = await p.reserve(); assert.ok(reserved?.kind === "new");
    assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "issued");
    f.state.current = false; f.state.allowed = false;
    assert.equal(await p.accept(reserved.taskId), true); assert.equal(await p.recordNotStarted(reserved.taskId, reserved.proposalDigest), false);
    let sends = 0; assert.equal(await p.publishIfCurrent(() => {sends++; return true;}), false); assert.equal(sends, 0);
    f.state.current = true; f.state.allowed = true;
    assert.deepEqual(await (await f.prepare()).readReceipt(), {workspaceId: f.scope.workspaceId, taskId: reserved.taskId});
  });
}

test("Training step known non-start cannot run another compiler or issue attempt", async t => {
  const f = await fixture(t), p = await f.prepare(), reserved = await p.reserve(); assert.ok(reserved?.kind === "new");
  assert.equal(await p.recordNotStarted(reserved.taskId, reserved.proposalDigest), true);
  f.state.onCompile = async () => assert.fail("A known terminal non-start has no new source admission.");
  assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "denied");
  assert.equal(f.state.compiles, 1); assert.equal((await f.rows()).length, 1);
  assert.deepEqual(await (await f.prepare()).reserve(), {kind: "not-started"});
});

test("Training step legacy wrappers deny the entire plan before ordinary mutations even when supplied a compiler", async t => {
  const f = await fixture(t, "Core", {prefix: true});
  for (const step of [1, 2]) {
    assert.equal(await prepareStructuredHeadlessPlanStep(...f.args(step)), undefined);
    assert.equal(await prepareStructuredHeadlessPlanStepWithModels(...f.args(step)), undefined);
  }
  const missing = f.args(); missing[14] = undefined;
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...missing), undefined);
  assert.equal(f.state.compiles, 0); assert.equal((await f.rows()).length, 0);
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...f.args(2)), undefined, "Missing earlier ordinary receipt cannot be skipped.");
});

test("Training step accepted predecessor and each-change revision keep the original task", async t => {
  const f = await fixture(t, "Core", {count: 2, eachChange: true}), first = await f.prepare();
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...f.args(2)), undefined);
  const reserved = await first.reserve(); assert.ok(reserved?.kind === "new");
  assert.equal(await first.issue(reserved.taskId, reserved.proposalDigest), "issued"); assert.equal(await first.accept(reserved.taskId), true);
  assert.ok((await f.decide(2, 2)).ok);
  const replay = await f.prepare(1, 3); assert.equal((await replay.inspect())?.kind, "accepted");
  assert.deepEqual(await replay.readReceipt(), {workspaceId: f.scope.workspaceId, taskId: reserved.taskId});
  const next = await f.prepare(2, 3), nextReservation = await next.reserve(); assert.ok(nextReservation?.kind === "new");
  assert.notEqual(nextReservation.taskId, reserved.taskId); assert.equal((await f.rows()).length, 2);
});

test("Training step only an accepted training receipt unlocks the next ordinary step", async t => {
  const f = await fixture(t, "Core", {suffix: true}), first = await f.prepare();
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...f.args(2)), undefined);
  const reserved = await first.reserve(); assert.ok(reserved?.kind === "new");
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...f.args(2)), undefined);
  assert.equal(await first.issue(reserved.taskId, reserved.proposalDigest), "issued");
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...f.args(2)), undefined);
  assert.equal(await first.accept(reserved.taskId), true);
  assert.equal((await prepareStructuredHeadlessPlanStepWithTraining(...f.args(2)))?.kind, "system");
  assert.equal(await prepareStructuredHeadlessPlanStepWithModels(...f.args(2)), undefined);
});

test("Training step concurrent prepared requests reserve only one original task", async t => {
  const f = await fixture(t), first = await f.prepare(), second = await f.prepare();
  const rows = await Promise.all([first.reserve(), second.reserve()]);
  assert.equal(rows.filter(value => value?.kind === "new").length, 1);
  assert.equal(rows.filter(value => value?.kind === "unconfirmed").length, 1);
  assert.equal(f.state.compiles, 1); assert.equal((await f.rows()).length, 1);
  const index = rows.findIndex(value => value?.kind === "new"), reserved = rows[index]; assert.ok(reserved?.kind === "new");
  const nonowner = index === 0 ? second : first;
  assert.equal(await nonowner.issue(reserved.taskId, reserved.proposalDigest), "denied");
  assert.equal(await nonowner.recordNotStarted(reserved.taskId, reserved.proposalDigest), false);
});

for (const variant of ["request", "deadline"] as const) test("Training step refuses " + variant + " retirement through the compiler wait", async t => {
  const f = await fixture(t), p = await f.prepare();
  f.state.onCompile = async () => {if (variant === "request") f.state.current = false; else f.state.now = Number.MAX_SAFE_INTEGER;};
  assert.equal(await p.reserve(), undefined); assert.ok(f.lastCompiled); assert.equal(f.state.compiles, 1); assert.equal((await f.rows()).length, 0);
});

test("Training step rejects a separately valid compiled request with different exact settings", async t => {
  const f = await fixture(t), p = await f.prepare();
  const changed = {...copy(f.selected), input: {...copy(f.selected.input), training: {...copy(f.selected.input.training),
    commonParameters: {...copy(f.selected.input.training.commonParameters), maxSteps: 3}}}};
  const different = await f.compileValue(changed, f.inputs);
  assert.ok(readModelTrainingReviewBindings([{step: 1, inputs: different.inputs, proposalDigest: different.proposalDigest}], [changed]));
  f.state.transform = () => different;
  assert.equal(await p.reserve(), undefined); assert.equal(f.state.compiles, 1); assert.equal((await f.rows()).length, 0);
});

for (const variant of ["getter", "proxy", "extra-proof", "installation-grant"] as const) {
  test("Training step refuses active or authority-like compiled metadata: " + variant, async t => {
    const f = await fixture(t), p = await f.prepare(); let hooks = 0;
    f.state.transform = fresh => {
      const value = copy(fresh);
      if (variant === "getter") {Object.defineProperty(value, "inputs", {enumerable: true, get() {hooks++; return fresh.inputs;}}); return value;}
      if (variant === "proxy") return new Proxy(value, {ownKeys() {hooks++; return Reflect.ownKeys(value);}});
      if (variant === "extra-proof") return {...value, nativeProof: true};
      return {...value, installationPermission: "granted"};
    };
    assert.equal(await p.reserve(), undefined); assert.equal(hooks, 0); assert.equal((await f.rows()).length, 0);
  });
}

test("Training step captures original compiler and scope while exposing immutable private facts", async t => {
  const f = await fixture(t), tuple = f.args(), p = await prepareStructuredHeadlessPlanStepWithTraining(...tuple);
  assert.ok(p?.kind === "model-training"); let replacements = 0;
  tuple[14] = async () => {replacements++; return undefined;};
  Object.assign(tuple[1].target.scope, {principalId: "changed.actor"});
  assert.ok(Object.isFrozen(p.request) && Object.isFrozen(p.request.input.training.commonParameters) && Object.isFrozen(p.binding.inputs.model));
  const reserved = await p.reserve(); assert.ok(reserved?.kind === "new"); assert.equal(replacements, 0);
  const row = (await f.rows())[0].value as {owner: {principalId: string}};
  assert.equal(row.owner.principalId, f.scope.principalId);
});

test("Training step denies missing policy and foreign original identity without compiling inputs", async t => {
  const f = await fixture(t); f.state.allowed = false;
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...f.args()), undefined); f.state.allowed = true;
  for (const patch of [{principalId: "foreign.actor"}, {registeredClientId: randomUUID()},
    {workspaceId: createWorkspaceId("workspace.foreign")}, {organizationId: createOrganizationId("org.foreign")}]) {
    const args = f.args(); args[1] = {...args[1], target: {...args[1].target, scope: {...args[1].target.scope, ...patch}}};
    assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...args), undefined);
  }
  let hooks = 0; const args = f.args(); args[14] = new Proxy(f.compile, {apply() {hooks++; return Promise.resolve(undefined);}});
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...args), undefined);
  assert.equal(f.state.compiles, 0); assert.equal(hooks, 0); assert.equal((await f.rows()).length, 0);
});

for (const storage of ["Core", "SQLite"] as const) test(storage + ": training step cannot record non-start while its issued acknowledgement is held", async t => {
  const f = await fixture(t, storage), p = await f.prepare(), reserved = await p.reserve(); assert.ok(reserved?.kind === "new");
  let release!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;}), entered = new Promise<void>(resolve => {reached = resolve;});
  f.state.afterCommit = async value => {if (value === "issued") {reached(); await held;}};
  const pending = p.issue(reserved.taskId, reserved.proposalDigest);
  let nonstart: boolean, phase: unknown, reply: string;
  try {
    await entered;
    assert.equal(p.isStartCurrent(), false); assert.equal(p.isCurrent(), true);
    nonstart = await p.recordNotStarted(reserved.taskId, reserved.proposalDigest);
    phase = ((await f.rows())[0].value as {phase: unknown}).phase;
  } finally {release(); reply = await pending;}
  assert.equal(nonstart, false, "Unresolved issuance cannot be replaced with a terminal non-start.");
  assert.equal(phase, "issued"); assert.equal(reply, "issued");
  assert.equal(p.isStartCurrent(), true);
  assert.equal(await p.accept(reserved.taskId), true); assert.equal(p.isStartCurrent(), false); assert.equal(p.isCurrent(), true);
});

test("Training step private wrapper does not implicitly grant Model downloads", async t => {
  const f = await fixture(t, "Core", {download: true});
  assert.equal(await prepareStructuredHeadlessPlanStepWithTraining(...f.args(1)), undefined);
  assert.equal(f.state.compiles, 0); assert.equal((await f.rows()).length, 0);
  const explicit = f.args(1); explicit[12] = true;
  assert.equal((await prepareStructuredHeadlessPlanStepWithTraining(...explicit))?.kind, "model-training");
});

test("Training step local start fence is distinct from historical request authority", async t => {
  const f = await fixture(t), p = await f.prepare();
  assert.equal(p.isStartCurrent(), false); assert.equal(p.isCurrent(), true);
  const reserved = await p.reserve(); assert.ok(reserved?.kind === "new"); assert.equal(p.isStartCurrent(), true);
  assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "issued"); assert.equal(p.isStartCurrent(), true);
  assert.equal(await p.recordNotStarted(reserved.taskId, reserved.proposalDigest), true);
  assert.equal(p.isStartCurrent(), false); assert.equal(p.isCurrent(), true); assert.equal(await p.stillAllowed(), true);
  assert.deepEqual(await p.inspect(), {kind: "not-started"});
  const historical = await f.prepare(); assert.equal(historical.isStartCurrent(), false); assert.equal(historical.isCurrent(), true);
});

test("Training step uncertain issue keeps its local start fence closed while history remains inspectable", async t => {
  const f = await fixture(t), p = await f.prepare(), reserved = await p.reserve(); assert.ok(reserved?.kind === "new");
  f.state.dropWhen = value => value === "issued";
  assert.equal(await p.issue(reserved.taskId, reserved.proposalDigest), "unconfirmed");
  assert.equal(p.isStartCurrent(), false); assert.equal(p.isCurrent(), true); assert.equal(await p.stillAllowed(), true);
  assert.deepEqual(await p.inspect(), {kind: "unconfirmed"});
});
