export const ASSET_COMPOSITION_NODE_ROLES=["input","data-source","processor","model","prompt-template","configuration","output","ui-surface","runtime-capability-placeholder","supporting-asset"] as const;
export type AssetCompositionNodeRole=(typeof ASSET_COMPOSITION_NODE_ROLES)[number];
const norm=(v:string)=>v.trim().toLowerCase();
export const isAssetCompositionNodeRole=(v:unknown):v is AssetCompositionNodeRole=>typeof v==="string"&&ASSET_COMPOSITION_NODE_ROLES.includes(norm(v) as AssetCompositionNodeRole);
export function normalizeAssetCompositionNodeRole(v:string):AssetCompositionNodeRole{const n=norm(v) as AssetCompositionNodeRole; if(!ASSET_COMPOSITION_NODE_ROLES.includes(n)) throw new Error("Asset composition node role is invalid."); return n;}
