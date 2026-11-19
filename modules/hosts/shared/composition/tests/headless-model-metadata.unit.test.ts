import assert from "node:assert/strict";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, HEADLESS_READ_OPERATIONS,
  type HeadlessHostIncarnationId, type HeadlessReadRequest} from "../../../../contracts/headless";
import {composeDesktopHeadlessReads} from "../../../desktop/composition/composeDesktopHeadlessReads";
import {composeManagedAgentReads} from "../../../server/composition/composeManagedAgentReads";
import {composeHeadlessModelMetadata} from "../headlessModelMetadata";
import {isHeadlessReadCurrent} from "../headlessReadCurrent";

const organizationId = createOrganizationId("model-host-fixture-org");
const workspaceId = createWorkspaceId("model-host-fixture-workspace");
const otherWorkspace = createWorkspaceId("other-model-workspace");
const hostIncarnationId = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
const at = "2026-11-19T00:00:00.000Z";
const denied = {ok: false, code: "headless.forbidden"};
const unavailable = {ok: false, code: "headless.unavailable"};
const query = {version, operation: "models.inventory", input: {hostIncarnationId, workspaceId, limit: 1}} as const;
const empty = {workspaceId, models: [], runtimeReadiness: "not-checked", supplyVerification: "not-checked"} as const;
const recorded = {modelRecordId: "model.synthetic", updatedAt: at, source: "local", lifecycleStatus: "downloaded",
  artifactForm: "full-model", provider: "huggingface", taskTags: ["text-generation"]} as const;

test("Model composition pins the organization and reads only bounded recorded workspace metadata", async () => {
  const root = createInMemoryStructuredDocumentStore(), partition = root.forOrganization(organizationId);
  assert.throws(() => composeHeadlessModelMetadata(root, "synthetic-root"));
  const registry = createLocalModelRegistryAdapter({documents: partition, filePath: "synthetic-root/model-registry/models.json", discovery: {enabled: false}});
  for (const [id, workspace] of [["model.first", workspaceId], ["model.second", workspaceId], ["model.foreign", otherWorkspace]] as const)
    await registry.registerDownloadedModel({workspaceId: workspace, modelRecordId: id, displayName: "Private model label",
      provider: "huggingface", source: "local", artifactForm: "full-model", localPath: "private/model", taskTags: ["text-generation"]});
  const owner = composeHeadlessModelMetadata(partition, "synthetic-root");
  const authority = {hostIncarnationId, context: {organizationId, principalId: "principal.synthetic", workspaceId},
    stillAllowed: async () => true, isCurrent: () => true};
  const first = await owner.execute(query, authority);
  assert.ok(first.ok && first.operation === "models.inventory");
  assert.equal(first.value.models.length, 1);
  assert.ok(first.value.nextCursor);
  const second = await owner.execute({...query, input: {...query.input, cursor: first.value.nextCursor}}, authority);
  assert.ok(second.ok && second.operation === "models.inventory");
  assert.equal(second.value.models.length, 1);
  assert.notEqual(first.value.models[0].modelRecordId, second.value.models[0].modelRecordId);
  assert.equal(second.value.nextCursor, undefined);
  const exact = await owner.execute({version, operation: "models.record", input: {...query.input,
    limit: undefined, modelRecordId: first.value.models[0].modelRecordId}}, authority);
  // Explicit undefined fields are not wire data; exact selectors have no limit.
  assert.deepEqual(exact, {ok: false, code: "headless.invalid-request"});
  const record = await owner.execute({version, operation: "models.record", input: {hostIncarnationId, workspaceId,
    modelRecordId: first.value.models[0].modelRecordId}}, authority);
  assert.ok(record.ok && record.operation === "models.record");
  assert.equal(record.value.runtimeReadiness, "not-checked");
  assert.equal(record.value.supplyVerification, "not-checked");
  assert.doesNotMatch(JSON.stringify([first, second, record]), /private\/model|Private model label|model.foreign/);
  assert.deepEqual(await owner.execute(query, {...authority, context: {...authority.context,
    organizationId: createOrganizationId("foreign-org")}}), denied);
  const foreign = composeHeadlessModelMetadata(root.forOrganization(createOrganizationId("foreign-org")), "synthetic-root");
  const foreignResult = await foreign.execute(query, {...authority, context: {...authority.context, organizationId: createOrganizationId("foreign-org")}});
  assert.ok(foreignResult.ok && foreignResult.operation === "models.inventory");
  assert.deepEqual(foreignResult.value.models, []);
});

