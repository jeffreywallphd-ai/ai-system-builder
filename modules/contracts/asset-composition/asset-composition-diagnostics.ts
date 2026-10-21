import { isUnsafePassiveText, normalizePassiveMetadata, readStrictPassiveRecord } from "../shared";
import type { AssetMetadata } from "../asset";
import { normalizeAssetCompositionBlockerId, normalizeAssetCompositionDiagnosticId, type AssetCompositionBlockerId, type AssetCompositionDiagnosticId } from "./asset-composition-identity";
export const ASSET_COMPOSITION_DIAGNOSTIC_CODES=["asset-composition-workspace-required","asset-composition-workspace-invalid","asset-composition-plan-name-required","asset-composition-plan-not-found","asset-composition-projection-required","asset-composition-projection-missing","asset-composition-node-selected-projection-missing","asset-composition-node-reference-mismatch","asset-composition-projection-not-ready-for-planning","asset-composition-projection-blocked","asset-composition-projection-conflicted","asset-composition-projection-stale","asset-composition-projection-disabled","asset-composition-node-role-unsupported","asset-composition-relationship-kind-unsupported","asset-composition-relationship-unsupported","asset-composition-relationship-node-missing","asset-composition-missing-dependency","asset-composition-capability-unsupported","asset-composition-plan-runtime-binding-deferred","asset-composition-runtime-readiness-deferred","asset-composition-execution-deferred","asset-composition-source-mutation-forbidden","asset-composition-command-invalid","asset-composition-plan-id-invalid","asset-composition-node-id-invalid","asset-composition-relationship-id-invalid","asset-composition-description-invalid","asset-composition-plan-archived","asset-composition-projection-duplicate","asset-composition-relationship-duplicate","asset-composition-relationship-self","asset-composition-relationship-source-node-missing","asset-composition-relationship-target-node-missing","asset-composition-node-unusable","asset-composition-repository-unavailable"] as const;
export type AssetCompositionDiagnosticCode=(typeof ASSET_COMPOSITION_DIAGNOSTIC_CODES)[number];
export type AssetCompositionDiagnosticSeverity="info"|"warning"|"error";
export interface AssetCompositionDiagnostic{readonly diagnosticId?:AssetCompositionDiagnosticId;readonly code:AssetCompositionDiagnosticCode;readonly severity:AssetCompositionDiagnosticSeverity;readonly message:string;readonly safeDetails?:AssetMetadata;}
export interface AssetCompositionBlocker{readonly blockerId?:AssetCompositionBlockerId;readonly code:AssetCompositionDiagnosticCode;readonly message:string;readonly safeDetails?:AssetMetadata;}
export type AssetCompositionNormalizationResult<T>={status:"success";value:T}|{status:"failure";diagnostics:readonly AssetCompositionDiagnostic[]};

const UNSAFE=/(?:\bhttps?:\/\/|token|secret|api[_-]?key|command|env|provider|payload|path|storage-root|signed-url|base64|workflow|prompt)/i;
const sanitize=(v:string)=>{if(typeof v!=="string") throw new Error("Diagnostic message is invalid."); if(isUnsafePassiveText(v)) return "Sanitized diagnostic detail."; const m=v.trim(); return UNSAFE.test(m)?"Sanitized diagnostic detail.":m.slice(0,240)||"Sanitized diagnostic detail.";};
const safeMeta=(v?:AssetMetadata)=>{
 const safe=normalizePassiveMetadata(v,{allowArrays:true}) as AssetMetadata | undefined;
 const check=(entry:unknown):void=>{if(typeof entry === "string" && UNSAFE.test(entry)) throw new Error("Safe details are invalid."); if(entry && typeof entry === "object") for(const [key,value] of Object.entries(entry)){if(UNSAFE.test(key)) throw new Error("Safe details are invalid."); check(value);}};
 if(safe) check(safe);
 return safe;
};
const normalizeCode=(code:string):AssetCompositionDiagnosticCode=>{if(typeof code!=="string") throw new Error("Diagnostic code is invalid."); const c=code.trim() as AssetCompositionDiagnosticCode; if(!ASSET_COMPOSITION_DIAGNOSTIC_CODES.includes(c)) throw new Error("Asset composition diagnostic code is invalid."); return c;};
const normalizeSeverity=(severity:string):AssetCompositionDiagnosticSeverity=>{if(typeof severity!=="string") throw new Error("Diagnostic severity is invalid."); const s=severity.trim().toLowerCase() as AssetCompositionDiagnosticSeverity; if(!["info","warning","error"].includes(s)) throw new Error("Asset composition diagnostic severity is invalid."); return s;};

export const normalizeAssetCompositionDiagnostic=(value:AssetCompositionDiagnostic):AssetCompositionDiagnostic=>{
 const d=readStrictPassiveRecord(value,["diagnosticId","code","severity","message","safeDetails"]);
 if(d.diagnosticId !== undefined && typeof d.diagnosticId !== "string") throw new Error("Diagnostic identity is invalid.");
 return {...(d.diagnosticId !== undefined ? {diagnosticId:normalizeAssetCompositionDiagnosticId(d.diagnosticId as string)} : {}),code:normalizeCode(d.code as string),severity:normalizeSeverity(d.severity as string),message:sanitize(d.message as string),...(d.safeDetails !== undefined ? {safeDetails:safeMeta(d.safeDetails as AssetMetadata)} : {})};
};
export const normalizeAssetCompositionBlocker=(value:AssetCompositionBlocker):AssetCompositionBlocker=>{
 const b=readStrictPassiveRecord(value,["blockerId","code","message","safeDetails"]);
 if(b.blockerId !== undefined && typeof b.blockerId !== "string") throw new Error("Blocker identity is invalid.");
 return {...(b.blockerId !== undefined ? {blockerId:normalizeAssetCompositionBlockerId(b.blockerId as string)} : {}),code:normalizeCode(b.code as string),message:sanitize(b.message as string),...(b.safeDetails !== undefined ? {safeDetails:safeMeta(b.safeDetails as AssetMetadata)} : {})};
};
const tryN=<T>(fn:()=>T):AssetCompositionNormalizationResult<T>=>{try{return{status:"success",value:fn()};}catch{return{status:"failure",diagnostics:[{code:"asset-composition-workspace-invalid",severity:"error",message:"Sanitized normalization failure."}]};}};
export const tryNormalizeAssetCompositionDiagnostic=(d:AssetCompositionDiagnostic)=>tryN(()=>normalizeAssetCompositionDiagnostic(d));
export const tryNormalizeAssetCompositionBlocker=(b:AssetCompositionBlocker)=>tryN(()=>normalizeAssetCompositionBlocker(b));
