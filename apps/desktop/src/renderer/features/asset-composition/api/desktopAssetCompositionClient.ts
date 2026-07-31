export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const err = (message: string, code = "internal"): Result<never> => ({ ok: false, error: { code, message } });
const unwrap = <T,>(r: unknown): Result<T> => { const v = r as any; return v?.ok ? { ok: true, value: v.value as T } : err(v?.error?.message ?? "Unable to complete request.", v?.error?.code ?? "internal"); };
export function createDesktopAssetCompositionClient(){
  const api=((globalThis as any).window?.desktopApi ?? {}) as Record<string, ((x:any)=>Promise<unknown>)|undefined>;
  return {
    createPlan: async (input:{targetWorkspaceId:string; name:string; description?:string}) => typeof api.createAssetCompositionPlan !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.createAssetCompositionPlan(input)),
    updatePlan: async (input:{targetWorkspaceId:string; planId:string; name?:string; description?:string; status?:string}) => typeof api.updateAssetCompositionPlan !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.updateAssetCompositionPlan(input)),
    readPlan: async (input:{targetWorkspaceId:string; planId:string}) => typeof api.readAssetCompositionPlan !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.readAssetCompositionPlan(input)),
    listPlans: async (input:{targetWorkspaceId:string; status?:string; text?:string; limit?:number; cursor?:string}) => typeof api.listAssetCompositionPlans !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.listAssetCompositionPlans(input)),
    addProjectionToPlan: async (input:{targetWorkspaceId:string; planId:string; projectionId:string}) => typeof api.addProjectionToAssetCompositionPlan !== "function" ? err("Adding assets to plans is not available yet.","unavailable") : unwrap(await api.addProjectionToAssetCompositionPlan(input)),
    removeProjectionFromPlan: async (input:{targetWorkspaceId:string; planId:string; projectionId:string}) => typeof api.removeProjectionFromAssetCompositionPlan !== "function" ? err("Removing assets from plans is not available yet.","unavailable") : unwrap(await api.removeProjectionFromAssetCompositionPlan(input)),
    connectNodes: async (input:{targetWorkspaceId:string; planId:string; sourceNodeId:string; kind:string; targetNodeId:string}) => typeof api.connectAssetCompositionNodes !== "function" ? err("Connections are not available yet.","unavailable") : unwrap(await api.connectAssetCompositionNodes(input)),
    disconnectNodes: async (input:{targetWorkspaceId:string; planId:string; relationshipId:string}) => typeof api.disconnectAssetCompositionNodes !== "function" ? err("Removing connections is not available yet.","unavailable") : unwrap(await api.disconnectAssetCompositionNodes(input)),
    validatePlan: async (input:{targetWorkspaceId:string; planId:string}) => typeof api.validateAssetCompositionPlan !== "function" ? err("Plan checking is not available yet.","unavailable") : unwrap(await api.validateAssetCompositionPlan(input)),

    archivePlan: async (input:{targetWorkspaceId:string; planId:string}) => typeof api.archiveAssetCompositionPlan !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.archiveAssetCompositionPlan(input)),
    listPlanSummaries: async (input:{targetWorkspaceId:string}) => typeof api.listAssetCompositionPlanSummaries !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.listAssetCompositionPlanSummaries(input)),
    readPlanDetail: async (input:{targetWorkspaceId:string; planId:string}) => typeof api.readAssetCompositionPlanDetail !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.readAssetCompositionPlanDetail(input)),
    listPlansForProjection: async (input:{targetWorkspaceId:string; projectionId:string}) => typeof api.listCompositionPlansForProjection !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.listCompositionPlansForProjection(input)),
    listPlansForEffectiveAsset: async (input:{targetWorkspaceId:string; effectiveAssetReference:{kind:string;id:string;version?:string}}) => typeof api.listCompositionPlansForEffectiveAsset !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.listCompositionPlansForEffectiveAsset(input)),
    listPlansNeedingAttention: async (input:{targetWorkspaceId:string}) => typeof api.listCompositionPlansNeedingAttention !== "function" ? err("Asset composition is unavailable.","unavailable") : unwrap(await api.listCompositionPlansNeedingAttention(input)),

  };
}