test("currentness is an immediate boolean, rejects async or throwing callbacks and observes rejected native Promises", async () => {
  for (const check of [undefined, () => false, () => undefined, () => 1, () => ({then() {assert.fail("Do not invoke a thenable");}}),
    () => Promise.resolve(true), () => Promise.reject(new Error("synthetic rejection")), () => {throw new Error("synthetic throw");}])
    assert.equal(isHeadlessReadCurrent(check), false);
  assert.equal(isHeadlessReadCurrent(() => true), true);
  await new Promise<void>(resolve => setImmediate(resolve));
});

function fixture(host: "desktop" | "managed", metadata?: ReturnType<typeof composeHeadlessModelMetadata>) {
  const state = {live: true, planning: true, allowed: true, opens: 0, reads: 0,
    fence: (() => true) as () => unknown, onOpen: () => {}, onRead: () => {}, onPolicy: () => {},
    value: empty as unknown, replyOperation: "models.inventory", requestAfterRead: undefined as HeadlessReadRequest | undefined};
  const identity = {organizationId, principalId: "principal.synthetic", purpose: "plan-review" as "plan-review" | "agent",
    registeredClientId: "synthetic-client"};
  const workspaces = {async readWorkspace(id: unknown) {return id === workspaceId ? {workspaceId, organizationId,
    displayName: "Synthetic", status: "active" as const, createdAt: at, updatedAt: at} : undefined;}};
  const authorization = {async authorizeWorkspaceOperation({requiredScopes}: {requiredScopes: readonly string[]}) {
    assert.deepEqual(requiredScopes, ["workspace:read", "model:read"]);
    state.onPolicy();
    if (!state.allowed) throw new Error("Synthetic policy denial");
  }};
  const getModelMetadata = async () => {state.opens++; state.onOpen(); return {async execute(request: HeadlessReadRequest,
    authority: Parameters<ReturnType<typeof composeHeadlessModelMetadata>["execute"]>[1]) {
    if (!authority.isCurrent() || !await authority.stillAllowed()) return denied;
    state.reads++;
    state.requestAfterRead = request;
    state.onRead();
    if (metadata) return metadata.execute(request, authority);
    return {ok: true, operation: state.replyOperation, value: state.value};
  }};};
  const noSystem = () => {assert.fail("Model metadata must not warm system, runtime, provider or task features.");};
  const read = host === "desktop" ? (() => {
    const handler = composeDesktopHeadlessReads({hostIncarnationId, identity, workspaceRepository: workspaces, authorization,
      getUseCases: noSystem, getModelMetadata: getModelMetadata as never, isOpen: () => state.live});
    return (request: HeadlessReadRequest = query) => handler(request, async () => ({...identity, workspaceIds: [workspaceId],
      operations: HEADLESS_READ_OPERATIONS, ...(state.planning ? {planReview: true as const} : {}),
      isCurrent: state.fence as () => boolean}));
  })() : (() => {
    const handler = composeManagedAgentReads({hostIncarnationId, contexts: {getCurrentOrganizationContext: () => identity},
      workspaces, authorization, systems: {listTemplates: {execute: noSystem}, read: {execute: noSystem}}, getModelMetadata: getModelMetadata as never});
    return (request: HeadlessReadRequest = query) => {
      identity.purpose = state.planning ? "plan-review" : "agent";
      return handler(request, identity, () => state.live && state.fence() as boolean);
    };
  })();
  return {state, identity, read};
}

