export const ASSET_COMPOSITION_RELATIONSHIP_KINDS=["depends-on","feeds-into","configures","uses-model","uses-data","produces-output","requires-capability","supports"] as const;
export type AssetCompositionRelationshipKind=(typeof ASSET_COMPOSITION_RELATIONSHIP_KINDS)[number];
const norm=(v:string)=>v.trim().toLowerCase();
export const isAssetCompositionRelationshipKind=(v:unknown):v is AssetCompositionRelationshipKind=>typeof v==="string"&&ASSET_COMPOSITION_RELATIONSHIP_KINDS.includes(norm(v) as AssetCompositionRelationshipKind);
export function normalizeAssetCompositionRelationshipKind(v:string):AssetCompositionRelationshipKind{const n=norm(v) as AssetCompositionRelationshipKind; if(!ASSET_COMPOSITION_RELATIONSHIP_KINDS.includes(n)) throw new Error("Asset composition relationship kind is invalid."); return n;}
