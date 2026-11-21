import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test, {type TestContext} from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readModelDownloadSource} from "../../../../contracts/model";
import {TaskType, type RuntimeTaskRecord, type StartRuntimeTaskResult} from "../../../../contracts/runtime";
import type {ApprovedModelSourceDownloadRequest, ApprovedModelSourceDownloadControl} from "../../../ports/model";
import {OwnedTaskReconcilerService} from "../../../services/runtime/owned-task-reconciler.service";
import {ModelDownloadTasksUseCase, type ApprovedModelDownloadAdmission} from "../model-download-tasks.use-case";

const workspaceId = createWorkspaceId("workspace.source-app"), revision = "a".repeat(40), modelId = "fixture/model";
const taskId = "11111111-1111-4111-8111-111111111111";
function fixture(t: TestContext) {
  const source = readModelDownloadSource({provider: "huggingface", modelId, revision, format: "transformers-safetensors", license: {kind: "unknown"},
    files: ["config.json", "model.safetensors", "tokenizer.json"].map(name => ({path: name, sizeBytes: 2,
      integrity: name.endsWith("safetensors") ? {algorithm: "sha256", digest: "b".repeat(64)} : {algorithm: "git-blob-sha1", digest: "c".repeat(40)}})),
    totalBytes: 6, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId, revision});
  const request = {workspaceId, provider: "huggingface" as const, modelId, revision, displayName: "Synthetic model"};
  const sourceRequest: ApprovedModelSourceDownloadRequest = {requestId: taskId, workspaceId,
    sourceManifest: {source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")},
    maximumDurationSeconds: 10, allowedOrigins: ["https://huggingface.co"]};
  const authority = {organizationId: createOrganizationId("org.source-app"), principalId: "principal.source-app", modelWriteAuthorized: true};
  const reconciler = new OwnedTaskReconcilerService(); t.after(() => reconciler.stopObservation());
  let current = true, allowed = true, acks = 0, starts = 0, reads = 0, cancels = 0, registered = 0, ordinary = 0, lists = 0;
  const events: string[] = [], records = new Map<string, RuntimeTaskRecord>();
  let acknowledge: (() => Promise<boolean>) | undefined;
  let dispatch: ((r: ApprovedModelSourceDownloadRequest, c: ApprovedModelSourceDownloadControl) => Promise<any>) | undefined;
  let completed: unknown, completionReads = 0, completionReader: (() => Promise<unknown>) | undefined;
  const admission: ApprovedModelDownloadAdmission = {source: sourceRequest, control: {isCurrent: () => current, stillAllowed: async () => allowed},
    async acknowledgeIssued() {acks++; events.push("ack"); return acknowledge ? acknowledge() : true;}};
  const dependencies = {
    taskReconciler: reconciler,
    approvedModelSourceDownload: {async startApprovedModelSource(r: ApprovedModelSourceDownloadRequest, c: ApprovedModelSourceDownloadControl) {
      starts++; events.push("source");
      const original: RuntimeTaskRecord = {requestId: r.requestId, workspaceId: r.workspaceId, taskType: TaskType.MODEL_DOWNLOAD,
        status: "running", concurrencyClass: "io", updatedAt: "2026-11-19T00:00:00Z"};
      records.set(r.requestId, original);
      const task = Object.freeze({requestId: r.requestId, workspaceId: r.workspaceId, modelId: r.sourceManifest.source.modelId,
        revision: r.sourceManifest.source.revision, manifestDigest: r.sourceManifest.manifestDigest,
        read: async () => {reads++; return {...original};},
        cancel: async () => {cancels++; return {requestId: r.requestId, status: original.status, cancelled: false};},
        readCompleted: async () => {completionReads++; return (completionReader ? await completionReader() : completed) as never;}});
      const result = dispatch ? await dispatch(r, c) : {kind: "accepted" as const, value: {requestId: r.requestId, status: "running" as const}};
      return result.kind === "accepted" ? {task, ...result} : result;
    }},
    runtimeTaskRegistry: {
      async startTask(): Promise<StartRuntimeTaskResult> {ordinary++; return {requestId: "ordinary", status: "running"};},
      async getTaskStatus(id: string) {reads++; if (!records.has(id)) throw new Error("No owned record."); return {...records.get(id)!};},
      async cancelTask(id: string) {cancels++; return {requestId: id, status: records.get(id)!.status, cancelled: false};},
      async listTasks() {lists++; return {tasks: [...records.values()]};},
    },
    modelDownloadCompletion: {async readCompletedModelDownload() {return undefined;}},
    modelRegistry: {async registerDownloadedModel() {registered++; assert.fail("A transfer cannot register a Model.");}} as never,
  };
  const useCase = new ModelDownloadTasksUseCase(dependencies);
  return {request, sourceRequest, admission, authority, reconciler, useCase, records, dependencies, events,
    counts: () => ({acks, starts, reads, cancels, registered, ordinary, lists}),
    acknowledge(value: typeof acknowledge) {acknowledge = value;}, dispatch(value: typeof dispatch) {dispatch = value;},
    completed(value: unknown) {completed = value;}, readCompletion(value: typeof completionReader) {completionReader = value;},
    completionReads: () => completionReads,
    deny() {allowed = false;}, retire() {current = false;}};
}

function completionFor(f: ReturnType<typeof fixture>) {
  return {provider: "transformers", modelId, revision, verifiedManifestDigest: f.sourceRequest.sourceManifest.manifestDigest,
    downloaded: true, fromCache: false, localPath: "synthetic-private-cache-not-for-display"};
}
async function succeedSource(f: ReturnType<typeof fixture>, admission = f.admission) {
  assert.equal((await f.useCase.startApprovedSource(f.request, admission, f.authority)).kind, "accepted");
  f.completed(completionFor(f)); f.records.get(taskId)!.status = "succeeded";
  await f.useCase.read({workspaceId, requestId: taskId}, f.authority); await f.reconciler.reconcileNow();
  assert.equal(f.reconciler.status.pending, 0);
}

test("cached source review returns detached finite historical verification without paths, refresh, save or retirement", async t => {
  for (const fromCache of [false, true]) {
    const f = fixture(t); await succeedSource(f); f.completed({...completionFor(f), fromCache});
    const before = f.counts(), review = await f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, f.authority);
    assert.deepEqual(review, {requestId: taskId, workspaceId, modelId, revision,
      manifestDigest: f.sourceRequest.sourceManifest.manifestDigest, format: "transformers-safetensors", license: {kind: "unknown"},
      selectedFileCount: 3, totalBytes: 6, fromCache, selectedFilesVerification: "verified-at-completion", runtimeReadiness: "not-checked"});
    assert.deepEqual(f.counts(), before); assert.equal(f.completionReads(), 1);
    assert.doesNotMatch(JSON.stringify(review), /localPath|synthetic-private-cache|registered|fileAuthority/);
    assert.ok(Object.isFrozen(review)); assert.ok(Object.isFrozen(review?.license));
    const again = await f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, f.authority);
    assert.deepEqual(again, review); assert.notEqual(again, review); assert.notEqual(again?.license, review?.license);
    await assert.rejects(f.useCase.complete({workspaceId, requestId: taskId}, f.authority), /separately scoped/);
    assert.deepEqual(f.counts(), before);
  }
});