for (const host of ["desktop", "managed"] as const) {
  test(`${host} Model metadata composes the real organization registry for full traversal and exact reads`, async () => {
    const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
    const registry = createLocalModelRegistryAdapter({documents, filePath: "synthetic-root/model-registry/models.json", discovery: {enabled: false}});
    for (const modelRecordId of ["model.first", "model.second"])
      await registry.registerDownloadedModel({workspaceId, modelRecordId, displayName: "Private model label",
        provider: "huggingface", source: "local", artifactForm: "full-model", localPath: "private/model", taskTags: ["text-generation"]});
    const {read} = fixture(host, composeHeadlessModelMetadata(documents, "synthetic-root"));
    const first = await read();
    assert.ok(first.ok && first.operation === "models.inventory");
    assert.equal(first.value.models.length, 1); assert.ok(first.value.nextCursor);
    const second = await read({...query, input: {...query.input, cursor: first.value.nextCursor}});
    assert.ok(second.ok && second.operation === "models.inventory");
    assert.equal(second.value.models.length, 1); assert.equal(second.value.nextCursor, undefined);
    assert.notEqual(first.value.models[0].modelRecordId, second.value.models[0].modelRecordId);
    const exact = await read({version, operation: "models.record", input: {hostIncarnationId, workspaceId,
      modelRecordId: first.value.models[0].modelRecordId}});
    assert.ok(exact.ok && exact.operation === "models.record");
    assert.deepEqual(exact.value.model, first.value.models[0]);
    assert.equal(exact.value.runtimeReadiness, "not-checked"); assert.equal(exact.value.supplyVerification, "not-checked");
    assert.doesNotMatch(JSON.stringify([first, second, exact]), /private\/model|Private model label/);
  });

  test(`${host} Model reads require purpose and permission before lazy ownership`, async () => {
    const {state, read} = fixture(host);
    state.planning = false; assert.deepEqual(await read(), denied); assert.equal(state.opens, 0);
    state.planning = true; state.allowed = false; assert.deepEqual(await read(), denied); assert.equal(state.opens, 0);
    state.allowed = true;
    for (const fence of [() => false, () => undefined, () => Promise.resolve(true), () => Promise.reject(new Error("synthetic")),
      () => {throw new Error("synthetic");}]) {
      state.fence = fence; assert.deepEqual(await read(), denied); assert.equal(state.opens, 0);
    }
    state.fence = () => true;
    assert.deepEqual(await read(), {ok: true, operation: "models.inventory", value: empty});
    assert.equal(state.opens, 1); assert.equal(state.reads, 1);
    assert.deepEqual(await read({...query, input: {...query.input, workspaceId: otherWorkspace}}), denied);
    assert.equal(state.opens, 1);
  });

  test(`${host} Model reads deny revocation and identity changes at lazy, storage and final policy boundaries`, async () => {
    for (const boundary of ["onOpen", "onRead", "onPolicy"] as const) {
      for (const revoke of ["live", "permission", "identity"] as const) {
        const {state, identity, read} = fixture(host);
        let calls = 0;
        state[boundary] = () => {
          if (boundary === "onPolicy" && ++calls < 2) return;
          if (revoke === "live") state.live = false;
          else if (revoke === "permission") state.allowed = false;
          else identity.principalId = "principal.changed";
        };
        assert.deepEqual(await read(), denied, `${boundary}/${revoke}`);
      }
    }
  });

  test(`${host} Model read egress rejects private, mismatched, repeated and falsely verified replies`, async () => {
    const {state, read} = fixture(host);
    for (const value of [{...empty, privatePath: "private/model"}, {...empty, workspaceId: otherWorkspace},
      {...empty, runtimeReadiness: "ready"}, {...empty, supplyVerification: "verified"},
      {...empty, models: [recorded, recorded]}, {...empty, models: [{...recorded, privatePath: "private/model"}]},
      {...empty, nextCursor: "model.synthetic"}]) {
      state.value = value; assert.deepEqual(await read(), unavailable);
    }
    state.value = {...empty, models: [recorded]};
    assert.equal((await read()).ok, true);
    state.replyOperation = "models.record";
    state.value = {workspaceId, model: recorded, runtimeReadiness: "not-checked", supplyVerification: "not-checked"};
    assert.deepEqual(await read(), unavailable);
    const request = {version, operation: "models.record", input: {hostIncarnationId, workspaceId, modelRecordId: "model.synthetic"}} as const;
    assert.equal((await read(request)).ok, true);
    assert.deepEqual(await read({...request, input: {...request.input, modelRecordId: "model.other"}}), unavailable);
    state.onRead = () => {Object.assign(state.requestAfterRead!.input, {modelRecordId: "model.other"});};
    assert.deepEqual(await read(request), unavailable);
  });

  test(`${host} Model request targets are detached before awaited permission checks`, async () => {
    const {state, read} = fixture(host);
    const request = {...query, input: {...query.input}};
    state.onPolicy = () => {request.input.workspaceId = otherWorkspace;};
    assert.deepEqual(await read(request), {ok: true, operation: "models.inventory", value: empty});
    assert.ok(state.requestAfterRead && "workspaceId" in state.requestAfterRead.input);
    assert.equal(state.requestAfterRead.input.workspaceId, workspaceId);
    assert.notStrictEqual(state.requestAfterRead, request);
  });
}
