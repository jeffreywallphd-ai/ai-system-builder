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


function trainingReadFixture(host: "desktop" | "managed", configured = true, completion = false) {
  const taskId = "f8cd6a41-ad96-47f3-bebf-7ef995a251f0";
  const clientId = "e576326e-6802-4f44-b9bd-7e80467e4b8c";
  const request = {version: version as typeof version, operation: completion ? "models.review-training" as const : "models.training-task" as const,
    input: {hostIncarnationId, workspaceId, selection: {kind: "task" as const, taskId}}};
  const progress = () => ({workspaceId, taskId, plan: {fingerprint: "a".repeat(64), step: 1}, state: "running",
    percent: 50, progress: {epoch: 1, totalEpochs: 2, batch: 2, totalBatches: 4}, resultReview: "not-ready",
    registration: "requires-separate-approval", runtimeReadiness: "not-checked", outputQuality: "not-evaluated"});
  const state = {live: true, readLive: true, planning: true, allowed: true, reads: 0, policies: 0,
    afterRead: false, onPolicy: () => {}, onRead: (_query: {isCurrent: () => boolean}) => {},
    reply: {ok: true, operation: request.operation, value: completion ? cachedTrainingHistory(progress()) : progress()} as unknown};
  const identity = {organizationId, principalId: "principal.synthetic", registeredClientId: clientId,
    purpose: "plan-review" as "plan-review" | "agent"};
  const workspaces = {async readWorkspace(id: unknown) {return id === workspaceId ? {workspaceId, organizationId,
    displayName: "Synthetic", status: "active" as const, createdAt: at, updatedAt: at} : undefined;}};
  const authorization = {async authorizeWorkspaceOperation({requiredScopes}: {requiredScopes: readonly string[]}) {
    assert.deepEqual(requiredScopes, ["workspace:read", "model:read"]); state.policies++; state.onPolicy();
    if (!state.allowed) throw new Error("PRIVATE policy denial");
  }};
  let dependencies: object;
  const readTrainingTask = async function(this: unknown, query: {scope: {registeredClientId: string}; isCurrent: () => boolean}) {
    assert.strictEqual(this, dependencies); assert.equal(query.scope.registeredClientId, clientId);
    state.reads++; state.onRead(query); state.afterRead = true; return state.reply;
  };
  const unexpected = () => {assert.fail("Training observation must not resolve another feature or task owner.");};
  const read = host === "desktop" ? (() => {
    const options = {hostIncarnationId, identity, workspaceRepository: workspaces, authorization,
      getUseCases: unexpected, isOpen: () => state.live, ...(configured ? completion ? {readTrainingReview: readTrainingTask} : {readTrainingTask} : {})};
    dependencies = options;
    const handler = composeDesktopHeadlessReads(options);
    return (input: HeadlessReadRequest = request) => handler(input, async () => ({...identity,
      workspaceIds: [workspaceId], operations: HEADLESS_READ_OPERATIONS, ...(state.planning ? {planReview: true as const} : {}),
      isCurrent: () => state.live, isReadCurrent: () => state.readLive}));
  })() : (() => {
    const options = {hostIncarnationId, contexts: {getCurrentOrganizationContext: () => identity}, workspaces, authorization,
      systems: {listTemplates: {execute: unexpected}, read: {execute: unexpected}}, ...(configured ? completion ? {readTrainingReview: readTrainingTask} : {readTrainingTask} : {})};
    dependencies = options;
    const handler = composeManagedAgentReads(options);
    return (input: HeadlessReadRequest = request) => {
      identity.purpose = state.planning ? "plan-review" : "agent";
      return handler(input, identity, () => state.live && state.readLive);
    };
  })();
  return {state, identity, request, progress, read, dependencies: dependencies!};
}
for (const host of ["desktop", "managed"] as const) {
  test(`${host} training progress broker advertises only configured original readers and preserves numeric progress`, async () => {
    const f = trainingReadFixture(host);
    const description = await f.read({version, operation: "host.describe", input: {}});
    assert.ok(description.ok && description.operation === "host.describe");
    assert.ok(description.value.operations.includes("models.training-task"));
    assert.deepEqual(await f.read(), {ok: true, operation: "models.training-task", value: f.progress()});
    const advanced = {...f.progress(), percent: 75, progress: {epoch: 1, totalEpochs: 2, batch: 3, totalBatches: 4}};
    f.state.reply = {ok: true, operation: "models.training-task", value: advanced};
    assert.deepEqual(await f.read({...f.request, input: {...f.request.input,
      selection: {kind: "plan-step", fingerprint: "a".repeat(64), step: 1}}}),
      {ok: true, operation: "models.training-task", value: advanced});
    assert.equal(f.state.reads, 2);
    const missing = trainingReadFixture(host, false);
    const absent = await missing.read({version, operation: "host.describe", input: {}});
    assert.ok(absent.ok && absent.operation === "host.describe");
    assert.equal(absent.value.operations.includes("models.training-task"), false);
    assert.deepEqual(await missing.read(), {ok: false, code: "headless.unsupported-operation"});
    assert.equal(missing.state.reads, 0);
  });
  test(`${host} training progress broker requires current planning, read permission and original live identity`, async () => {
    for (const withdraw of [(f: ReturnType<typeof trainingReadFixture>) => {f.state.planning = false;},
      (f: ReturnType<typeof trainingReadFixture>) => {f.state.allowed = false;},
      (f: ReturnType<typeof trainingReadFixture>) => {f.state.readLive = false;}]) {
      const f = trainingReadFixture(host); withdraw(f); assert.deepEqual(await f.read(), denied); assert.equal(f.state.reads, 0);
    }
    const f = trainingReadFixture(host); f.state.onRead = () => {f.state.allowed = false;};
    assert.deepEqual(await f.read(), denied); assert.equal(f.state.reads, 1);
    const g = trainingReadFixture(host); g.state.onRead = () => {g.identity.registeredClientId = hostIncarnationId;};
    assert.deepEqual(await g.read(), denied);
  });
  test(`${host} training progress broker preserves sticky read loss and original callback receiver`, async () => {
    const f = trainingReadFixture(host); f.state.onRead = query => {
      f.state.readLive = false; assert.equal(query.isCurrent(), false); f.state.readLive = true; assert.equal(query.isCurrent(), false);
    };
    assert.deepEqual(await f.read(), denied);
    const g = trainingReadFixture(host); g.state.onPolicy = () => {
      Object.assign(g.dependencies, {readTrainingTask: () => assert.fail("No callback replacement.")});
    };
    assert.deepEqual(await g.read(), {ok: true, operation: "models.training-task", value: g.progress()});
  });
  test(`${host} training progress broker detaches requests and replies before later policy waits`, async () => {
    const f = trainingReadFixture(host); f.state.onPolicy = () => {f.request.input.selection.taskId = hostIncarnationId;};
    assert.deepEqual(await f.read(), {ok: true, operation: "models.training-task", value: f.progress()});
    const g = trainingReadFixture(host); const expected = g.progress();
    g.state.onPolicy = () => {if (g.state.afterRead) Object.assign((g.state.reply as {value: unknown}).value!,
      {percent: 75, progress: {epoch: 1, totalEpochs: 2, batch: 3, totalBatches: 4}});};
    assert.deepEqual(await g.read(), {ok: true, operation: "models.training-task", value: expected});
  });
  test(`${host} training progress broker refuses private, foreign, malformed and active original replies`, async () => {
    for (const reply of [{ok: true, operation: "models.task", value: trainingReadFixture(host).progress()},
      {ok: true, operation: "models.training-task", value: {...trainingReadFixture(host).progress(), taskId: hostIncarnationId}},
      {ok: true, operation: "models.training-task", value: {...trainingReadFixture(host).progress(), localPath: "PRIVATE"}},
      {ok: false, code: "PRIVATE"}]) {
      const f = trainingReadFixture(host); f.state.reply = reply; assert.deepEqual(await f.read(), unavailable);
    }
    let traps = 0; const f = trainingReadFixture(host);
    f.state.reply = new Proxy({}, {getPrototypeOf() {traps++; throw Error("PRIVATE");}});
    assert.deepEqual(await f.read(), unavailable); assert.equal(traps, 0);
  });
}