test("source review preserves declared non-open licensing without asserting rights or readiness", async t => {
  const f = fixture(t);
  const source = readModelDownloadSource({...f.sourceRequest.sourceManifest.source,
    license: {kind: "provider-declared", identifier: "proprietary"}}, {provider: "huggingface", modelId, revision});
  (f.sourceRequest as {sourceManifest: typeof f.sourceRequest.sourceManifest}).sourceManifest = {
    source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")};
  await succeedSource(f);
  const review = await f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, f.authority);
  assert.deepEqual(review?.license, {kind: "provider-declared", identifier: "proprietary"});
  assert.equal(review?.runtimeReadiness, "not-checked"); assert.doesNotMatch(JSON.stringify(review), /rightsGranted|runtimeReady/);
});

test("ordinary, unknown, running and unsuccessful source states cannot read cached source completion", async t => {
  for (const state of ["ordinary", "unknown", "running", "failed", "cancelled"] as const) {
    const f = fixture(t);
    if (state === "ordinary") await f.useCase.start(f.request, f.authority);
    else {
      if (state === "unknown") f.dispatch(async () => ({kind: "unconfirmed"}));
      await f.useCase.startApprovedSource(f.request, f.admission, f.authority);
      if (state === "failed" || state === "cancelled") {
        f.records.get(taskId)!.status = state; await f.useCase.read({workspaceId, requestId: taskId}, f.authority);
      }
    }
    f.completed(completionFor(f)); const before = f.counts();
    assert.equal(await f.useCase.peekApprovedSourceReview({workspaceId, requestId: state === "ordinary" ? "ordinary" : taskId}, f.authority), undefined);
    assert.deepEqual(f.counts(), before); assert.equal(f.completionReads(), 0);
  }
});

