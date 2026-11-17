import { captureDerivedCreate, captureDerivedUpdate, captureDerivedTransition, captureDerivedList, captureDerivedTargetList, captureDerivedTargetRead } from "../../../../application/services/asset/capture-derived-customization-requests";
import type { WorkspaceAssetAuthoringReaders } from "../../../../application/services/asset/workspace-asset-authoring-readers";
import type { AssetDerivedCustomizationApplicationPort, AuthoredAssetRepositoryPort, AssetDraftRepositoryPort, AssetOverrideRepositoryPort, AssetRevisionRepositoryPort } from "../../../../application/ports/asset-authoring";
import type { WorkspaceAssetAuthoringReadModelService } from "../../../../application/services/asset/workspace-asset-authoring-read-model.service";
import type { CreateAssetDraftUseCase, CreateAssetOverrideUseCase, CreateWorkspaceAuthoredAssetUseCase, DisableAssetOverrideUseCase, PublishAssetDraftUseCase, UpdateAssetDraftUseCase, UpdateAssetOverrideUseCase } from "../../../../application/use-cases/asset-authoring";
import { ASSET_DERIVED_CUSTOMIZATION_OPERATIONS, normalizeAssetCustomizationId, normalizeAssetDraftId, normalizeAssetOverrideId, normalizeAssetRevisionId, normalizeAuthoredAssetId, type AssetAuthoringFailureCode } from "../../../../contracts/asset-authoring";
import { createDesktopAssetAuthoringFailureResponse, createDesktopAssetAuthoringOperationSuccessResponse, DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL, DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS } from "../../../../contracts/ipc";
import { createWorkspaceId, type WorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort, IpcSenderTrustPolicy } from "../ipcMainHandlePort";
import { guardedIpcMainHandlePort } from "../guardedIpcMainHandlePort";

export interface RegisterAssetAuthoringIpcDependencies { readonly ipcMain: IpcMainHandlePort; readonly senderTrust: IpcSenderTrustPolicy; readonly createWorkspaceAuthoredAssetUseCase?: CreateWorkspaceAuthoredAssetUseCase; readonly createAssetDraftUseCase?: CreateAssetDraftUseCase; readonly updateAssetDraftUseCase?: UpdateAssetDraftUseCase; readonly publishAssetDraftUseCase?: PublishAssetDraftUseCase; readonly createAssetOverrideUseCase?: CreateAssetOverrideUseCase; readonly updateAssetOverrideUseCase?: UpdateAssetOverrideUseCase; readonly disableAssetOverrideUseCase?: DisableAssetOverrideUseCase; readonly authoredAssetRepository?: WorkspaceAssetAuthoringReaders["authoredAssetRepository"]; readonly assetDraftRepository?: WorkspaceAssetAuthoringReaders["assetDraftRepository"]; readonly assetRevisionRepository?: WorkspaceAssetAuthoringReaders["assetRevisionRepository"]; readonly assetOverrideRepository?: WorkspaceAssetAuthoringReaders["assetOverrideRepository"]; readonly effectiveSummaryReader?: WorkspaceAssetAuthoringReadModelService; readonly derivedCustomizations?: AssetDerivedCustomizationApplicationPort; readonly getDerivedCustomizations?: (context: { readonly operation: keyof typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS; readonly workspaceId: WorkspaceId }) => Promise<AssetDerivedCustomizationApplicationPort | undefined>; }
type Ctx={requestId?:string;correlationId?:string}; const txt=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0; const UNSAFE=/(path|storage|providerPayload|payload|prompt|workflow|token|stack|command|env|base64|blob|bytes|secret|signedUrl|url|locator)/i;
const s=<T>(v:T):T=>Array.isArray(v)?v.map((x)=>s(x)) as T:(!v||typeof v!=="object")?v:Object.fromEntries(Object.entries(v as Record<string,unknown>).filter(([k])=>!UNSAFE.test(k)).map(([k,n])=>[k,s(n)])) as T;
const c=(r:any):Ctx=>({requestId:r?.requestId,correlationId:r?.correlationId});
const fail=(ch:any,op:string,code:AssetAuthoringFailureCode,m:string,ctx:Ctx)=>createDesktopAssetAuthoringFailureResponse(ch,op,code,m,ctx);

