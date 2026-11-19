import assert from "node:assert/strict";
import test from "node:test";
import type {ModelInventoryRecord} from "../../../../contracts/model";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {organizationId, workspaceId, principalId} from "../../dataset-version/tests/headless-dataset-metadata.fixture";
import {ReadHeadlessModelMetadataUseCase} from "../headless-model-metadata.use-case";

const hostIncarnationId = "06f5a599-0c24-4444-926a-fc2c5da9f062" as HeadlessHostIncarnationId;
const at = "2026-11-19T00:00:00.000Z";
const inventory = () => ({version, operation: "models.inventory", input: {hostIncarnationId, workspaceId, limit: 1}});
const point = () => ({version, operation: "models.record", input: {hostIncarnationId, workspaceId, modelRecordId: "model.synthetic"}});
const model = (changes: Partial<ModelInventoryRecord> = {}): ModelInventoryRecord => ({workspaceId, modelRecordId: "model.synthetic",
  createdAt: at, source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface",
  modelId: "Qwen/Qwen2.5-0.5B-Instruct", displayName: "Private display label", localPath: "C:/private/synthetic/model",
  taskTags: ["chat"], serializationFormat: "safetensors", metadata: {privateRecord: "not shared"}, ...changes});
function fixture(raw = model()) {
  const calls: unknown[] = [];
  const context = {organizationId, workspaceId, principalId};
  const authority = {hostIncarnationId, context, stillAllowed: async () => true, isCurrent: () => true};
  const dependencies = {organizationId, models: {
    async listModels(input: unknown) {calls.push(input); return {models: [raw], nextCursor: "model.next"};},
    async readRecordedModel(workspace: unknown, id: unknown) {calls.push([workspace, id]); return raw;},
  }};
  return {calls, authority, dependencies, owner: new ReadHeadlessModelMetadataUseCase(dependencies)};
}

test("persisted metadata disables ambient discovery and contains no runtime or supply assertion", async () => {
  const f = fixture(); const result = await f.owner.execute(inventory(), f.authority);
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls, [{workspaceId, limit: 1, includeDiscovered: false, includeSharedStorage: false}]);
  if (!result.ok || result.operation !== "models.inventory") throw new Error("Missing metadata result.");
  assert.equal(result.value.nextCursor, "model.next");
  assert.equal(result.value.runtimeReadiness, "not-checked");
  assert.equal(result.value.supplyVerification, "not-checked");
  assert.doesNotMatch(JSON.stringify(result), /"(?:localPath|metadata|displayName)"|C:\/private|not shared|Private display label/);
  const request = inventory() as ReturnType<typeof inventory> & {input: {cursor: string}};
  request.input.cursor = "model.next";
  await f.owner.execute(request, f.authority);
  assert.deepEqual(f.calls[1], {workspaceId, limit: 1, cursor: "model.next", includeDiscovered: false, includeSharedStorage: false});
});

test("unselected private accessors are not evaluated; selected accessors fail without evaluation", async () => {
  let calls = 0;
  const raw = model();
  Object.defineProperty(raw, "localPath", {enumerable: true, get() {calls++; throw new Error("private");}});
  const f = fixture(raw);
  assert.equal((await f.owner.execute(point(), f.authority)).ok, true); assert.equal(calls, 0);
  Object.defineProperty(raw, "modelId", {enumerable: true, get() {calls++; return "private";}});
  assert.deepEqual(await f.owner.execute(point(), f.authority), {ok: false, code: "headless.not-found"});
  assert.equal(calls, 0);
});

test("malformed or wrong-host requests deny before metadata lookup", async () => {
  const f = fixture();
  for (const request of [{...point(), input: {...point().input, localPath: "private"}},
    {...inventory(), input: {...inventory().input, limit: 33}},
    {...point(), input: {...point().input, modelRecordId: "../foreign"}}]) {
    assert.deepEqual(await f.owner.execute(request, f.authority), {ok: false, code: "headless.invalid-request"});
  }
  assert.deepEqual(await f.owner.execute({...point(), input: {...point().input, hostIncarnationId: "c619253c-f6ed-4609-aa4e-7f95a7aa5f80"}}, f.authority),
    {ok: false, code: "headless.host-changed"});
  assert.equal(f.calls.length, 0);
});