test("a successful task without exact cached byte confirmation is not a verified source review", async t => {
  const changes = [undefined, {provider: "huggingface"}, {modelId: "fixture/other"}, {revision: "d".repeat(40)},
    {verifiedManifestDigest: "sha256:" + "d".repeat(64)}, {verifiedManifestDigest: undefined}, {revision: undefined},
    {downloaded: false}, {fromCache: "true"}, {localPath: ""}, {localPath: undefined}, {runtimeReady: true}];
  for (const patch of changes) {
    const f = fixture(t); await succeedSource(f);
    f.completed(patch === undefined ? undefined : {...completionFor(f), ...patch});
    const before = f.counts();
    assert.equal(await f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, f.authority), undefined);
    assert.deepEqual(f.counts(), before); assert.equal(f.completionReads(), 1);
  }
});

test("cached active results and private completion errors cannot run validation hooks or escape as review", async t => {
  const f = fixture(t); await succeedSource(f); let hooks = 0;
  const getter = Object.defineProperty(completionFor(f), "revision", {enumerable: true, get() {hooks++; return revision;}});
  const proxy = new Proxy(completionFor(f), {getPrototypeOf() {hooks++; return null;}, ownKeys() {hooks++; return [];}});
  for (const result of [getter, proxy]) {
    f.completed(result); assert.equal(await f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, f.authority), undefined);
  }
  f.readCompletion(async () => {throw new Error("Synthetic private completion detail.");});
  assert.equal(await f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, f.authority), undefined);
  assert.equal(hooks, 0); assert.equal(f.counts().registered, 0);
});

test("cached source review requires the original actor/workspace but does not reuse former write approval as read policy", async t => {
  const f = fixture(t); await succeedSource(f); f.deny();
  for (const authority of [{...f.authority, organizationId: createOrganizationId("foreign.org")}, {...f.authority, principalId: "foreign.actor"}])
    await assert.rejects(f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, authority), /not found/);
  await assert.rejects(f.useCase.peekApprovedSourceReview({workspaceId: createWorkspaceId("foreign.workspace"), requestId: taskId}, f.authority), /not found/);
  assert.equal(f.completionReads(), 0);
  const before = f.counts();
  assert.ok(await f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, {...f.authority, modelWriteAuthorized: false}));
  assert.deepEqual(f.counts(), before); assert.equal(f.completionReads(), 1);
});

