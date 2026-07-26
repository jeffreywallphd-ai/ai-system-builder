import type { AssetDerivedCustomizationApplicationPort, AuthoredAssetRepositoryPort, AssetDraftRepositoryPort, AssetOverrideRepositoryPort, AssetRevisionRepositoryPort } from "../../../../application/ports/asset-authoring";
import type { WorkspaceAssetAuthoringReadModelService } from "../../../../application/services/asset/workspace-asset-authoring-read-model.service";
import type { CreateAssetDraftUseCase, CreateAssetOverrideUseCase, CreateWorkspaceAuthoredAssetUseCase, DisableAssetOverrideUseCase, PublishAssetDraftUseCase, UpdateAssetDraftUseCase, UpdateAssetOverrideUseCase } from "../../../../application/use-cases/asset-authoring";
import { ASSET_DERIVED_CUSTOMIZATION_OPERATIONS, normalizeAssetCustomizationId, normalizeAssetDraftId, normalizeAssetOverrideId, normalizeAssetRevisionId, normalizeAuthoredAssetId, type AssetAuthoringFailureCode } from "../../../../contracts/asset-authoring";
import { createDesktopAssetAuthoringFailureResponse, createDesktopAssetAuthoringOperationSuccessResponse, DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL, DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL, DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS } from "../../../../contracts/ipc";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterAssetAuthoringIpcDependencies { readonly ipcMain: IpcMainHandlePort; readonly createWorkspaceAuthoredAssetUseCase?: CreateWorkspaceAuthoredAssetUseCase; readonly createAssetDraftUseCase?: CreateAssetDraftUseCase; readonly updateAssetDraftUseCase?: UpdateAssetDraftUseCase; readonly publishAssetDraftUseCase?: PublishAssetDraftUseCase; readonly createAssetOverrideUseCase?: CreateAssetOverrideUseCase; readonly updateAssetOverrideUseCase?: UpdateAssetOverrideUseCase; readonly disableAssetOverrideUseCase?: DisableAssetOverrideUseCase; readonly authoredAssetRepository?: AuthoredAssetRepositoryPort; readonly assetDraftRepository?: AssetDraftRepositoryPort; readonly assetRevisionRepository?: AssetRevisionRepositoryPort; readonly assetOverrideRepository?: AssetOverrideRepositoryPort; readonly effectiveSummaryReader?: WorkspaceAssetAuthoringReadModelService; readonly derivedCustomizations?: AssetDerivedCustomizationApplicationPort; readonly getDerivedCustomizations?: () => Promise<AssetDerivedCustomizationApplicationPort | undefined>; }
type Ctx={requestId?:string;correlationId?:string}; const txt=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0; const UNSAFE=/(path|storage|providerPayload|payload|prompt|workflow|token|stack|command|env|base64|blob|bytes|secret|signedUrl|url|locator)/i;
const s=<T>(v:T):T=>Array.isArray(v)?v.map((x)=>s(x)) as T:(!v||typeof v!=="object")?v:Object.fromEntries(Object.entries(v as Record<string,unknown>).filter(([k])=>!UNSAFE.test(k)).map(([k,n])=>[k,s(n)])) as T;
const c=(r:any):Ctx=>({requestId:r?.requestId,correlationId:r?.correlationId});
const fail=(ch:any,op:string,code:AssetAuthoringFailureCode,m:string,ctx:Ctx)=>createDesktopAssetAuthoringFailureResponse(ch,op,code,m,ctx);

