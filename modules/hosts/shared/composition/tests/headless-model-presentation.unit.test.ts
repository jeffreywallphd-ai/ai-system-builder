import assert from "node:assert/strict";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import type {HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {composeHeadlessModelPresentation} from "../headlessModelPresentation";

const organizationId = createOrganizationId("model-reveal-org"), workspaceId = createWorkspaceId("model-reveal-workspace");
const at = "2026-11-28T00:00:00.000Z", hostIncarnationId = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
const intent = {action: "show-model", modelRecordId: "model.saved", modelUpdatedAt: at} as const;
async function fixture() {
  const documents = createInMemoryStructuredDocumentStore();
  const registry = createLocalModelRegistryAdapter({documents: documents.forOrganization(organizationId),
    filePath: "inert-model-registry/models.json", discovery: {enabled: false}, now: () => at});
  await registry.registerDownloadedModel({workspaceId, modelRecordId: intent.modelRecordId, displayName: "Private label",
    provider: "huggingface", source: "local", artifactForm: "full-model", localPath: "private/model", taskTags: ["text-generation"]});
  const context = {organizationId, principalId: "model-reveal-principal", workspaceId};
  return {documents, context, read: composeHeadlessModelPresentation({documents, rootDirectory: "inert-model-registry", hostIncarnationId})};
}

test("original recorded Model display exposes only finite truthful summary for the exact saved version", async () => {
  const f = await fixture(), result = await f.read(intent, f.context, async () => true);
  assert.deepEqual(result, {title: "Saved model", summary: "Status: downloaded. Type: full-model. Runtime and supply checks: not checked."});
  assert.doesNotMatch(JSON.stringify(result), /private|Private|ready|passed/);
  assert.equal(await f.read({...intent, modelUpdatedAt: "2026-11-27T00:00:00.000Z"}, f.context, async () => true), undefined);
  assert.equal(await f.read({...intent, modelRecordId: "model.missing"}, f.context, async () => true), undefined);
  assert.equal(await f.read(intent, {...f.context, organizationId: createOrganizationId("other-org")}, async () => true), undefined);
  assert.equal(await f.read(intent, {...f.context, workspaceId: createWorkspaceId("other-workspace")}, async () => true), undefined);
  assert.equal(await f.read({...intent, localPath: "private/model"}, f.context, async () => true), undefined);
});

test("read and final disclosure preserve current permission, target and original actor across waits", async () => {
  const f = await fixture(); let calls = 0;
  assert.equal(await f.read(intent, f.context, async () => ++calls < 3), undefined);
  assert.equal(await f.read(intent, f.context, async () => {throw new Error("Private policy diagnostic.");}), undefined);
  const raw = {...intent}, context = {...f.context};
  const result = await f.read(raw, context, async () => {raw.modelRecordId = "model.other" as typeof raw.modelRecordId; return true;});
  assert.ok(result, "The detached exact target survives caller mutation.");
  assert.equal(await f.read(intent, context, async () => {context.principalId = "other-principal"; return true;}), undefined);
});

test("unpartitioned ownership and configured host are mandatory; denial does not open metadata", async () => {
  const f = await fixture(); let partitions = 0;
  const documents = {...f.documents, forOrganization: f.documents.forOrganization.bind(f.documents)};
  const original = documents.forOrganization;
  documents.forOrganization = id => {partitions++; return original(id);};
  const read = composeHeadlessModelPresentation({documents, rootDirectory: "inert-model-registry", hostIncarnationId});
  assert.equal(await read(intent, f.context, async () => false), undefined); assert.equal(partitions, 0);
  assert.equal(await composeHeadlessModelPresentation({documents: f.documents.forOrganization(organizationId), rootDirectory: "inert", hostIncarnationId})(intent, f.context, async () => true), undefined);
  assert.equal(await composeHeadlessModelPresentation({documents: f.documents, rootDirectory: "inert", hostIncarnationId: "invalid" as HeadlessHostIncarnationId})(intent, f.context, async () => true), undefined);
});
