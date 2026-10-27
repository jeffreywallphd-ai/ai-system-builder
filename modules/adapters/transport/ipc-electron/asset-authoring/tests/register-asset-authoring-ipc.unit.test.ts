import nodeTest from "node:test";
import assert from "node:assert/strict";
import * as legacyReadChannels from "../../../../../contracts/ipc";
import { createWorkspaceAssetAuthoringReaders } from "../../../../../application/services/asset/workspace-asset-authoring-readers";
import { describe, expect, it, testDouble } from "../../../../../testing/node-test";
import { DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS } from "../../../../../contracts/ipc";
import { registerAssetAuthoringIpc } from "../registerAssetAuthoringIpc";
const mk=()=>{const handlers=new Map<string,any>(); return {handlers, ipcMain:{handle:testDouble.fn((c:string,h:any)=>handlers.set(c,h))}};};
describe("registerAssetAuthoringIpc",()=>{
it("registers channels",()=>{const {ipcMain}=mk(); registerAssetAuthoringIpc({senderTrust:{isTrustedSender:()=>true},ipcMain:ipcMain as any}); expect(ipcMain.handle.mock.calls.map((c:any)=>c[0])).toContain(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL.value);});
it("requires explicit workspace context", async()=>{const {handlers,ipcMain}=mk(); registerAssetAuthoringIpc({senderTrust:{isTrustedSender:()=>true},ipcMain:ipcMain as any, createWorkspaceAuthoredAssetUseCase:{execute:testDouble.fn()} as any, createAssetDraftUseCase:{execute:testDouble.fn()} as any, createAssetOverrideUseCase:{execute:testDouble.fn()} as any}); expect((await handlers.get(DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL.value)(undefined,{payload:{}})).error.code).toBe("validation"); expect((await handlers.get(DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value)(undefined,{payload:{}})).error.code).toBe("validation"); expect((await handlers.get(DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL.value)(undefined,{payload:{}})).error.code).toBe("validation");});
it("maps publish mismatch failure and sanitizes unsafe fields", async()=>{const {handlers,ipcMain}=mk(); registerAssetAuthoringIpc({senderTrust:{isTrustedSender:()=>true},ipcMain:ipcMain as any, publishAssetDraftUseCase:{execute:testDouble.fn(async()=>({kind:"failure",failure:{code:"base-version-mismatch",message:"x"}}))} as any, authoredAssetRepository:{listAuthoredAssetRecords:testDouble.fn(async()=>({records:[{id:"a",storagePath:"/tmp/secret"}],nextCursor:"next"}))} as any}); const p=await handlers.get(DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL.value)(undefined,{payload:{targetWorkspaceId:"w"}}); expect(p.error.code).toBe("base-version-mismatch"); const list=await handlers.get(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL.value)(undefined,{payload:{workspaceId:"w"}}); expect(JSON.stringify(list)).not.toContain("/tmp/secret"); expect(list.value.assets).toEqual([{id:"a"}]); expect(list.value.nextCursor).toBe("next"); expect(list.value.records).toBeUndefined();});
it("preserves safe backing resource paths and injects the desktop actor",async()=>{const {handlers,ipcMain}=mk(); const create=testDouble.fn(async(command)=>({kind:"success",value:{customizationId:"customization-1",createdBy:command.actorId}})); const service={listTargets:testDouble.fn(),readTarget:testDouble.fn(async()=>({displayName:"Button",backingResources:[{path:"frontend/component.tsx",content:"export const Button = true;"}]})),list:testDouble.fn(),read:testDouble.fn(),create,update:testDouble.fn(),review:testDouble.fn(),publish:testDouble.fn(),abandon:testDouble.fn()}; registerAssetAuthoringIpc({senderTrust:{isTrustedSender:()=>true},ipcMain:ipcMain as any,derivedCustomizations:service as any}); const detail=await handlers.get(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.request.value)(undefined,{payload:{workspaceId:"workspace-a",definitionRef:{kind:"asset-definition-version",id:"builtin.button",version:"1.0.0"},implementationReleaseId:"implementation-release.button.1"}}); expect(detail.value.backingResources[0]).toEqual({path:"frontend/component.tsx",content:"export const Button = true;"}); await handlers.get(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.create.request.value)(undefined,{payload:{workspaceId:"workspace-a",actorId:"renderer-spoof",semanticPatch:{},baseDefinitionRef:{kind:"asset-definition-version",id:"asset.base",version:"1.0.0"},derivedDefinitionRef:{kind:"asset-definition-version",id:"asset.derived",version:"1.0.0"},baseImplementationReleaseId:"release.base.1"}}); expect(create.mock.calls[0][0].actorId).toBe("desktop-user");});
});