test("retired, thrown and asynchronous original host currentness deny before cached completion reads", async t => {
  const f = fixture(t); let mode: "current" | "retired" | "throw" | "async" = "current";
  const admission: ApprovedModelDownloadAdmission = {...f.admission, control: {...f.admission.control, isCurrent: () => {
    if (mode === "throw") throw new Error("Synthetic host retirement.");
    if (mode === "async") return Promise.reject(new Error("Synthetic asynchronous currentness.")) as never;
    return mode === "current";
  }}};
  await succeedSource(f, admission);
  for (const state of ["retired", "throw", "async"] as const) {
    mode = state; assert.equal(await f.useCase.peekApprovedSourceReview({workspaceId, requestId: taskId}, f.authority), undefined);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.completionReads(), 0);
});

test("held cached review keeps original callback/request ownership and host retirement fences late output", async t => {
  for (const retire of [false, true]) {
    const f = fixture(t); await succeedSource(f);
    let entered!: () => void, release!: () => void;
    const held = new Promise<void>(done => {release = done;}), started = new Promise<void>(done => {entered = done;});
    f.readCompletion(async () => {entered(); await held; return completionFor(f);});
    const request = {workspaceId, requestId: taskId}, authority = {...f.authority};
    const pending = f.useCase.peekApprovedSourceReview(request, authority); await started;
    Object.assign(request, {workspaceId: createWorkspaceId("foreign.workspace"), requestId: "foreign"});
    Object.assign(authority, {principalId: "foreign.actor"});
    (f.admission.control as {isCurrent: () => boolean}).isCurrent = () => false;
    if (retire) {f.retire(); (f.admission.control as {isCurrent: () => boolean}).isCurrent = () => true;}
    release(); const review = await pending;
    if (retire) assert.equal(review, undefined); else assert.equal(review?.workspaceId, workspaceId);
    assert.equal(f.counts().registered, 0);
  }
});

test("original actor and issuance acknowledgement precede the exact source port and independent lease", async t => {
  const f = fixture(t);
  const result = await f.useCase.startApprovedSource(f.request, f.admission, f.authority);
  assert.equal(result.kind, "accepted"); assert.deepEqual(f.events, ["ack", "source"]); assert.equal(f.reconciler.status.pending, 1);
  assert.equal(f.counts().ordinary, 0);
  f.records.get(taskId)!.status = "succeeded"; await f.reconciler.reconcileNow();
  assert.equal(f.reconciler.status.pending, 0); assert.equal(f.counts().registered, 0);
  const read = await f.useCase.read({workspaceId, requestId: taskId}, f.authority);
  assert.equal(read.activity.status, "succeeded"); assert.equal(read.activity.model, undefined);
  await assert.rejects(f.useCase.complete({workspaceId, requestId: taskId}, f.authority), /separately scoped/);
  assert.equal(f.counts().registered, 0);
});

test("missing support, actor, write permission and mismatched source/pin deny before ACK or runtime", async t => {
  for (const variant of ["support", "reconciler", "organization", "principal", "write", "model", "pin", "workspace", "artifact"]) {
    const f = fixture(t), dependencies = {...f.dependencies};
    const authority = {...f.authority}, request = {...f.request};
    if (variant === "support") delete (dependencies as Partial<typeof dependencies>).approvedModelSourceDownload;
    if (variant === "reconciler") delete (dependencies as Partial<typeof dependencies>).taskReconciler;
    if (variant === "organization") authority.organizationId = "" as never;
    if (variant === "principal") authority.principalId = "";
    if (variant === "write") authority.modelWriteAuthorized = false;
    if (variant === "model") request.modelId = "fixture/other";
    if (variant === "pin") request.revision = "d".repeat(40);
    if (variant === "workspace") request.workspaceId = createWorkspaceId("workspace.foreign");
    const owner = new ModelDownloadTasksUseCase(dependencies);
    assert.equal((await owner.startApprovedSource(variant === "artifact" ? {...request, artifactForm: "adapter"} as never : request,
      f.admission, authority)).kind, "unavailable");
    assert.equal(f.counts().acks, 0); assert.equal(f.counts().starts, 0); assert.equal(f.reconciler.status.pending, 0);
  }
});