export function registerAssetAuthoringIpc(dependencies:RegisterAssetAuthoringIpcDependencies):void{
  const d = { ...dependencies, ipcMain: guardedIpcMainHandlePort(dependencies.ipcMain, dependencies.senderTrust, [
    { request: DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL },
    { request: DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL, response: DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL },
    ...Object.values(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS),
  ]) };
  const cmd=(rq:string,rs:any,op:string,uc:any,wf:string)=>d.ipcMain.handle(rq,async(_e,req:any)=>{const ctx=c(req); if(!uc)return fail(rs,op,"unavailable","Operation unavailable.",ctx); if(!txt(req?.payload?.[wf])) return fail(rs,op,"validation",`${wf} is required.`,ctx); try{const r=await uc.execute(req.payload); if(r.kind==="failure") return fail(rs,op,(r.failure.code as any),r.failure.message,ctx); return createDesktopAssetAuthoringOperationSuccessResponse(rs,s(r.value),ctx);}catch{return fail(rs,op,"internal","Operation failed.",ctx);}});
  cmd(DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.create-workspace-authored-asset",d.createWorkspaceAuthoredAssetUseCase,"workspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL,"asset-authoring.create-draft",d.createAssetDraftUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL,"asset-authoring.update-draft",d.updateAssetDraftUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL,"asset-authoring.publish-draft",d.publishAssetDraftUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.create-override",d.createAssetOverrideUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.update-override",d.updateAssetOverrideUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.disable-override",d.disableAssetOverrideUseCase,"targetWorkspaceId");
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL.value, async (_event, request: any) => {
    const response = DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL;
    const operation = "asset-authoring.list-authored-assets";
    const context = c(request);
    const repository = d.authoredAssetRepository;
    if (!repository) return fail(response, operation, "unavailable", "Read unavailable.", context);
    if (!txt(request?.payload?.workspaceId)) return fail(response, operation, "validation", "workspaceId is required.", context);
    try {
      const {records, nextCursor} = await repository.listAuthoredAssetRecords(request.payload);
      return createDesktopAssetAuthoringOperationSuccessResponse(response, s({assets: records, nextCursor}), context);
    } catch {
      return fail(response, operation, "unavailable", "Workspace asset reads are unavailable or forbidden.", context);
    }
  });
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value, async (_event, request: any) => {
    const response = DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL;
    const operation = "asset-authoring.list-drafts";
    if (!d.assetDraftRepository) return fail(response, operation, "unavailable", "Read unavailable.", c(request));
    const payload = request?.payload;
    const targetWorkspaceId = payload?.targetWorkspaceId;
    if (!txt(targetWorkspaceId)) return fail(response, operation, "validation", "targetWorkspaceId is required.", c(request));
    try {
      // The public legacy request names the target; the repository uses workspaceId.
      // Never let an extra renderer-supplied workspaceId redirect that target.
      const {records, nextCursor} = await d.assetDraftRepository.listAssetDraftRecords({
        workspaceId: createWorkspaceId(targetWorkspaceId),
        ...(payload.status === undefined ? {} : {status: payload.status}),
        ...(payload.authoredAssetId === undefined ? {} : {authoredAssetId: payload.authoredAssetId}),
        ...(payload.limit === undefined ? {} : {limit: payload.limit}),
        ...(payload.cursor === undefined ? {} : {cursor: payload.cursor}),
      });
      return createDesktopAssetAuthoringOperationSuccessResponse(response, s({drafts: records, nextCursor}), c(request));
    } catch {
      return fail(response, operation, "unavailable", "Saved asset reads are unavailable or forbidden.", c(request));
    }
  });
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL.value, async (_event, request: any) => {
    const response = DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL;
    const operation = "asset-authoring.list-revisions";
    const context = c(request);
    const repository = d.assetRevisionRepository;
    if (!repository) return fail(response, operation, "unavailable", "Read unavailable.", context);
    if (!txt(request?.payload?.workspaceId)) return fail(response, operation, "validation", "workspaceId is required.", context);
    try {
      const {records, nextCursor} = await repository.listAssetRevisionRecords(request.payload);
      return createDesktopAssetAuthoringOperationSuccessResponse(response, s({revisions: records, nextCursor}), context);
    } catch {
      return fail(response, operation, "unavailable", "Workspace asset reads are unavailable or forbidden.", context);
    }
  });
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL.value, async (_event, request: any) => {
    const response = DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL;
    const operation = "asset-authoring.list-overrides";
    const context = c(request);
    const repository = d.assetOverrideRepository;
    if (!repository) return fail(response, operation, "unavailable", "Read unavailable.", context);
    if (!txt(request?.payload?.targetWorkspaceId)) return fail(response, operation, "validation", "targetWorkspaceId is required.", context);
    try {
      const {records, nextCursor} = await repository.listAssetOverrideRecords(request.payload);
      return createDesktopAssetAuthoringOperationSuccessResponse(response, s({overrides: records, nextCursor}), context);
    } catch {
      return fail(response, operation, "unavailable", "Workspace asset reads are unavailable or forbidden.", context);
    }
  });
  // The API exposes the same deferred operation. Never turn a list request
  // into an unscoped single-reference read with an absent assetReference.
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL.value,async(_e,r:any)=>
    fail(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL,"asset-authoring.list-effective-summaries","unavailable","Workspace-wide effective summaries are unavailable.",c(r)));
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL.value,async(_e,r:any)=>{const ctx=c(r); if(!d.authoredAssetRepository) return fail(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.read-authored-asset","unavailable","Read unavailable.",ctx); const w=r?.payload?.workspaceId; const id=r?.payload?.authoredAssetId; if(!txt(w)||!txt(id)) return fail(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.read-authored-asset","validation","workspaceId and authoredAssetId are required.",ctx); try{const item=await d.authoredAssetRepository.readAuthoredAssetRecordByWorkspace(createWorkspaceId(w),normalizeAuthoredAssetId(id)); if(!item) return fail(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.read-authored-asset","not-found","Authored asset was not found.",ctx); return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,s(item),ctx);}catch{return fail(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.read-authored-asset","unavailable","Workspace asset reads are unavailable or forbidden.",ctx);}});
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL.value,async(_e,r:any)=>{const ctx=c(r); if(!d.assetDraftRepository) return fail(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,"asset-authoring.read-draft","unavailable","Read unavailable.",ctx); const w=r?.payload?.targetWorkspaceId; const id=r?.payload?.draftId; if(!txt(w)||!txt(id)) return fail(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,"asset-authoring.read-draft","validation","targetWorkspaceId and draftId are required.",ctx); try{const item=await d.assetDraftRepository.readAssetDraftRecord(createWorkspaceId(w),normalizeAssetDraftId(id)); if(!item) return fail(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,"asset-authoring.read-draft","not-found","Draft was not found.",ctx); return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,s(item),ctx);}catch{return fail(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,"asset-authoring.read-draft","unavailable","Workspace asset reads are unavailable or forbidden.",ctx);}});
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL.value,async(_e,r:any)=>{const ctx=c(r); if(!d.assetRevisionRepository) return fail(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,"asset-authoring.read-revision","unavailable","Read unavailable.",ctx); const w=r?.payload?.workspaceId; const a=r?.payload?.authoredAssetId; const id=r?.payload?.revisionId; if(!txt(w)||!txt(a)||!txt(id)) return fail(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,"asset-authoring.read-revision","validation","workspaceId, authoredAssetId, and revisionId are required.",ctx); try{const item=await d.assetRevisionRepository.readAssetRevisionRecord(createWorkspaceId(w),normalizeAuthoredAssetId(a),normalizeAssetRevisionId(id)); if(!item) return fail(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,"asset-authoring.read-revision","not-found","Revision was not found.",ctx); return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,s(item),ctx);}catch{return fail(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,"asset-authoring.read-revision","unavailable","Workspace asset reads are unavailable or forbidden.",ctx);}});
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL.value,async(_e,r:any)=>{const ctx=c(r); if(!d.assetOverrideRepository) return fail(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.read-override","unavailable","Read unavailable.",ctx); const w=r?.payload?.targetWorkspaceId; const id=r?.payload?.overrideId; if(!txt(w)||!txt(id)) return fail(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.read-override","validation","targetWorkspaceId and overrideId are required.",ctx); try{const item=await d.assetOverrideRepository.readAssetOverrideRecord(createWorkspaceId(w),normalizeAssetOverrideId(id)); if(!item) return fail(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.read-override","not-found","Override was not found.",ctx); return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,s(item),ctx);}catch{return fail(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.read-override","unavailable","Workspace asset reads are unavailable or forbidden.",ctx);}});
  registerDerivedCustomizationIpc(d);
}