it("returns explicit unavailable for the deferred list instead of calling a single-reference reader", async () => {
 const {handlers,ipcMain}=mk(); const readEffectiveSourceSummary=testDouble.fn(async()=>{throw new Error("must not run");});
 registerAssetAuthoringIpc({senderTrust:{isTrustedSender:()=>true},ipcMain:ipcMain as any,effectiveSummaryReader:{readEffectiveSourceSummary} as any});
 const result=await handlers.get(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL.value)(undefined,{payload:{targetWorkspaceId:"workspace.a"}});
 expect(result.ok).toBe(false); expect(result.error.code).toBe("unavailable"); expect(readEffectiveSourceSummary).not.toHaveBeenCalled();
});

it("maps the exact public legacy list target and preserves filters without a renderer workspace override", async () => {
  const {handlers, ipcMain} = mk();
  const list = testDouble.fn(async (_query: unknown) => ({records: [{draftId: "draft.synthetic"}], nextCursor: "next"}));
  registerAssetAuthoringIpc({ipcMain, ...{senderTrust: {isTrustedSender: () => true}}, assetDraftRepository: {listAssetDraftRecords: list} as any});
  const result = await handlers.get(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value)({}, {payload: {targetWorkspaceId: "workspace.owned", workspaceId: "workspace.other", status: "draft", authoredAssetId: "asset.synthetic", limit: 10, cursor: "cursor"}});
  expect(list.mock.calls[0][0]).toEqual({workspaceId: "workspace.owned", status: "draft", authoredAssetId: "asset.synthetic", limit: 10, cursor: "cursor"});
  expect(result.ok).toBe(true); expect(result.value).toEqual({drafts: [{draftId: "draft.synthetic"}], nextCursor: "next"});
});
it("settles rejected legacy Saved reads with a safe failure and refuses absent targets before reading", async () => {
  const {handlers, ipcMain} = mk(); const list = testDouble.fn(async () => {throw new Error("private adapter payload path");});
  registerAssetAuthoringIpc({ipcMain, ...{senderTrust: {isTrustedSender: () => true}}, assetDraftRepository: {listAssetDraftRecords: list} as any});
  const read = handlers.get(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value);
  const absent = await read({}, {payload: {workspaceId: "workspace.other"}});
  expect(absent.ok).toBe(false); expect(list).not.toHaveBeenCalled();
  const denied = await read({}, {payload: {targetWorkspaceId: "workspace.owned"}});
  expect(denied.ok).toBe(false); expect(denied.error.code).toBe("unavailable"); expect(JSON.stringify(denied)).not.toContain("private adapter payload path");
});

it("captures the public legacy target once before mapping the repository query", async () => {
  const {handlers, ipcMain} = mk();
  const list = testDouble.fn(async (_query: unknown) => ({records: []}));
  registerAssetAuthoringIpc({ipcMain, ...{senderTrust: {isTrustedSender: () => true}}, assetDraftRepository: {listAssetDraftRecords: list} as any});
  let reads = 0;
  const payload = {get targetWorkspaceId() { reads++; return reads === 1 ? "workspace.owned" : "workspace.other"; }};
  const result = await handlers.get(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value)({}, {payload});
  expect(result.ok).toBe(true); expect(reads).toBe(1);
  expect(list.mock.calls[0][0]).toEqual({workspaceId: "workspace.owned"});
});

