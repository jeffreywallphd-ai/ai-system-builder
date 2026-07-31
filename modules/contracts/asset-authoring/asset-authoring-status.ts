export const ASSET_AUTHORING_STATUSES=["draft","published","archived","disabled","invalid","conflicted"] as const;
export const ASSET_OVERRIDE_STATUSES=["active","draft","disabled","archived","conflicted","invalid"] as const;
export type AssetAuthoringStatus=(typeof ASSET_AUTHORING_STATUSES)[number];
export type AssetOverrideStatus=(typeof ASSET_OVERRIDE_STATUSES)[number];
export const isAssetAuthoringStatus=(v:unknown):v is AssetAuthoringStatus=> typeof v==="string" && ASSET_AUTHORING_STATUSES.includes(v as AssetAuthoringStatus);
export const isAssetOverrideStatus=(v:unknown):v is AssetOverrideStatus=> typeof v==="string" && ASSET_OVERRIDE_STATUSES.includes(v as AssetOverrideStatus);
export function normalizeAssetAuthoringStatus(v:string):AssetAuthoringStatus{ if(!isAssetAuthoringStatus(v)){const e=new Error("Asset authoring status is invalid."); e.stack=undefined; throw e;} return v;}
export function normalizeAssetOverrideStatus(v:string):AssetOverrideStatus{ if(!isAssetOverrideStatus(v)){const e=new Error("Asset override status is invalid."); e.stack=undefined; throw e;} return v;}
