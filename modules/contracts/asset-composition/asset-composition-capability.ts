import type { AssetMetadata } from "../asset";
export const ASSET_COMPOSITION_CAPABILITY_KINDS=["data-input","data-output","model","configuration","prompt-template","image-input","image-output","text-input","text-output","runtime-capability","ui-surface","storage-capability"] as const;
export type AssetCompositionCapabilityKind=(typeof ASSET_COMPOSITION_CAPABILITY_KINDS)[number];
export type AssetCompositionCapabilityDirection="required"|"provided";
export interface AssetCompositionCapability{readonly kind:AssetCompositionCapabilityKind;readonly key:string;readonly label?:string;readonly direction?:AssetCompositionCapabilityDirection;readonly safeMetadata?:AssetMetadata;}
const UNSAFE=/(?:command|env|provider|payload|token|secret|base64|workflow|prompt|path|storage-root|signed-url)/i;
const isSafeText=(v:string)=>{const t=v.trim(); return t.length>0 && t===v && t.length<120 && !UNSAFE.test(t);};
const norm=(v:string)=>v.trim().toLowerCase();
export const isAssetCompositionCapabilityKind=(v:unknown):v is AssetCompositionCapabilityKind=>typeof v==="string"&&ASSET_COMPOSITION_CAPABILITY_KINDS.includes(norm(v) as AssetCompositionCapabilityKind);
export function normalizeAssetCompositionCapabilityKind(v:string):AssetCompositionCapabilityKind{const n=norm(v) as AssetCompositionCapabilityKind; if(!ASSET_COMPOSITION_CAPABILITY_KINDS.includes(n)) throw new Error("Asset composition capability kind is invalid."); return n;}
export function normalizeAssetCompositionCapability(v:AssetCompositionCapability):AssetCompositionCapability{ if(!isSafeText(v.key)|| (v.label && !isSafeText(v.label))) throw new Error("Asset composition capability fields are invalid."); const check=(m:AssetMetadata)=>{ for(const [k,val] of Object.entries(m)){ if(!isSafeText(k)|| (typeof val==="string" && UNSAFE.test(val))) throw new Error("Asset composition capability metadata is invalid."); if(val&&typeof val==="object") check(val as AssetMetadata); }}; if(v.safeMetadata) check(v.safeMetadata); return {...v, kind: normalizeAssetCompositionCapabilityKind(v.kind)};}
export const normalizeAssetCompositionCapabilityList=(v:readonly AssetCompositionCapability[])=>v.map(normalizeAssetCompositionCapability);


export const tryNormalizeAssetCompositionCapability=(v:AssetCompositionCapability)=>{try{return{status:"success" as const,value:normalizeAssetCompositionCapability(v)};}catch{return{status:"failure" as const,diagnostics:[{code:"asset-composition-capability-unsupported",severity:"error",message:"Sanitized normalization failure."}]};}};