const legacyReadCases = [
  {
    "tag": "LIST_AUTHORED_ASSETS",
    "repository": "authoredAssetRepository",
    "method": "listAuthoredAssetRecords",
    "suffix": "authored-assets",
    "key": "assets",
    "operation": "list-authored-assets",
    "payload": {
      "workspaceId": "workspace.legacy-test",
      "limit": 2,
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "params": {
      "workspaceId": "workspace.legacy-test"
    },
    "query": {
      "limit": "2",
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "item": {
      "workspaceId": "workspace.legacy-test"
    },
    "ipcArgs": [
      {
        "workspaceId": "workspace.legacy-test",
        "limit": 2,
        "cursor": "fixture-cursor",
        "status": "draft"
      }
    ]
  },
  {
    "tag": "READ_AUTHORED_ASSET",
    "repository": "authoredAssetRepository",
    "method": "readAuthoredAssetRecordByWorkspace",
    "suffix": "authored-assets/:authoredAssetId",
    "key": null,
    "operation": "read-authored-asset",
    "payload": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test"
    },
    "params": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test"
    },
    "query": {},
    "item": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test"
    },
    "ipcArgs": [
      "workspace.legacy-test",
      "authored.test"
    ]
  },
  {
    "tag": "LIST_DRAFTS",
    "repository": "assetDraftRepository",
    "method": "listAssetDraftRecords",
    "suffix": "drafts",
    "key": "drafts",
    "operation": "list-drafts",
    "payload": {
      "targetWorkspaceId": "workspace.legacy-test",
      "limit": 2,
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "params": {
      "workspaceId": "workspace.legacy-test"
    },
    "query": {
      "limit": "2",
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "item": {
      "targetWorkspaceId": "workspace.legacy-test"
    },
    "ipcArgs": [
      {
        "limit": 2,
        "cursor": "fixture-cursor",
        "status": "draft",
        "workspaceId": "workspace.legacy-test"
      }
    ]
  },
  {
    "tag": "READ_DRAFT",
    "repository": "assetDraftRepository",
    "method": "readAssetDraftRecord",
    "suffix": "drafts/:draftId",
    "key": null,
    "operation": "read-draft",
    "payload": {
      "targetWorkspaceId": "workspace.legacy-test",
      "draftId": "draft.test"
    },
    "params": {
      "workspaceId": "workspace.legacy-test",
      "draftId": "draft.test"
    },
    "query": {},
    "item": {
      "targetWorkspaceId": "workspace.legacy-test",
      "draftId": "draft.test"
    },
    "ipcArgs": [
      "workspace.legacy-test",
      "draft.test"
    ]
  },
  {
    "tag": "LIST_REVISIONS",
    "repository": "assetRevisionRepository",
    "method": "listAssetRevisionRecords",
    "suffix": "revisions",
    "key": "revisions",
    "operation": "list-revisions",
    "payload": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test",
      "limit": 2,
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "params": {
      "workspaceId": "workspace.legacy-test"
    },
    "query": {
      "authoredAssetId": "authored.test",
      "limit": "2",
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "item": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test"
    },
    "ipcArgs": [
      {
        "workspaceId": "workspace.legacy-test",
        "authoredAssetId": "authored.test",
        "limit": 2,
        "cursor": "fixture-cursor",
        "status": "draft"
      }
    ]
  },
  {
    "tag": "READ_REVISION",
    "repository": "assetRevisionRepository",
    "method": "readAssetRevisionRecord",
    "suffix": "revisions/:revisionId",
    "key": null,
    "operation": "read-revision",
    "payload": {
      "workspaceId": "workspace.legacy-test",
      "revisionId": "revision.test",
      "authoredAssetId": "authored.test"
    },
    "params": {
      "workspaceId": "workspace.legacy-test",
      "revisionId": "revision.test"
    },
    "query": {
      "authoredAssetId": "authored.test"
    },
    "item": {
      "workspaceId": "workspace.legacy-test",
      "revisionId": "revision.test",
      "authoredAssetId": "authored.test"
    },
    "ipcArgs": [
      "workspace.legacy-test",
      "authored.test",
      "revision.test"
    ]
  },
  {
    "tag": "LIST_OVERRIDES",
    "repository": "assetOverrideRepository",
    "method": "listAssetOverrideRecords",
    "suffix": "overrides",
    "key": "overrides",
    "operation": "list-overrides",
    "payload": {
      "targetWorkspaceId": "workspace.legacy-test",
      "limit": 2,
      "cursor": "fixture-cursor",
      "status": "draft",
      "conflictStatus": "none"
    },
    "params": {
      "workspaceId": "workspace.legacy-test"
    },
    "query": {
      "limit": "2",
      "cursor": "fixture-cursor",
      "status": "draft",
      "conflictStatus": "none"
    },
    "item": {
      "targetWorkspaceId": "workspace.legacy-test"
    },
    "ipcArgs": [
      {
        "targetWorkspaceId": "workspace.legacy-test",
        "limit": 2,
        "cursor": "fixture-cursor",
        "status": "draft",
        "conflictStatus": "none"
      }
    ]
  },
  {
    "tag": "READ_OVERRIDE",
    "repository": "assetOverrideRepository",
    "method": "readAssetOverrideRecord",
    "suffix": "overrides/:overrideId",
    "key": null,
    "operation": "read-override",
    "payload": {
      "targetWorkspaceId": "workspace.legacy-test",
      "overrideId": "override.test"
    },
    "params": {
      "workspaceId": "workspace.legacy-test",
      "overrideId": "override.test"
    },
    "query": {},
    "item": {
      "targetWorkspaceId": "workspace.legacy-test",
      "overrideId": "override.test"
    },
    "ipcArgs": [
      "workspace.legacy-test",
      "override.test"
    ]
  }
] as const;

for (const fixture of legacyReadCases) it(`legacy IPC ${fixture.operation}: safe authority denial, positive mapping and revalidation`, async () => {
  const handlers = new Map<string, any>();
  let allowed = false, effects = 0;
  const authorizations: unknown[] = [];
  const item = fixture.item;
  const repository = {[fixture.method]: async (...args: unknown[]) => {
    effects++; assert.deepEqual(args, fixture.ipcArgs);
    return fixture.key ? {records: [item], nextCursor: "next-fixture"} : item;
  }};
  const readers = createWorkspaceAssetAuthoringReaders({
    workspaceAccess: {async authorize(workspaceId: unknown, operation: string, scope: string) {
      authorizations.push([workspaceId, operation, scope]);
      if (!allowed) throw new Error("private policy detail");
    }}, authoredAssetRepository: repository, assetDraftRepository: repository,
    assetRevisionRepository: repository, assetOverrideRepository: repository,
  } as any);
  registerAssetAuthoringIpc({ipcMain: {handle(name, listener) {handlers.set(name, listener);}}, senderTrust: {isTrustedSender: () => true}, ...readers});
  const contract = legacyReadChannels as unknown as Record<string, any>;
  const requestChannel = contract[`DESKTOP_ASSET_AUTHORING_${fixture.tag}_REQUEST_CHANNEL`];
  const responseChannel = contract[`DESKTOP_ASSET_AUTHORING_${fixture.tag}_RESPONSE_CHANNEL`];
  const request = {requestId: "fixture-request", correlationId: "fixture-correlation", payload: fixture.payload};
  const handler = handlers.get(requestChannel.value);
  for (const state of [false, true, false]) {
    allowed = state;
    const result = await handler({}, request);
    assert.equal(result.ok, state);
    assert.equal(result.channel, responseChannel.value);
    assert.equal(result.operation, `asset-authoring.${fixture.operation}`);
    assert.equal(result.requestId, request.requestId);
    assert.equal(result.correlationId, request.correlationId);
    if (state) assert.deepEqual(result.value, fixture.key ? {[fixture.key]: [item], nextCursor: "next-fixture"} : item);
    else {assert.equal(result.error.code, "unavailable"); assert.ok(!JSON.stringify(result).includes("private policy detail"));}
  }
  assert.equal(effects, 1);
  assert.deepEqual(authorizations, Array(3).fill(["workspace.legacy-test", `asset-authoring.${fixture.operation}`, "asset:read"]));
  const invalid = await handler({}, {...request, payload: {}});
  assert.equal(invalid.ok, false); assert.equal(invalid.error.code, "validation");
  assert.equal(authorizations.length, 3); assert.equal(effects, 1);
});

const derivedInput = (): any => ({workspaceId: "workspace.derived-test", customizationId: "customization.original", expectedRevision: 1, actorId: "renderer-spoof", operation: "publish", scope: "security:admin", baseDefinitionRef: {kind: "asset-definition-version", id: "asset.base", version: "1.0.0"}, definitionRef: {kind: "asset-definition-version", id: "asset.base", version: "1.0.0"}, derivedDefinitionRef: {kind: "asset-definition-version", id: "asset.derived", version: "1.0.0"}, baseImplementationReleaseId: "release.base.1", implementationReleaseId: "release.base.1", semanticPatch: {"display-name": "Original", "default-configuration": {value: "original"}}, text: "original", limit: 5});
const derivedKeys = Object.keys(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS) as (keyof typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS)[];
for (const key of derivedKeys) {
  for (const mode of ["missing", "rejected"] as const) nodeTest(`derived ${key}: ${mode} loader preserves fixed unavailable envelope`, {timeout: 5_000}, async () => {
    const {handlers, ipcMain} = mk(); const contexts: any[] = [];
    registerAssetAuthoringIpc({ipcMain, senderTrust: {isTrustedSender: () => true}, async getDerivedCustomizations(context) {contexts.push(context); if (mode === "rejected") throw Error("private loader path detail"); return undefined;}});
    const descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key];
    const result = await handlers.get(descriptor.request.value)({}, {requestId: "request.original", correlationId: "correlation.original", payload: derivedInput()});
    assert.equal(result.ok, false); assert.equal(result.error.code, "unavailable"); assert.equal(result.error.message, "Derived customization is unavailable.");
    assert.equal(result.channel, descriptor.response.value); assert.equal(result.operation, descriptor.operation); assert.equal(result.requestId, "request.original"); assert.equal(result.correlationId, "correlation.original");
    assert.deepEqual(contexts, [{operation: key, workspaceId: "workspace.derived-test"}]); assert.ok(!JSON.stringify(result).includes("private loader"));
  });
  nodeTest(`derived ${key}: dispatch owns request and handler-selected context before loader wait`, {timeout: 5_000}, async () => {
    const {handlers, ipcMain} = mk(); let entered!: () => void, release!: () => void; const ready = new Promise<void>(done => {entered = done;}), gate = new Promise<void>(done => {release = done;});
    const calls: any[][] = [], contexts: any[] = [];
    const service = new Proxy({}, {get: (_target, method) => method === "then" ? undefined : async (...args: any[]) => {calls.push(args); return method === "list" ? {records: []} : method === "listTargets" ? {targets: []} : method === "read" || method === "readTarget" ? {customizationId: "customization.original"} : {kind: "success", value: {customizationId: "customization.original"}};}});
    registerAssetAuthoringIpc({ipcMain, senderTrust: {isTrustedSender: () => true}, async getDerivedCustomizations(context) {contexts.push(context); entered(); await gate; return service as any;}});
    const request: any = {requestId: "request.original", correlationId: "correlation.original", payload: derivedInput()};
    const pending = handlers.get(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key].request.value)({}, request);
    try {
      await ready; request.requestId = "request.changed"; request.correlationId = "correlation.changed"; request.payload.workspaceId = "workspace.foreign"; request.payload.customizationId = "customization.changed"; request.payload.expectedRevision = 99; request.payload.baseDefinitionRef.id = "asset.changed"; request.payload.definitionRef.id = "asset.changed"; request.payload.derivedDefinitionRef.id = "asset.changed"; request.payload.semanticPatch["default-configuration"].value = "changed"; request.payload.text = "changed"; request.payload.actorId = "changed"; release();
      const result = await pending; assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.requestId, "request.original"); assert.equal(result.correlationId, "correlation.original"); assert.deepEqual(contexts, [{operation: key, workspaceId: "workspace.derived-test"}]); assert.equal(calls.length, 1);
      if (key === "read") assert.deepEqual(calls[0], ["workspace.derived-test", "customization.original"]);
      else {
        const command = calls[0][0]; assert.equal(command.workspaceId, "workspace.derived-test");
        if (key === "create" || key === "update") {assert.deepEqual(command.semanticPatch["default-configuration"], {value: "original"}); assert.equal(command.actorId, "desktop-user");}
        if (["update", "review", "publish", "abandon"].includes(key)) {assert.equal(command.customizationId, "customization.original"); assert.equal(command.expectedRevision, 1); assert.equal(command.actorId, "desktop-user");}
        if (key === "listTargets" || key === "list") assert.equal(command.text, "original");
        if (key === "readTarget") assert.equal(command.definitionRef.id, "asset.base");
        if (key === "create") assert.equal(command.baseDefinitionRef.id, "asset.base");
      }
    } finally {release(); await pending;}
  });
  nodeTest(`derived ${key}: malformed workspace validation happens without loader effects`, {timeout: 5_000}, async () => {
    const {handlers, ipcMain} = mk(); let effects = 0;
    registerAssetAuthoringIpc({ipcMain, senderTrust: {isTrustedSender: () => true}, async getDerivedCustomizations() {effects++; return undefined;}});
    const descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key]; const result = await handlers.get(descriptor.request.value)({}, {requestId: "malformed", correlationId: "malformed", payload: {...derivedInput(), workspaceId: null}});
    assert.equal(result.ok, false); assert.equal(result.error.code, "validation"); assert.equal(result.channel, descriptor.response.value); assert.equal(result.operation, descriptor.operation); assert.equal(effects, 0);
  });
  nodeTest(`derived ${key}: sender denial precedes payload capture and resolver`, {timeout: 5_000}, async () => {
    const {handlers, ipcMain} = mk(); let effects = 0; const request: any = {requestId: "untrusted", correlationId: "untrusted"}; Object.defineProperty(request, "payload", {get() {effects++; throw Error("must not inspect payload");}});
    registerAssetAuthoringIpc({ipcMain, senderTrust: {isTrustedSender: () => false}, async getDerivedCustomizations() {effects++; return undefined;}});
    const result = await handlers.get(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key].request.value)({}, request); assert.equal(result.ok, false); assert.equal(effects, 0);
  });
}
for (const key of ["readTarget", "read"] as const) nodeTest(`derived ${key}: genuine absent records remain not-found`, async () => {
  const {handlers, ipcMain} = mk(); registerAssetAuthoringIpc({ipcMain, senderTrust: {isTrustedSender: () => true}, derivedCustomizations: {async readTarget() {}, async read() {}} as any});
  const result = await handlers.get(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key].request.value)({}, {payload: derivedInput()}); assert.equal(result.ok, false); assert.equal(result.error.code, "not-found");
});
