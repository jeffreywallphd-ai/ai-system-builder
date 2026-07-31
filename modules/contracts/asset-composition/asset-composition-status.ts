export const ASSET_COMPOSITION_PLAN_STATUSES = ["draft","valid","blocked","conflicted","stale","unsupported","invalid","archived"] as const;
export const ASSET_COMPOSITION_NODE_STATUSES = ["planned","ready-for-planning","blocked","conflicted","missing-projection","stale-projection","unsupported","invalid","disabled"] as const;
export const ASSET_COMPOSITION_COMPATIBILITY_STATUSES = ["compatible","blocked","conflicted","missing-dependency","unsupported","stale","invalid","unknown"] as const;
export type AssetCompositionPlanStatus = (typeof ASSET_COMPOSITION_PLAN_STATUSES)[number];
export type AssetCompositionNodeStatus = (typeof ASSET_COMPOSITION_NODE_STATUSES)[number];
export type AssetCompositionCompatibilityStatus = (typeof ASSET_COMPOSITION_COMPATIBILITY_STATUSES)[number];
const norm=(v:string)=>v.trim().toLowerCase();
export const isAssetCompositionPlanStatus=(v:unknown):v is AssetCompositionPlanStatus=>typeof v==="string"&&ASSET_COMPOSITION_PLAN_STATUSES.includes(norm(v) as AssetCompositionPlanStatus);
export const isAssetCompositionNodeStatus=(v:unknown):v is AssetCompositionNodeStatus=>typeof v==="string"&&ASSET_COMPOSITION_NODE_STATUSES.includes(norm(v) as AssetCompositionNodeStatus);
export const isAssetCompositionCompatibilityStatus=(v:unknown):v is AssetCompositionCompatibilityStatus=>typeof v==="string"&&ASSET_COMPOSITION_COMPATIBILITY_STATUSES.includes(norm(v) as AssetCompositionCompatibilityStatus);
export function normalizeAssetCompositionPlanStatus(v:string):AssetCompositionPlanStatus{const n=norm(v) as AssetCompositionPlanStatus; if(!ASSET_COMPOSITION_PLAN_STATUSES.includes(n)) throw new Error("Asset composition plan status is invalid."); return n;}
export function normalizeAssetCompositionNodeStatus(v:string):AssetCompositionNodeStatus{const n=norm(v) as AssetCompositionNodeStatus; if(!ASSET_COMPOSITION_NODE_STATUSES.includes(n)) throw new Error("Asset composition node status is invalid."); return n;}
export function normalizeAssetCompositionCompatibilityStatus(v:string):AssetCompositionCompatibilityStatus{const n=norm(v) as AssetCompositionCompatibilityStatus; if(!ASSET_COMPOSITION_COMPATIBILITY_STATUSES.includes(n)) throw new Error("Asset composition compatibility status is invalid."); return n;}