test("current policy surrounds metadata resolution and outward projection", async () => {
  for (const allowedUntil of [0, 1, 2]) {
    const f = fixture(); let checked = 0;
    f.authority.stillAllowed = async () => ++checked <= allowedUntil;
    assert.deepEqual(await f.owner.execute(point(), f.authority), {ok: false, code: "headless.forbidden"});
    assert.equal(f.calls.length, allowedUntil === 0 ? 0 : 1);
  }
});

test("point reads require exact recorded identity and never use a legacy lookup fallback", async () => {
  for (const raw of [undefined, model({modelRecordId: "model.other"}), model({workspaceId: "workspace.foreign" as typeof workspaceId})]) {
    const f = fixture(); f.dependencies.models.readRecordedModel = async () => raw as ModelInventoryRecord;
    assert.deepEqual(await f.owner.execute(point(), f.authority), {ok: false, code: "headless.not-found"});
  }
  const f = fixture();
  const owner = new ReadHeadlessModelMetadataUseCase({organizationId, models: {listModels: f.dependencies.models.listModels}});
  assert.deepEqual(await owner.execute(point(), f.authority), {ok: false, code: "headless.unavailable"});
  assert.equal(f.calls.length, 0);
});

test("caller target changes cannot retarget a held metadata read; actor changes deny it", async () => {
  for (const changedActor of [false, true]) {
    const f = fixture(); let finish!: (value: ModelInventoryRecord) => void;
    f.dependencies.models.readRecordedModel = async () => new Promise(resolve => {finish = resolve;});
    const request = point(); const pending = f.owner.execute(request, f.authority);
    await new Promise<void>(resolve => setImmediate(resolve));
    request.input.modelRecordId = "model.foreign";
    if (changedActor) f.authority.context.principalId = "principal.other" as typeof principalId;
    finish(model());
    const result = await pending;
    assert.equal(result.ok, !changedActor);
    if (result.ok && result.operation === "models.record") assert.equal(result.value.model.modelRecordId, "model.synthetic");
  }
});

test("contaminated or failed adapter results expose no partial inventory", async () => {
  const f = fixture(model({workspaceId: "workspace.foreign" as typeof workspaceId}));
  assert.deepEqual(await f.owner.execute(inventory(), f.authority), {ok: false, code: "headless.unavailable"});
  f.dependencies.models.listModels = async () => {throw new Error("private adapter details");};
  assert.deepEqual(await f.owner.execute(inventory(), f.authority), {ok: false, code: "headless.unavailable"});
});

test("foreign organization or missing principal denies before metadata I/O", async () => {
  for (const changes of [{organizationId: "organization.other"}, {principalId: undefined}]) {
    const f = fixture(); Object.assign(f.authority.context, changes);
    assert.deepEqual(await f.owner.execute(point(), f.authority), {ok: false, code: "headless.forbidden"});
    assert.equal(f.calls.length, 0);
  }
});

test("adapter list accessors and sparse arrays fail without evaluating hidden values", async () => {
  let evaluated = 0;
  const f = fixture();
  const wrapped = Object.defineProperty({}, "models", {enumerable: true, get() {evaluated++; return [model()];}});
  f.dependencies.models.listModels = async () => wrapped as Awaited<ReturnType<typeof f.dependencies.models.listModels>>;
  assert.deepEqual(await f.owner.execute(inventory(), f.authority), {ok: false, code: "headless.unavailable"});
  assert.equal(evaluated, 0);
  f.dependencies.models.listModels = async () => ({models: new Array<ModelInventoryRecord>(1), nextCursor: undefined as unknown as string});
  assert.deepEqual(await f.owner.execute(inventory(), f.authority), {ok: false, code: "headless.unavailable"});
});

test("unknown truthy policy results do not authorize metadata reads", async () => {
  const f = fixture();
  f.authority.stillAllowed = async () => "unknown" as unknown as boolean;
  assert.deepEqual(await f.owner.execute(point(), f.authority), {ok: false, code: "headless.forbidden"});
  assert.equal(f.calls.length, 0);
});