function trainingFreshGrantFixture(field: "isCurrent" | "isReadCurrent", atPolicy: number,
  change: "revoke" | "replace" | "scope" | "receiver" | "recursive" = "revoke") {
  const f = trainingReadFixture("desktop");
  const views: {grant: object; live: {isCurrent: boolean; isReadCurrent: boolean}}[] = [];
  const state = {reads: 0, policies: 0, checks: 0};
  let currentRead: (() => boolean) | undefined;
  const reader = composeDesktopHeadlessReads({hostIncarnationId, identity: f.identity, isOpen: () => true,
    getUseCases() {assert.fail("No fallback from original training observation.");},
    workspaceRepository: {async readWorkspace() {return {workspaceId, organizationId, displayName: "Synthetic",
      status: "active", createdAt: at, updatedAt: at};}},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      assert.deepEqual(requiredScopes, ["workspace:read", "model:read"]);
      if (++state.policies === atPolicy) {
        const last = views[views.length - 1]; assert.notStrictEqual(last, views[0]);
        if (change === "replace") Object.assign(last.grant, {[field]: () => true});
        else if (change === "scope") Object.assign(last.grant, {operations: []});
        else last.live[field] = false;
        await Promise.resolve();
      }
    }},
    async readTrainingTask(query) {state.reads++; assert.equal(query.isCurrent(), true);
      if (change === "recursive") currentRead = query.isCurrent;
      return {ok: true, operation: "models.training-task", value: f.progress()};},
  });
  const grant = async () => {
    const live = {isCurrent: true, isReadCurrent: true};
    const view = {...f.identity, workspaceIds: [workspaceId], operations: HEADLESS_READ_OPERATIONS,
      planReview: true as const, live,
      isCurrent: () => {state.checks++; return change === "recursive" && currentRead ? currentRead() : live.isCurrent;},
      isReadCurrent: () => live.isReadCurrent};
    if (change === "receiver") {
      view.isCurrent = function(this: typeof view) {return this.live.isCurrent;};
      view.isReadCurrent = function(this: typeof view) {return this.live.isReadCurrent;};
    }
    views.push({grant: view, live}); return view;
  };
  return {run: () => reader(f.request, grant), state, views};
}
for (const field of ["isCurrent", "isReadCurrent"] as const) for (const policy of [2, 3]) {
  test(`desktop training progress retains fresh ${field} across policy wait ${policy}`, async () => {
    const f = trainingFreshGrantFixture(field, policy);
    assert.deepEqual(await f.run(), denied);
    assert.equal(f.state.reads, policy === 2 ? 0 : 1);
    assert.deepEqual(f.views[0].live, {isCurrent: true, isReadCurrent: true});
  });
}
test("desktop training progress retains fresh callback references and scopes", async () => {
  for (const change of ["replace", "scope"] as const) for (const field of ["isCurrent", "isReadCurrent"] as const) {
    const f = trainingFreshGrantFixture(field, 2, change);
    assert.deepEqual(await f.run(), denied); assert.equal(f.state.reads, 0);
  }
});
test("desktop training progress accepts unchanged fresh grants and original callback receivers", async () => {
  for (const change of ["revoke", "receiver"] as const) {
    const f = trainingFreshGrantFixture("isCurrent", -1, change);
    assert.equal((await f.run()).ok, true); assert.equal(f.state.reads, 1);
  }
});
test("desktop training progress refuses recursive original authority without unbounded callbacks", async () => {
  const f = trainingFreshGrantFixture("isCurrent", -1, "recursive");
  assert.deepEqual(await f.run(), denied); assert.equal(f.state.reads, 1); assert.ok(f.state.checks < 100);
});