function registerDerivedCustomizationIpc(d: RegisterAssetAuthoringIpcDependencies): void {
  type Key = keyof typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS;
  const resolve = async (operation: Key, workspaceId: WorkspaceId) => {
    try { return d.derivedCustomizations ?? (await d.getDerivedCustomizations?.({operation, workspaceId})); }
    catch { return undefined; }
  };
  const unavailable = (key: Key, ctx: Ctx) => {
    const descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key];
    return fail(descriptor.response, descriptor.operation, "unavailable", "Derived customization is unavailable.", ctx);
  };
  const body = (request: any): any => {
    if (!request?.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) throw new Error("Invalid request.");
    return request.payload;
  };
  const workspace = (value: unknown): WorkspaceId => {
    if (!txt(value)) throw new Error("Invalid workspace.");
    return createWorkspaceId(value);
  };

  d.ipcMain.handle(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets.request.value, async (_event, request: any) => {
    const ctx = c(request), descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets;
    if (!txt(request?.payload?.workspaceId)) return fail(descriptor.response, descriptor.operation, "validation", "workspaceId is required.", ctx);
    let query;
    try { const captured = captureDerivedTargetList(body(request)); query = {...captured, workspaceId: workspace(captured.workspaceId)}; }
    catch { return fail(descriptor.response, descriptor.operation, "validation", "Customization target query is invalid.", ctx); }
    const service = await resolve("listTargets", query.workspaceId);
    if (!service) return unavailable("listTargets", ctx);
    try { return createDesktopAssetAuthoringOperationSuccessResponse(descriptor.response, await service.listTargets(query), ctx); }
    catch { return fail(descriptor.response, descriptor.operation, "validation", "Customization target query is invalid.", ctx); }
  });

  d.ipcMain.handle(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.request.value, async (_event, request: any) => {
    const ctx = c(request), descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget;
    if (!txt(request?.payload?.workspaceId)) return fail(descriptor.response, descriptor.operation, "validation", "workspaceId is required.", ctx);
    let query;
    try { const captured = captureDerivedTargetRead(body(request)); query = {...captured, workspaceId: workspace(captured.workspaceId)}; }
    catch { return fail(descriptor.response, descriptor.operation, "validation", "Customization target identity is invalid.", ctx); }
    const service = await resolve("readTarget", query.workspaceId);
    if (!service) return unavailable("readTarget", ctx);
    try {
      const value = await service.readTarget(query);
      if (!value) return fail(descriptor.response, descriptor.operation, "not-found", "Customization target was not found.", ctx);
      return createDesktopAssetAuthoringOperationSuccessResponse(descriptor.response, value, ctx);
    } catch { return fail(descriptor.response, descriptor.operation, "validation", "Customization target identity is invalid.", ctx); }
  });

  d.ipcMain.handle(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.list.request.value, async (_event, request: any) => {
    const ctx = c(request), descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.list;
    if (!txt(request?.payload?.workspaceId)) return fail(descriptor.response, descriptor.operation, "validation", "workspaceId is required.", ctx);
    let query;
    try { const captured = captureDerivedList(body(request)); query = {...captured, workspaceId: workspace(captured.workspaceId)}; }
    catch { return fail(descriptor.response, descriptor.operation, "validation", "Customization query is invalid.", ctx); }
    const service = await resolve("list", query.workspaceId);
    if (!service) return unavailable("list", ctx);
    try {
      const value = await service.list(query);
      return createDesktopAssetAuthoringOperationSuccessResponse(descriptor.response, {customizations: value.records, nextCursor: value.nextCursor}, ctx);
    } catch { return fail(descriptor.response, descriptor.operation, "validation", "Customization query is invalid.", ctx); }
  });

  d.ipcMain.handle(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read.request.value, async (_event, request: any) => {
    const ctx = c(request), descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read;
    if (!txt(request?.payload?.workspaceId) || !txt(request?.payload?.customizationId)) return fail(descriptor.response, descriptor.operation, "validation", "workspaceId and customizationId are required.", ctx);
    let workspaceId: WorkspaceId, customizationId: ReturnType<typeof normalizeAssetCustomizationId>;
    try {
      const input = body(request); workspaceId = workspace(input.workspaceId);
      if (!txt(input.customizationId)) throw new Error("Invalid identity.");
      customizationId = normalizeAssetCustomizationId(input.customizationId);
    } catch { return fail(descriptor.response, descriptor.operation, "validation", "Customization identity is invalid.", ctx); }
    const service = await resolve("read", workspaceId);
    if (!service) return unavailable("read", ctx);
    try {
      const value = await service.read(workspaceId, customizationId);
      if (!value) return fail(descriptor.response, descriptor.operation, "not-found", "Derived customization was not found.", ctx);
      return createDesktopAssetAuthoringOperationSuccessResponse(descriptor.response, value, ctx);
    } catch { return fail(descriptor.response, descriptor.operation, "validation", "Customization identity is invalid.", ctx); }
  });

  const mutation = (key: "create" | "update" | "review" | "publish" | "abandon", execute: (service: AssetDerivedCustomizationApplicationPort, command: any) => Promise<any>) => {
    const descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key];
    d.ipcMain.handle(descriptor.request.value, async (_event, request: any) => {
      const ctx = c(request);
      if (!txt(request?.payload?.workspaceId)) return fail(descriptor.response, descriptor.operation, "validation", "workspaceId is required.", ctx);
      let command;
      try {
        const input = body(request);
        const captured = key === "create" ? captureDerivedCreate(input, "desktop-user") : key === "update" ? captureDerivedUpdate(input, "desktop-user") : captureDerivedTransition(input, "desktop-user");
        command = {...captured, workspaceId: workspace(captured.workspaceId)};
      } catch { return fail(descriptor.response, descriptor.operation, "validation", "Derived customization request is invalid.", ctx); }
      const service = await resolve(key, command.workspaceId);
      if (!service) return unavailable(key, ctx);
      try {
        const result = await execute(service, command);
        if (result.kind === "failure") return fail(descriptor.response, descriptor.operation, result.failure.code, result.failure.message, ctx);
        return createDesktopAssetAuthoringOperationSuccessResponse(descriptor.response, result.value, ctx);
      } catch { return fail(descriptor.response, descriptor.operation, "validation", "Derived customization request is invalid.", ctx); }
    });
  };
  mutation("create", (service, command) => service.create(command));
  mutation("update", (service, command) => service.update(command));
  mutation("review", (service, command) => service.review(command));
  mutation("publish", (service, command) => service.publish(command));
  mutation("abandon", (service, command) => service.abandon(command));
}