test("source input/accessors/proxies cannot run hooks or reserve an effect", async t => {
  const f = fixture(t); let hooks = 0;
  const getter = {...f.sourceRequest}; Object.defineProperty(getter, "sourceManifest", {enumerable: true, get() {hooks++; return f.sourceRequest.sourceManifest;}});
  for (const source of [getter, {...f.sourceRequest, install: true}, new Proxy({}, {getPrototypeOf() {hooks++; return null;}})])
    assert.equal((await f.useCase.startApprovedSource(f.request, {...f.admission, source} as never, f.authority)).kind, "unavailable");
  assert.equal(hooks, 0); assert.equal(f.counts().acks, 0); assert.equal(f.counts().starts, 0);
});

test("held ACK keeps original copied source and callback identity and excludes duplicate issue", async t => {
  const f = fixture(t); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  f.acknowledge(async () => {entered(); await held; return true;});
  f.dispatch(async (r, control) => {
    assert.equal(r.sourceManifest.source.modelId, modelId); assert.equal(r.maximumDurationSeconds, 10);
    assert.ok(Object.isFrozen(r.sourceManifest.source.files[0])); assert.equal(await control.stillAllowed(), true);
    return {kind: "accepted", value: {requestId: taskId, status: "running"}};
  });
  const pending = f.useCase.startApprovedSource(f.request, f.admission, f.authority); await started;
  assert.equal((await f.useCase.startApprovedSource(f.request, f.admission, f.authority)).kind, "unavailable");
  f.request.displayName = "changed"; (f.admission as any).source = {...f.sourceRequest, maximumDurationSeconds: 50};
  (f.admission.control as any).stillAllowed = async () => {throw new Error("Replaced callback.");};
  release(); const result = await pending; assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") assert.equal(result.value.activity.displayName, "Synthetic model");
  assert.equal(f.counts().acks, 1); assert.equal(f.counts().starts, 1);
});

test("negative ACK or withdrawn pre-dispatch permission proves no source task effect", async t => {
  for (const variant of ["ack", "policy"]) {
    const f = fixture(t); f.acknowledge(async () => {if (variant === "policy") f.deny(); return variant !== "ack";});
    assert.equal((await f.useCase.startApprovedSource(f.request, f.admission, f.authority)).kind, "unavailable");
    assert.equal(f.counts().starts, 0); assert.equal(f.reconciler.status.pending, 0);
  }
});

test("separate original admission fence closes the final policy await without changing accepted host custody", async t => {
  const f = fixture(t); let admission = true, acknowledged = false;
  const approved: ApprovedModelDownloadAdmission = {...f.admission, isAdmissionCurrent: () => admission,
    acknowledgeIssued: async () => {acknowledged = true; return true;}, control: {...f.admission.control,
      stillAllowed: async () => {if (acknowledged) admission = false; return true;}}};
  assert.equal((await f.useCase.startApprovedSource(f.request, approved, f.authority)).kind, "unavailable");
  assert.equal(acknowledged, true); assert.equal(f.counts().starts, 0); assert.equal(f.reconciler.status.pending, 0);
  const accepted = fixture(t); let requestCurrent = true;
  accepted.dispatch(async () => {requestCurrent = false; return {kind: "accepted", value: {requestId: taskId, status: "running"}};});
  assert.equal((await accepted.useCase.startApprovedSource(accepted.request, {...accepted.admission,
    isAdmissionCurrent: () => requestCurrent}, accepted.authority)).kind, "accepted");
  accepted.records.get(taskId)!.status = "succeeded"; await accepted.reconciler.reconcileNow();
  assert.equal(accepted.reconciler.status.pending, 0);
});