function cachedTrainingHistory(summary: {workspaceId: typeof workspaceId; taskId: string; plan: {fingerprint: string; step: number}}) {
  return {workspaceId: summary.workspaceId, taskId: summary.taskId, plan: {...summary.plan}, provenance: {modelRecordId: "model.synthetic", modelUpdatedAt: at,
    datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64),
    recipeDigest: "sha256:" + "b".repeat(64), proposalDigest: "sha256:" + "c".repeat(64), trainingTask: "llm-instruction", method: "lora",
    trainingInputCount: 1, validationInputCount: 1, inputBytes: 128, recipeBytes: 64},
    candidate: {requestedName: "Small trial", artifactForm: "adapter", serializationFormat: "adapter-safetensors", recordedSizeBytes: 256},
    comparison: {state: "not-recorded"}, verification: {inputs: "recorded-not-rechecked", retainedFiles: "not-checked",
      runtimeReadiness: "not-checked", hardware: "not-recorded", outputQuality: "not-evaluated"}, registration: "requires-separate-approval"} as const;
}
for (const host of ["desktop", "managed"] as const) {
  test(`${host} cached training review advertises configured-only support and returns historical facts`, async () => {
    const f = trainingReadFixture(host, true, true), description = await f.read({version, operation: "host.describe", input: {}});
    assert.ok(description.ok && description.operation === "host.describe");
    assert.ok(description.value.operations.includes("models.review-training"));
    assert.equal(description.value.operations.includes("models.training-task"), false, "No progress fallback or automatic activation.");
    const expected = {ok: true, operation: "models.review-training", value: cachedTrainingHistory(f.progress())};
    assert.deepEqual(await f.read(), expected); assert.equal(f.state.reads, 1);
    const absent = trainingReadFixture(host, false, true), missing = await absent.read({version, operation: "host.describe", input: {}});
    assert.ok(missing.ok && missing.operation === "host.describe"); assert.equal(missing.value.operations.includes("models.review-training"), false);
    assert.equal((await absent.read()).ok, false); assert.equal(absent.state.reads, 0);
    f.state.reply = {ok: false, code: "headless.source-not-ready"}; assert.deepEqual(await f.read(), f.state.reply);
  });
  test(`${host} cached training review denies foreign/private/stale data and retains copied selection and reply`, async () => {
    for (const change of [{taskId: hostIncarnationId}, {workspaceId: createWorkspaceId("workspace.other")}, {logs: ["PRIVATE"]},
      {registration: "saved"}, {verification: {inputs: "verified"}}]) {
      const f = trainingReadFixture(host, true, true); f.state.reply = {ok: true, operation: "models.review-training", value: {...cachedTrainingHistory(f.progress()), ...change}};
      assert.deepEqual(await f.read(), {ok: false, code: "headless.unavailable"});
    }
    for (const flag of ["live", "readLive", "planning", "allowed"] as const) {
      const f = trainingReadFixture(host, true, true); f.state[flag] = false; assert.equal((await f.read()).ok, false); assert.equal(f.state.reads, 0);
    }
    const f = trainingReadFixture(host, true, true), original = cachedTrainingHistory(f.progress());
    f.state.onPolicy = () => {if (f.state.afterRead) {
      (f.state.reply as any).value.candidate.requestedName = "Changed later";
      f.request.input.selection.taskId = hostIncarnationId;
    }};
    assert.deepEqual(await f.read(), {ok: true, operation: "models.review-training", value: original});
    const g = trainingReadFixture(host, true, true); g.state.onRead = () => {g.state.readLive = false;};
    assert.deepEqual(await g.read(), denied);
  });
}

