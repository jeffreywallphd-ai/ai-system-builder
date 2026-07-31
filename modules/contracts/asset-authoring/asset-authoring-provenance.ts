import { createWorkspaceId } from "../workspace";
import type { AssetAuthoringProvenance } from "./asset-authoring-models";

const PROVENANCE_KINDS = new Set<AssetAuthoringProvenance["kind"]>([
  "authored-from-scratch","derived-from-workspace-local-asset","customized-linked-user-library-asset","customized-detached-user-library-copy","customized-workspace-import","system-derived-override","edited-authored-asset","revised-authored-asset",
]);

const t=(v:unknown,l:string)=>{if(typeof v!=="string"||v.trim().length===0||v!==v.trim()) throw new Error(`${l} is invalid.`); return v;};

export function normalizeAssetAuthoringProvenance(v: AssetAuthoringProvenance): AssetAuthoringProvenance {
  if (!PROVENANCE_KINDS.has(v.kind)) throw new Error("Asset authoring provenance kind is invalid.");
  if (v.kind === "system-derived-override" && !v.targetWorkspaceId) {
    throw new Error("System-derived override provenance requires target workspace id.");
  }
  return {
    ...v,
    targetWorkspaceId: v.targetWorkspaceId ? createWorkspaceId(v.targetWorkspaceId) : undefined,
    sourceWorkspaceId: v.sourceWorkspaceId ? createWorkspaceId(v.sourceWorkspaceId) : undefined,
    operationAt: t(v.operationAt, "Provenance operation timestamp"),
  };
}
