export type AuthoredAssetId = string & { readonly __authoredAssetIdBrand: unique symbol };
export type AssetDraftId = string & { readonly __assetDraftIdBrand: unique symbol };
export type AssetRevisionId = string & { readonly __assetRevisionIdBrand: unique symbol };
export type AssetOverrideId = string & { readonly __assetOverrideIdBrand: unique symbol };
export type AssetCustomizationId = string & { readonly __assetCustomizationIdBrand: unique symbol };
const P=/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/; const U=/^[a-z][a-z0-9+.-]*:\/\//i; const D=/^[a-zA-Z]:/; const C=/[\u0000-\u001f\u007f]/; const S=/[;&|`$<>*?()[\]{}'"!#~]/; const T=/^(?:gh[pousr]_|github_pat_|sk-[a-zA-Z0-9]|xox[baprs]-|secret[_-]?|token[_-]?|api[_-]?key)/i;
function isSafe(v: unknown): v is string { if(typeof v!=="string") return false; const n=v.trim(); return n.length>0 && n===v && n.length<=96 && P.test(n) && !["/","\\",".."].some((m)=>n.includes(m)) && !n.startsWith(".") && !U.test(n) && !D.test(n) && !C.test(n) && !S.test(n) && !T.test(n);} 
function normalize(v:string,k:string){const n=v.trim(); if(!isSafe(n)){const e=new Error(`${k} must be a safe non-empty trimmed identifier.`); e.stack=undefined; throw e;} return n;}
export function isAuthoredAssetId(v: unknown): v is AuthoredAssetId { return isSafe(v); }
export const normalizeAuthoredAssetId=(v:string)=>normalize(v,"Authored asset id") as AuthoredAssetId;
export const normalizeAssetDraftId=(v:string)=>normalize(v,"Asset draft id") as AssetDraftId;
export const normalizeAssetRevisionId=(v:string)=>normalize(v,"Asset revision id") as AssetRevisionId;
export const normalizeAssetOverrideId=(v:string)=>normalize(v,"Asset override id") as AssetOverrideId;
export const normalizeAssetCustomizationId=(v:string)=>normalize(v,"Asset customization id") as AssetCustomizationId;