function completionFreshGrantFixture(field: "isCurrent" | "isReadCurrent", atPolicy: number,
  change: "revoke" | "replace" | "scope" | "receiver" | "recursive" = "revoke") {
  const f = trainingReadFixture("desktop", true, true);
  const views: {grant: object; live: {isCurrent: boolean; isReadCurrent: boolean}}[] = [];
  const state = {reads: 0, policies: 0, checks: 0};
  let currentRead: (() => boolean) | undefined;
  const reader = composeDesktopHeadlessReads({hostIncarnationId, identity: f.identity, isOpen: () => true,
    getUseCases() {assert.fail("No fallback from original training observation.");},
    workspaceRepository: {async readWorkspace() {return {workspaceId, organizationId, displayName: "Synthetic",
      status: "active", createdAt: at, updatedAt: at};}},
    authorization: {async authorizeWorkspaceOperation({requiredScopes}) {
      assert.deepEqual(requiredScopes, ["workspace:read", "model:read"]);
      if (++state.policies === atPolicy) {
        const last = views[views.length - 1]; assert.notStrictEqual(last, views[0]);
        if (change === "replace") Object.assign(last.grant, {[field]: () => true});
        else if (change === "scope") Object.assign(last.grant, {operations: []});
        else last.live[field] = false;
        await Promise.resolve();
      }
    }},
    async readTrainingReview(query) {state.reads++; assert.equal(query.isCurrent(), true);
      if (change === "recursive") currentRead = query.isCurrent;
      return {ok: true, operation: "models.review-training", value: cachedTrainingHistory(f.progress())};},
  });
  const grant = async () => {
    const live = {isCurrent: true, isReadCurrent: true};
    const view = {...f.identity, workspaceIds: [workspaceId], operations: HEADLESS_READ_OPERATIONS,
      planReview: true as const, live,
      isCurrent: () => {state.checks++; return change === "recursive" && currentRead ? currentRead() : live.isCurrent;},
      isReadCurrent: () => live.isReadCurrent};
    if (change === "receiver") {
      view.isCurrent = function(this: typeof view) {return this.live.isCurrent;};
      view.isReadCurrent = function(this: typeof view) {return this.live.isReadCurrent;};
    }
    views.push({grant: view, live}); return view;
  };
  return {run: () => reader(f.request, grant), state, views};
}
for (const field of ["isCurrent", "isReadCurrent"] as const) for (const policy of [2, 3]) {
  test(`desktop cached completion retains fresh ${field} across policy wait ${policy}`, async () => {
    const f = completionFreshGrantFixture(field, policy); assert.deepEqual(await f.run(), denied);
    assert.equal(f.state.reads, policy === 2 ? 0 : 1);
  });
}
test("desktop cached completion retains fresh callback identities and scope", async () => {
  for (const change of ["replace", "scope"] as const) for (const field of ["isCurrent", "isReadCurrent"] as const) {
    const f = completionFreshGrantFixture(field, 2, change); assert.deepEqual(await f.run(), denied); assert.equal(f.state.reads, 0);
  }
});
