import assert from "node:assert/strict";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, HEADLESS_READ_OPERATIONS, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {composeDesktopHeadlessReads} from "../../../desktop/composition/composeDesktopHeadlessReads";
import {composeManagedAgentReads} from "../../../server/composition/composeManagedAgentReads";
import {composeHeadlessContextPreview} from "../headlessContextPreview";

const organizationId = createOrganizationId("context-fixture-org"), workspaceId = createWorkspaceId("context-fixture-workspace");
const identity = {organizationId, principalId: "principal.synthetic"};
const hostIncarnationId = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
const at = "2026-11-17T00:00:00.000Z";
const query = {version, operation: "context.models", input: {hostIncarnationId, workspaceId}} as const;
const denied = {ok: false, code: "headless.forbidden"};

test("shared Context preview composition is organization-partitioned and reads persisted metadata without a runtime", async () => {
  const root = createInMemoryStructuredDocumentStore(), partition = root.forOrganization(organizationId);
  assert.throws(() => composeHeadlessContextPreview(root, "synthetic-root"));
  const registry = createLocalModelRegistryAdapter({documents: partition, filePath: "synthetic-root/model-registry/models.json", discovery: {enabled: false}});
  await registry.registerDownloadedModel({workspaceId, modelRecordId: "model.synthetic", displayName: "Private model",
    provider: "huggingface", source: "local", artifactForm: "full-model", localPath: "private/model", taskTags: ["embeddings"]});
  const result = await composeHeadlessContextPreview(partition, "synthetic-root").execute(query,
    {hostIncarnationId, context: {...identity, workspaceId}, stillAllowed: async () => true});
  assert.ok(result.ok && "value" in result);
  assert.equal(result.value.models[0].modelRecordId, "model.synthetic");
  assert.equal(result.value.runtimeReadiness, "not-checked");
  assert.equal(JSON.stringify(result).includes("private/model"), false);
  assert.equal(JSON.stringify(result).includes("Private model"), false);
});

for (const host of ["desktop", "managed"] as const) test(`${host} Context reads require planning purpose and current model permission through publication`, async () => {
  let live = true, planning = true, allowed = true, opens = 0, altered = false;
  let afterRead: (() => void) | undefined;
  const workspaces = {async readWorkspace(id: unknown) {return id === workspaceId ? {workspaceId, organizationId,
    displayName: "Synthetic", status: "active" as const, createdAt: at, updatedAt: at} : undefined;}};
  const authorization = {async authorizeWorkspaceOperation({requiredScopes}: {requiredScopes: readonly string[]}) {
    assert.deepEqual(requiredScopes, ["workspace:read", "model:read"]);
    if (!allowed) throw new Error("Synthetic current model permission denied");
  }};
  const value = {workspaceId, models: [], truncated: false, runtimeReadiness: "not-checked" as const};
  const getContextInputs = async () => {opens++; return {async execute(_request: unknown, authority: {stillAllowed: () => Promise<boolean>}) {
    if (!await authority.stillAllowed()) return denied;
    afterRead?.();
    return {ok: true, operation: "context.models", value: {...value, ...(altered ? {privatePath: "private/model"} : {})}} as const;
  }};};
  const noSystem = () => {assert.fail("Context metadata must not warm system, Context runtime or task features.");};
  const read = host === "desktop"
    ? (() => {const handler = composeDesktopHeadlessReads({hostIncarnationId, identity, workspaceRepository: workspaces, authorization,
      getUseCases: noSystem, getContextInputs: getContextInputs as never, isOpen: () => live});
      return () => handler(query, async () => ({...identity, registeredClientId: "synthetic-client", workspaceIds: [workspaceId],
        operations: HEADLESS_READ_OPERATIONS, ...(planning ? {planReview: true as const} : {}), isCurrent: () => live}));})()
    : (() => {const handler = composeManagedAgentReads({hostIncarnationId, contexts: {getCurrentOrganizationContext: () => identity},
      workspaces, authorization, systems: {listTemplates: {execute: noSystem}, read: {execute: noSystem}}, getContextInputs: getContextInputs as never});
      return () => handler(query, {...identity, ...(planning ? {purpose: "plan-review" as const} : {})}, () => live);})();
  planning = false; assert.deepEqual(await read(), denied); assert.equal(opens, 0);
  planning = true; allowed = false; assert.deepEqual(await read(), denied); assert.equal(opens, 0);
  allowed = true; assert.deepEqual(await read(), {ok: true, operation: "context.models", value});
  altered = true; assert.deepEqual(await read(), {ok: false, code: "headless.unavailable"});
  altered = false; afterRead = () => {allowed = false;}; assert.deepEqual(await read(), denied);
  allowed = true; afterRead = () => {live = false;}; assert.deepEqual(await read(), denied);
});