test("captured admission callbacks reject active and asynchronous authority without hooks or dispatch", async t => {
  const f = fixture(t); let hooks = 0;
  const getter = Object.defineProperty({...f.admission}, "isAdmissionCurrent", {enumerable: true, get() {hooks++; return () => true;}});
  const proxy = new Proxy(() => true, {apply() {hooks++; return true;}});
  for (const admission of [getter, {...f.admission, isAdmissionCurrent: proxy},
    {...f.admission, isAdmissionCurrent: () => Promise.reject(new Error("Synthetic async admission.")) as never}])
    assert.equal((await f.useCase.startApprovedSource(f.request, admission, f.authority)).kind, "unavailable");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(hooks, 0); assert.equal(f.counts().starts, 0);
});

test("reconciler shutdown during a held ACK prevents new source dispatch without blocking accepted cleanup", async t => {
  const f = fixture(t); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  f.acknowledge(async () => {entered(); await held; return true;});
  const pending = f.useCase.startApprovedSource(f.request, f.admission, f.authority); await started;
  f.reconciler.stopAccepting(); release(); assert.equal((await pending).kind, "unavailable");
  assert.equal(f.counts().starts, 0); assert.equal(f.reconciler.status.pending, 0);
  const accepted = fixture(t); await accepted.useCase.startApprovedSource(accepted.request, accepted.admission, accepted.authority);
  accepted.reconciler.stopAccepting(); accepted.records.get(taskId)!.status = "succeeded";
  await accepted.reconciler.reconcileNow(); assert.equal(accepted.reconciler.status.pending, 0);
});

test("unknown ACK/start and contradictory replies retain original scope without discovery, cancellation or reissue", async t => {
  for (const variant of ["ack", "throw", "unconfirmed", "foreign", "terminal"]) {
    const f = fixture(t);
    if (variant === "ack") f.acknowledge(async () => {throw new Error("Unknown acknowledgement.");});
    else f.dispatch(async () => {
      if (variant === "throw") throw new Error("Unknown start.");
      return variant === "unconfirmed" ? {kind: "unconfirmed"} : {kind: "accepted", value: {requestId: variant === "foreign" ? "foreign" : taskId,
        status: variant === "terminal" ? "succeeded" : "running"}};
    });
    assert.equal((await f.useCase.startApprovedSource(f.request, f.admission, f.authority)).kind, "unconfirmed");
    assert.equal((await f.useCase.startApprovedSource(f.request, f.admission, f.authority)).kind, "unavailable");
    assert.equal((await f.useCase.read({workspaceId, requestId: taskId}, f.authority)).activity.status, "unknown");
    assert.equal((await f.useCase.cancel({workspaceId, requestId: taskId}, f.authority)).cancelled, false);
    await f.reconciler.reconcileNow(); await f.reconciler.settleAfterRuntimeStop(["python"]);
    assert.equal(f.reconciler.status.pending, 1); assert.equal(f.counts().reads, 0); assert.equal(f.counts().cancels, 0); assert.equal(f.counts().acks, 1);
  }
});

test("foreign actors cannot read or cancel an accepted source and substituted runtime identity cannot close ownership", async t => {
  const f = fixture(t); await f.useCase.startApprovedSource(f.request, f.admission, f.authority);
  await assert.rejects(f.useCase.read({workspaceId, requestId: taskId}, {...f.authority, principalId: "principal.foreign"}));
  await assert.rejects(f.useCase.cancel({workspaceId, requestId: taskId}, {...f.authority, organizationId: createOrganizationId("org.foreign")}));
  assert.equal(f.counts().reads, 0); assert.equal(f.counts().cancels, 0);
  f.records.get(taskId)!.workspaceId = createWorkspaceId("workspace.foreign"); f.records.get(taskId)!.status = "succeeded";
  await assert.rejects(f.useCase.read({workspaceId, requestId: taskId}, f.authority));
  await f.reconciler.reconcileNow(); assert.equal(f.reconciler.status.pending, 1);
});