test("replacing the caller's policy callback cannot revive a revoked held read", async () => {
  const f = fixture(); let allowed = true, finish!: (value: ModelInventoryRecord) => void;
  f.authority.stillAllowed = async () => allowed;
  f.dependencies.models.readRecordedModel = async () => new Promise(resolve => {finish = resolve;});
  const pending = f.owner.execute(point(), f.authority);
  await new Promise<void>(resolve => setImmediate(resolve));
  allowed = false; f.authority.stillAllowed = async () => true;
  finish(model());
  assert.deepEqual(await pending, {ok: false, code: "headless.forbidden"});
});

test("nested-microtask actor and lease retirement deny read and return handoffs", async () => {
  for (const stage of [1, 3]) for (const retireActor of [false, true]) {
    const f = fixture(); let checks = 0, live = true;
    f.authority.isCurrent = () => live;
    f.authority.stillAllowed = async () => {
      if (++checks === stage) queueMicrotask(() => queueMicrotask(() => {
        if (retireActor) f.authority.context.principalId = "principal.other" as typeof principalId;
        else live = false;
      }));
      return true;
    };
    assert.deepEqual(await f.owner.execute(point(), f.authority), {ok: false, code: "headless.forbidden"});
    assert.equal(f.calls.length, stage === 1 ? 0 : 1);
  }
});

test("adapter proxies deny before owner reflection for containers, rows, arrays and nested tags", async () => {
  let traps = 0;
  const trapped = <T extends object>(value: T): T => new Proxy(value, {
    // Promise resolution in the trusted producer necessarily reads then.
    // Permit only that interoperability read; all metadata/reflection traps fail.
    get(_target, key) {if (key === "then") return undefined; traps++; throw new Error("private proxy");}, getPrototypeOf() {traps++; throw new Error("private proxy");},
    getOwnPropertyDescriptor() {traps++; throw new Error("private proxy");}, ownKeys() {traps++; throw new Error("private proxy");},
  });
  for (const mode of ["container", "array", "row", "tags", "tag-value", "scalar", "cursor"]) {
    const f = fixture(); const raw = model();
    if (mode === "tags") raw.taskTags = trapped(["chat"] as NonNullable<ModelInventoryRecord["taskTags"]>);
    if (mode === "tag-value") raw.taskTags = [trapped({})] as unknown as ModelInventoryRecord["taskTags"];
    if (mode === "scalar") raw.modelId = trapped({}) as unknown as string;
    const row = mode === "row" ? trapped(raw) : raw;
    const rows = mode === "array" ? trapped([row]) : [row];
    const result = {models: rows, nextCursor: mode === "cursor" ? trapped({}) : "model.next"};
    f.dependencies.models.listModels = async () => (mode === "container" ? trapped(result) : result) as Awaited<ReturnType<typeof f.dependencies.models.listModels>>;
    assert.deepEqual(await f.owner.execute(inventory(), f.authority), {ok: false, code: "headless.unavailable"});
    assert.equal(traps, 0, mode);
  }
});

test("local proxy requests deny before portable codec reflection", async () => {
  let traps = 0;
  const request = new Proxy(point(), {getPrototypeOf() {traps++; throw new Error("private");}, ownKeys() {traps++; throw new Error("private");}});
  const f = fixture();
  assert.deepEqual(await f.owner.execute(request, f.authority), {ok: false, code: "headless.invalid-request"});
  assert.equal(traps, 0); assert.equal(f.calls.length, 0);
});

test("an accidentally async liveness fence denies and drains native rejection", async () => {
  for (const rejected of [false, true]) {
    const f = fixture();
    f.authority.isCurrent = (() => rejected ? Promise.reject(new Error("private fence detail")) : Promise.resolve(true)) as unknown as () => boolean;
    const result = await f.owner.execute(point(), f.authority);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(result, {ok: false, code: "headless.forbidden"});
    assert.equal(f.calls.length, 0); assert.doesNotMatch(JSON.stringify(result), /private fence/);
  }
});

test("a synchronous fence cannot change the actor and still admit metadata", async () => {
  const f = fixture();
  f.authority.isCurrent = () => {f.authority.context.principalId = "principal.other" as typeof principalId; return true;};
  assert.deepEqual(await f.owner.execute(point(), f.authority), {ok: false, code: "headless.forbidden"});
  assert.equal(f.calls.length, 0);
});