export function registerAssetAuthoringIpc(d:RegisterAssetAuthoringIpcDependencies):void{
  const cmd=(rq:string,rs:any,op:string,uc:any,wf:string)=>d.ipcMain.handle(rq,async(_e,req:any)=>{const ctx=c(req); if(!uc)return fail(rs,op,"unavailable","Operation unavailable.",ctx); if(!txt(req?.payload?.[wf])) return fail(rs,op,"validation",`${wf} is required.`,ctx); try{const r=await uc.execute(req.payload); if(r.kind==="failure") return fail(rs,op,(r.failure.code as any),r.failure.message,ctx); return createDesktopAssetAuthoringOperationSuccessResponse(rs,s(r.value),ctx);}catch{return fail(rs,op,"internal","Operation failed.",ctx);}});
  cmd(DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.create-workspace-authored-asset",d.createWorkspaceAuthoredAssetUseCase,"workspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL,"asset-authoring.create-draft",d.createAssetDraftUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL,"asset-authoring.update-draft",d.updateAssetDraftUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL,"asset-authoring.publish-draft",d.publishAssetDraftUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.create-override",d.createAssetOverrideUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.update-override",d.updateAssetOverrideUseCase,"targetWorkspaceId");
  cmd(DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL.value,DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.disable-override",d.disableAssetOverrideUseCase,"targetWorkspaceId");
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL.value,async(_e,r:any)=>!d.authoredAssetRepository?fail(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL,"asset-authoring.list-authored-assets","unavailable","Read unavailable.",c(r)):!txt(r?.payload?.workspaceId)?fail(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL,"asset-authoring.list-authored-assets","validation","workspaceId is required.",c(r)):createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL,s(await d.authoredAssetRepository.listAuthoredAssetRecords(r.payload)),c(r)));
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value,async(_e,r:any)=>!d.assetDraftRepository?fail(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL,"asset-authoring.list-drafts","unavailable","Read unavailable.",c(r)):!txt(r?.payload?.targetWorkspaceId)?fail(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL,"asset-authoring.list-drafts","validation","targetWorkspaceId is required.",c(r)):createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL,s(await d.assetDraftRepository.listAssetDraftRecords(r.payload)),c(r)));
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL.value,async(_e,r:any)=>!d.assetRevisionRepository?fail(DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL,"asset-authoring.list-revisions","unavailable","Read unavailable.",c(r)):!txt(r?.payload?.workspaceId)?fail(DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL,"asset-authoring.list-revisions","validation","workspaceId is required.",c(r)):createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL,s(await d.assetRevisionRepository.listAssetRevisionRecords(r.payload)),c(r)));
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL.value,async(_e,r:any)=>!d.assetOverrideRepository?fail(DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL,"asset-authoring.list-overrides","unavailable","Read unavailable.",c(r)):!txt(r?.payload?.targetWorkspaceId)?fail(DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL,"asset-authoring.list-overrides","validation","targetWorkspaceId is required.",c(r)):createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL,s(await d.assetOverrideRepository.listAssetOverrideRecords(r.payload)),c(r)));
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL.value,async(_e,r:any)=>!d.effectiveSummaryReader?fail(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL,"asset-authoring.list-effective-summaries","unavailable","Read unavailable.",c(r)):!txt(r?.payload?.targetWorkspaceId)?fail(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL,"asset-authoring.list-effective-summaries","validation","targetWorkspaceId is required.",c(r)):createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL,s({items:[await d.effectiveSummaryReader.readEffectiveSourceSummary(r.payload.targetWorkspaceId,r.payload.assetReference)].filter(Boolean)}),c(r)));
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL.value,async(_e,r:any)=>{const ctx=c(r); if(!d.authoredAssetRepository) return fail(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.read-authored-asset","unavailable","Read unavailable.",ctx); const w=r?.payload?.workspaceId; const id=r?.payload?.authoredAssetId; if(!txt(w)||!txt(id)) return fail(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.read-authored-asset","validation","workspaceId and authoredAssetId are required.",ctx); try{const item=await d.authoredAssetRepository.readAuthoredAssetRecordByWorkspace(createWorkspaceId(w),normalizeAuthoredAssetId(id)); if(!item) return fail(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.read-authored-asset","not-found","Authored asset was not found.",ctx); return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,s(item),ctx);}catch{return fail(DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,"asset-authoring.read-authored-asset","validation","workspaceId and authoredAssetId are invalid.",ctx);}});
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL.value,async(_e,r:any)=>{const ctx=c(r); if(!d.assetDraftRepository) return fail(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,"asset-authoring.read-draft","unavailable","Read unavailable.",ctx); const w=r?.payload?.targetWorkspaceId; const id=r?.payload?.draftId; if(!txt(w)||!txt(id)) return fail(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,"asset-authoring.read-draft","validation","targetWorkspaceId and draftId are required.",ctx); try{const item=await d.assetDraftRepository.readAssetDraftRecord(createWorkspaceId(w),normalizeAssetDraftId(id)); if(!item) return fail(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,"asset-authoring.read-draft","not-found","Draft was not found.",ctx); return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,s(item),ctx);}catch{return fail(DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,"asset-authoring.read-draft","validation","targetWorkspaceId and draftId are invalid.",ctx);}});
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL.value,async(_e,r:any)=>{const ctx=c(r); if(!d.assetRevisionRepository) return fail(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,"asset-authoring.read-revision","unavailable","Read unavailable.",ctx); const w=r?.payload?.workspaceId; const a=r?.payload?.authoredAssetId; const id=r?.payload?.revisionId; if(!txt(w)||!txt(a)||!txt(id)) return fail(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,"asset-authoring.read-revision","validation","workspaceId, authoredAssetId, and revisionId are required.",ctx); try{const item=await d.assetRevisionRepository.readAssetRevisionRecord(createWorkspaceId(w),normalizeAuthoredAssetId(a),normalizeAssetRevisionId(id)); if(!item) return fail(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,"asset-authoring.read-revision","not-found","Revision was not found.",ctx); return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,s(item),ctx);}catch{return fail(DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,"asset-authoring.read-revision","validation","workspaceId, authoredAssetId, and revisionId are invalid.",ctx);}});
  d.ipcMain.handle(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL.value,async(_e,r:any)=>{const ctx=c(r); if(!d.assetOverrideRepository) return fail(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.read-override","unavailable","Read unavailable.",ctx); const w=r?.payload?.targetWorkspaceId; const id=r?.payload?.overrideId; if(!txt(w)||!txt(id)) return fail(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.read-override","validation","targetWorkspaceId and overrideId are required.",ctx); try{const item=await d.assetOverrideRepository.readAssetOverrideRecord(createWorkspaceId(w),normalizeAssetOverrideId(id)); if(!item) return fail(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.read-override","not-found","Override was not found.",ctx); return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,s(item),ctx);}catch{return fail(DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,"asset-authoring.read-override","validation","targetWorkspaceId and overrideId are invalid.",ctx);}});
  registerDerivedCustomizationIpc(d);
}

function registerDerivedCustomizationIpc(d: RegisterAssetAuthoringIpcDependencies): void {
  const resolve = async () => {
    try { return d.derivedCustomizations ?? (await d.getDerivedCustomizations?.()); }
    catch { return undefined; }
  };
  const unavailable = (key: keyof typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS, request: any) => {
    const descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key];
    return fail(descriptor.response, descriptor.operation, "unavailable", "Derived customization is unavailable.", c(request));
  };

  d.ipcMain.handle(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets.request.value, async (_event, request: any) => {
    const service = await resolve();
    if (!service) return unavailable("listTargets", request);
    const workspaceId = request?.payload?.workspaceId;
    if (!txt(workspaceId)) return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.listTargets, "validation", "workspaceId is required.", c(request));
    try {
      const value = await service.listTargets({ ...request.payload, workspaceId: createWorkspaceId(workspaceId) });
      return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets.response, value, c(request));
    } catch {
      return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.listTargets, "validation", "Customization target query is invalid.", c(request));
    }
  });

  d.ipcMain.handle(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.request.value, async (_event, request: any) => {
    const service = await resolve();
    if (!service) return unavailable("readTarget", request);
    const workspaceId = request?.payload?.workspaceId;
    if (!txt(workspaceId)) return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.readTarget, "validation", "workspaceId is required.", c(request));
    try {
      const value = await service.readTarget({ ...request.payload, workspaceId: createWorkspaceId(workspaceId) });
      if (!value) return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.readTarget, "not-found", "Customization target was not found.", c(request));
      return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.response, value, c(request));
    } catch {
      return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.readTarget.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.readTarget, "validation", "Customization target identity is invalid.", c(request));
    }
  });

  d.ipcMain.handle(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.list.request.value, async (_event, request: any) => {
    const service = await resolve();
    if (!service) return unavailable("list", request);
    const workspaceId = request?.payload?.workspaceId;
    if (!txt(workspaceId)) return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.list.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.list, "validation", "workspaceId is required.", c(request));
    try {
      const value = await service.list({ ...request.payload, workspaceId: createWorkspaceId(workspaceId) });
      return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.list.response, { customizations: value.records, nextCursor: value.nextCursor }, c(request));
    } catch {
      return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.list.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.list, "validation", "Customization query is invalid.", c(request));
    }
  });

  d.ipcMain.handle(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read.request.value, async (_event, request: any) => {
    const service = await resolve();
    if (!service) return unavailable("read", request);
    const workspaceId = request?.payload?.workspaceId;
    const customizationId = request?.payload?.customizationId;
    if (!txt(workspaceId) || !txt(customizationId)) return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.read, "validation", "workspaceId and customizationId are required.", c(request));
    try {
      const value = await service.read(createWorkspaceId(workspaceId), normalizeAssetCustomizationId(customizationId));
      if (!value) return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.read, "not-found", "Derived customization was not found.", c(request));
      return createDesktopAssetAuthoringOperationSuccessResponse(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read.response, value, c(request));
    } catch {
      return fail(DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.read.response, ASSET_DERIVED_CUSTOMIZATION_OPERATIONS.read, "validation", "Customization identity is invalid.", c(request));
    }
  });

  const mutation = (key: "create" | "update" | "review" | "publish" | "abandon", execute: (service: AssetDerivedCustomizationApplicationPort, command: any) => Promise<any>) => {
    const descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key];
    d.ipcMain.handle(descriptor.request.value, async (_event, request: any) => {
      const service = await resolve();
      if (!service) return unavailable(key, request);
      const workspaceId = request?.payload?.workspaceId;
      if (!txt(workspaceId)) return fail(descriptor.response, descriptor.operation, "validation", "workspaceId is required.", c(request));
      try {
        const result = await execute(service, { ...request.payload, workspaceId: createWorkspaceId(workspaceId), actorId: "desktop-user" });
        if (result.kind === "failure") return fail(descriptor.response, descriptor.operation, result.failure.code, result.failure.message, c(request));
        return createDesktopAssetAuthoringOperationSuccessResponse(descriptor.response, result.value, c(request));
      } catch {
        return fail(descriptor.response, descriptor.operation, "validation", "Derived customization request is invalid.", c(request));
      }
    });
  };
  mutation("create", (service, command) => service.create(command));
  mutation("update", (service, command) => service.update(command));
  mutation("review", (service, command) => service.review(command));
  mutation("publish", (service, command) => service.publish(command));
  mutation("abandon", (service, command) => service.abandon(command));
}
