import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceAssetAuthoringReaders } from "../workspace-asset-authoring-readers";

const workspaceId = "workspace.legacy-test" as never;
const cases = [
  ["authoredAssetRepository", "listAuthoredAssetRecords", [{workspaceId}]],
  ["authoredAssetRepository", "readAuthoredAssetRecordByWorkspace", [workspaceId, "authored.test"]],
  ["assetDraftRepository", "listAssetDraftRecords", [{workspaceId}]],
  ["assetDraftRepository", "readAssetDraftRecord", [workspaceId, "draft.test"]],
  ["assetRevisionRepository", "listAssetRevisionRecords", [{workspaceId, authoredAssetId: "authored.test"}]],
  ["assetRevisionRepository", "readAssetRevisionRecord", [workspaceId, "authored.test", "revision.test"]],
  ["assetOverrideRepository", "listAssetOverrideRecords", [{targetWorkspaceId: workspaceId}]],
  ["assetOverrideRepository", "readAssetOverrideRecord", [workspaceId, "override.test"]],
] as const;
const operations = ["list-authored-assets", "read-authored-asset", "list-drafts", "read-draft", "list-revisions", "read-revision", "list-overrides", "read-override"];
for (const [index, [repositoryName, method, args]] of cases.entries()) test(`legacy read facade: ${method} requires exact read authority and keeps supported args/result`, async () => {
  let effects = 0, allowed = false;
  const expectedResult = {synthetic: true};
  const repository = {[method]: async (...actual: any[]) => {effects++; assert.deepEqual(actual, args); return expectedResult;}};
  const readers: any = createWorkspaceAssetAuthoringReaders({workspaceAccess: {async authorize(ws: unknown, op: string, scope: string) {assert.equal(ws, workspaceId); assert.equal(scope, "asset:read"); assert.equal(op, `asset-authoring.${operations[index]}`); if (!allowed) throw new Error("private policy detail");}}, authoredAssetRepository: repository, assetDraftRepository: repository, assetRevisionRepository: repository, assetOverrideRepository: repository} as any);
  await assert.rejects(readers[repositoryName][method](...args), error => !String(error).includes("private policy detail"));
  assert.equal(effects, 0); allowed = true;
  assert.equal(await readers[repositoryName][method](...args), expectedResult); assert.equal(effects, 1);
});
test("legacy read facade captures query before awaiting authorization and exposes no mutation/unscoped by-ID method", async () => {
  let resume!: () => void;
  const gate = new Promise<void>(done => {resume = done;});
  const query = {workspaceId};
  const readers = createWorkspaceAssetAuthoringReaders({workspaceAccess: {async authorize() {await gate;}}, assetDraftRepository: {async listAssetDraftRecords(actual: any) {assert.equal(actual.workspaceId, "workspace.legacy-test"); return {records: []};}}} as any);
  const result = readers.assetDraftRepository.listAssetDraftRecords(query);
  query.workspaceId = "workspace.foreign" as never; resume(); await result;
  assert.deepEqual(Object.keys(readers.authoredAssetRepository).sort(), ["listAuthoredAssetRecords", "readAuthoredAssetRecordByWorkspace"]);
  assert.deepEqual(Object.keys(readers.assetDraftRepository).sort(), ["listAssetDraftRecords", "readAssetDraftRecord"]);
  assert.deepEqual(Object.keys(readers.assetRevisionRepository).sort(), ["listAssetRevisionRecords", "readAssetRevisionRecord"]);
  assert.deepEqual(Object.keys(readers.assetOverrideRepository).sort(), ["listAssetOverrideRecords", "readAssetOverrideRecord"]);
});

for (const [index, [repositoryName, method, args]] of cases.entries()) {
  test(`legacy read facade: ${method} refuses absent composition before reading`, async () => {
    let effects = 0;
    const repository = new Proxy({}, {get() { return async () => { effects++; throw new Error("Protected read reached"); }; }});
    const readers: any = createWorkspaceAssetAuthoringReaders({workspaceAccess: undefined, authoredAssetRepository: repository, assetDraftRepository: repository, assetRevisionRepository: repository, assetOverrideRepository: repository} as any);
    await assert.rejects(readers[repositoryName][method](...args), /Workspace asset access is unavailable or forbidden/);
    assert.equal(effects, 0, operations[index]);
  });
  if (!method.startsWith("list")) continue;
  test(`legacy read facade: ${method} captures every supported list field before admission`, async () => {
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const field = method === "listAssetOverrideRecords" ? "targetWorkspaceId" : "workspaceId";
    const query = {...args[0] as object, status: "draft", limit: 25, cursor: "fixture-cursor"};
    const expected = structuredClone(query);
    let effects = 0;
    const repository = {[method]: async (actual: unknown) => { effects++; assert.deepEqual(actual, expected); return {records: []}; }};
    const readers: any = createWorkspaceAssetAuthoringReaders({workspaceAccess: {async authorize(ws: unknown, operation: string, scope: string) {assert.equal(ws, workspaceId); assert.equal(operation, `asset-authoring.${operations[index]}`); assert.equal(scope, "asset:read"); await gate;}}, authoredAssetRepository: repository, assetDraftRepository: repository, assetRevisionRepository: repository, assetOverrideRepository: repository} as any);
    const pending = readers[repositoryName][method](query);
    assert.equal(effects, 0);
    Object.assign(query, {[field]: "workspace.foreign", status: "published", limit: 1, cursor: "foreign-cursor", authoredAssetId: "authored.foreign"});
    release(); await pending;
    assert.equal(effects, 1);
  });
}
