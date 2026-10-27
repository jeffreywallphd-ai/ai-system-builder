import { describe, expect, it, testDouble } from "../../../../../testing/node-test";
import { DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS } from "../../../../../contracts/ipc";
import { registerAssetAuthoringIpc } from "../registerAssetAuthoringIpc";
const mk=()=>{const handlers=new Map<string,any>(); return {handlers, ipcMain:{handle:testDouble.fn((c:string,h:any)=>handlers.set(c,h))}};};
describe("registerAssetAuthoringIpc",()=>{
it("registers channels",()=>{const {ipcMain}=mk(); registerAssetAuthoringIpc({ipcMain:ipcMain as any}); expect(ipcMain.handle.mock.calls.map((c:any)=>c[0])).toContain(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL.value);});
it("requires explicit workspace context", async()=>{const {handlers,ipcMain}=mk(); registerAssetAuthoringIpc({ipcMain:ipcMain as any, createWorkspaceAuthoredAssetUseCase:{execute:testDouble.fn()} as any, createAssetDraftUseCase:{execute:testDouble.fn()} as any, createAssetOverrideUseCase:{execute:testDouble.fn()} as any}); expect((await handlers.get(DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL.value)(undefined,{payload:{}})).error.code).toBe("validation"); expect((await handlers.get(DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value)(undefined,{payload:{}})).error.code).toBe("validation"); expect((await handlers.get(DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL.value)(undefined,{payload:{}})).error.code).toBe("validation");});
it("maps publish mismatch failure and sanitizes unsafe fields", async()=>{const {handlers,ipcMain}=mk(); registerAssetAuthoringIpc({ipcMain:ipcMain as any, publishAssetDraftUseCase:{execute:testDouble.fn(async()=>({kind:"failure",failure:{code:"base-version-mismatch",message:"x"}}))} as any, authoredAssetRepository:{listAuthoredAssetRecords:testDouble.fn(async()=>({records:[{id:"a",storagePath:"/tmp/secret"}],nextCursor:"next"}))} as any}); const p=await handlers.get(DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL.value)(undefined,{payload:{targetWorkspaceId:"w"}}); expect(p.error.code).toBe("base-version-mismatch"); const list=await handlers.get(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL.value)(undefined,{payload:{workspaceId:"w"}}); expect(JSON.stringify(list)).not.toContain("/tmp/secret"); expect(list.value.assets).toEqual([{id:"a"}]); expect(list.value.nextCursor).toBe("next"); expect(list.value.records).toBeUndefined();});
it("preserves safe backing resource paths and injects the desktop actor",async()=>{const {handlers,ipcMain}=mk(); const create=testDouble.fn(async(command)=>({kind:"success",value:{customizationId:"customization-1",createdBy:command.actorId}})); const service={listTargets:testDouble.fn(),readTarget:testDouble.fn(async()=>({displayName:"Button",backingResources:[{path:"frontend/component.tsx",content:"export const Button = true;"}]})),list:testDouble.fn(),read:testDouble.fn(),create,update:testDouble.fn(),review:testDouble.fn(),publish:testDouble.fn(),abandon:testDouble.fn()}; registerAssetAuthoringIpc({ipcMain:ipcMain as any,derivedCustomizations:service as any}); const detail=await handlers.get(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.request.value)(undefined,{payload:{workspaceId:"workspace-a",definitionRef:{kind:"asset-definition-version",id:"builtin.button",version:"1.0.0"},implementationReleaseId:"implementation-release.button.1"}}); expect(detail.value.backingResources[0]).toEqual({path:"frontend/component.tsx",content:"export const Button = true;"}); await handlers.get(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.create.request.value)(undefined,{payload:{workspaceId:"workspace-a",actorId:"renderer-spoof",semanticPatch:{}}}); expect(create.mock.calls[0][0].actorId).toBe("desktop-user");});
});

it("returns explicit unavailable for the deferred list instead of calling a single-reference reader", async () => {
 const {handlers,ipcMain}=mk(); const readEffectiveSourceSummary=testDouble.fn(async()=>{throw new Error("must not run");});
 registerAssetAuthoringIpc({ipcMain:ipcMain as any,effectiveSummaryReader:{readEffectiveSourceSummary} as any});
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