test("protected source outcome history reaches a fixed bound before admitting more effects", async t => {
  const f = fixture(t);
  for (let i = 0; i < 100; i++) {
    const source = {...f.sourceRequest, requestId: randomUUID()};
    assert.equal((await f.useCase.startApprovedSource(f.request, {...f.admission, source}, f.authority)).kind, "accepted");
  }
  assert.equal((await f.useCase.startApprovedSource(f.request, {...f.admission, source: {...f.sourceRequest, requestId: randomUUID()}}, f.authority)).kind, "unavailable");
  await assert.rejects(f.useCase.start(f.request, f.authority), /reviewed/);
  assert.equal(f.counts().starts, 100); assert.equal(f.counts().acks, 100); assert.equal(f.counts().ordinary, 0);
});

test("unconfirmed source listings never discover a borrowed shared-ID result", async t => {
  const f = fixture(t); f.acknowledge(async () => {throw new Error("Lost acknowledgement.");});
  assert.equal((await f.useCase.startApprovedSource(f.request, f.admission, f.authority)).kind, "unconfirmed");
  f.records.set(taskId, {requestId: taskId, workspaceId, taskType: TaskType.MODEL_DOWNLOAD, status: "succeeded", concurrencyClass: "io"});
  const list = await f.useCase.list({workspaceId, includeCompleted: true}, f.authority);
  assert.equal(list.activities.length, 1); assert.equal(list.activities[0]!.status, "unknown");
  assert.equal(f.counts().lists, 0); assert.equal(f.counts().reads, 0); assert.equal(f.counts().cancels, 0);
});

test("accepted source uses captured result methods after shared-ID replacement or method mutation", async t => {
  const f = fixture(t); let handle: any;
  f.dispatch(async r => {handle = {requestId: r.requestId, workspaceId, modelId, revision, manifestDigest: r.sourceManifest.manifestDigest,
    read: async () => ({requestId: taskId, workspaceId, taskType: TaskType.MODEL_DOWNLOAD, status: "running"}),
    cancel: async () => ({requestId: taskId, status: "running", cancelled: false}), readCompleted: async () => undefined};
    return {kind: "accepted", value: {requestId: taskId, status: "running"}, task: handle};});
  assert.equal((await f.useCase.startApprovedSource(f.request, f.admission, f.authority)).kind, "accepted");
  handle.read = async () => {assert.fail("A substituted handle method cannot run.");};
  f.records.set(taskId, {requestId: taskId, workspaceId, taskType: TaskType.MODEL_DOWNLOAD, status: "succeeded", concurrencyClass: "io"});
  assert.equal((await f.useCase.read({workspaceId, requestId: taskId}, f.authority)).activity.status, "running");
  assert.equal((await f.useCase.list({workspaceId}, f.authority)).activities[0]!.status, "running");
  assert.equal(f.counts().lists, 0); assert.equal(f.counts().reads, 0);
  assert.equal((await f.useCase.cancel({workspaceId, requestId: taskId}, f.authority)).cancelled, false);
});

test("missing, active or mismatched accepted handles retain unknown admission without invoking hooks", async t => {
  for (const variant of ["missing", "proxy", "accessor", "identity"]) {
    const f = fixture(t); let hooks = 0;
    f.dispatch(async r => {
      const task: any = {requestId: taskId, workspaceId, modelId, revision, manifestDigest: r.sourceManifest.manifestDigest,
        read: async () => {hooks++; throw new Error("No read.");}, cancel: async () => {hooks++;}, readCompleted: async () => undefined};
      if (variant === "identity") task.modelId = "fixture/other";
      if (variant === "accessor") Object.defineProperty(task, "read", {enumerable: true, get() {hooks++; throw new Error("No getter.");}});
      return {kind: "accepted", value: {requestId: taskId, status: "running"}, task: variant === "missing" ? undefined :
        variant === "proxy" ? new Proxy(task, {getPrototypeOf() {hooks++; throw new Error("No proxy hook.");}}) : task};
    });
    assert.equal((await f.useCase.startApprovedSource(f.request, f.admission, f.authority)).kind, "unconfirmed");
    await f.reconciler.reconcileNow(); assert.equal(f.reconciler.status.pending, 1); assert.equal(hooks, 0);
  }
});
