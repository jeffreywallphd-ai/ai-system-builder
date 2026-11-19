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
        readCompleted: async () => undefined});
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
    deny() {allowed = false;}, retire() {current = false;}};
}

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
