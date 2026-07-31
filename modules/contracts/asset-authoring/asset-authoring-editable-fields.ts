export const SAFE_ASSET_EDITABLE_FIELDS=["display-name","summary","description","tags","classification","safe-metadata"] as const;
export type SafeAssetEditableField=(typeof SAFE_ASSET_EDITABLE_FIELDS)[number];

export type SafeAssetMetadataPrimitive = string | number | boolean | null;
export type SafeAssetMetadataValue = SafeAssetMetadataPrimitive | readonly SafeAssetMetadataValue[] | { readonly [key: string]: SafeAssetMetadataValue };
export type SafeAssetEditableValue = string | readonly string[] | SafeAssetMetadataValue;
export type SafeAssetEditableFieldPatch = Partial<Record<SafeAssetEditableField, SafeAssetEditableValue>>;

const UNSAFE_KEY_PATTERN = /(?:raw)?path|storageRoot|storage-root|bytes?|blob|base64|providerPayload|provider-payload|prompt|workflowJson|workflow-json|token|secret|apiKey|api-key|stack|command|environment|\benv\b/i;
const UNSAFE_STRING_PATTERN = /(?:^\/|^[a-z]:\\|https?:\/\/|signed|signature=|-----BEGIN |sk-[a-zA-Z0-9]|github_pat_|gh[pousr]_|xox[baprs]-|base64|providerPayload|workflowJson|storageRoot|apiKey)/i;

export const isSafeAssetEditableField=(v:unknown):v is SafeAssetEditableField=> typeof v==="string" && SAFE_ASSET_EDITABLE_FIELDS.includes(v as SafeAssetEditableField);
export function normalizeSafeAssetEditableField(v:string):SafeAssetEditableField{ if(!isSafeAssetEditableField(v)){const e=new Error("Editable field is unsupported."); e.stack=undefined; throw e;} return v; }
export function assertSafeAssetEditableField(v:string): asserts v is SafeAssetEditableField { normalizeSafeAssetEditableField(v); }

function assertSafeMetadataValue(value: unknown): asserts value is SafeAssetMetadataValue {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Editable safe-metadata value is invalid."); return; }
  if (typeof value === "string") { if (value.trim() !== value || value.length === 0 || UNSAFE_STRING_PATTERN.test(value)) throw new Error("Editable safe-metadata value is invalid."); return; }
  if (Array.isArray(value)) { value.forEach(assertSafeMetadataValue); return; }
  if (!value || typeof value !== "object") throw new Error("Editable safe-metadata value is invalid.");
  for (const [k,v] of Object.entries(value as Record<string, unknown>)) {
    if (UNSAFE_KEY_PATTERN.test(k)) throw new Error("Editable safe-metadata value is invalid.");
    assertSafeMetadataValue(v);
  }
}

export function normalizeSafeAssetEditableFieldPatch(patch:SafeAssetEditableFieldPatch):SafeAssetEditableFieldPatch{ const out:SafeAssetEditableFieldPatch={};
  for (const [k,val] of Object.entries(patch)) { const field=normalizeSafeAssetEditableField(k); if (typeof val === "string") { const n=val.trim(); if(!n||n!==val||UNSAFE_STRING_PATTERN.test(n)){throw new Error("Editable string value is invalid.");} out[field]=n; continue;} if(Array.isArray(val)){ if(!val.every((x)=>typeof x==="string"&&x.trim().length>0&&x===x.trim()&&!UNSAFE_STRING_PATTERN.test(x))) throw new Error("Editable string-list value is invalid."); out[field]=val; continue;} if(field==="safe-metadata"){ assertSafeMetadataValue(val); out[field]=val; continue;} throw new Error("Editable value is invalid."); }
  return out;
}
