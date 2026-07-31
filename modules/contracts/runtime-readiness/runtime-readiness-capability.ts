export const RUNTIME_CAPABILITY_KINDS=["local-runtime","remote-runtime","model-provider","model","image-generation-runtime","text-generation-runtime","embedding-runtime","storage-provider","artifact-storage","workspace-storage","file-access","network-access","api-service","credential-reference","gpu-capability","cpu-capability","memory-capability","python-runtime","node-runtime","comfyui-runtime","database","queue","scheduler"] as const;
export const RUNTIME_PROVIDER_KINDS=["local","remote","desktop-host","server-host","python","node","comfyui","model-provider","storage-provider","database","api-service","manual"] as const;
export type RuntimeCapabilityKind=(typeof RUNTIME_CAPABILITY_KINDS)[number];
export type RuntimeProviderKind=(typeof RUNTIME_PROVIDER_KINDS)[number];
const n=(v:string)=>v.trim().toLowerCase();
export const isRuntimeCapabilityKind=(v:unknown):v is RuntimeCapabilityKind=>typeof v==="string"&&RUNTIME_CAPABILITY_KINDS.includes(n(v) as RuntimeCapabilityKind);
export const isRuntimeProviderKind=(v:unknown):v is RuntimeProviderKind=>typeof v==="string"&&RUNTIME_PROVIDER_KINDS.includes(n(v) as RuntimeProviderKind);
export function normalizeRuntimeCapabilityKind(v:string):RuntimeCapabilityKind{const x=n(v) as RuntimeCapabilityKind; if(!RUNTIME_CAPABILITY_KINDS.includes(x)) throw new Error("Runtime capability kind is invalid."); return x;}
export function normalizeRuntimeProviderKind(v:string):RuntimeProviderKind{const x=n(v) as RuntimeProviderKind; if(!RUNTIME_PROVIDER_KINDS.includes(x)) throw new Error("Runtime provider kind is invalid."); return x;}
