import type { AssetPackId, AssetPackVersion } from "../../../contracts/asset";
import type {
  WorkspaceActorReference,
  WorkspaceId,
  WorkspaceSystemPackActivation,
} from "../../../contracts/workspace";
import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_DISPLAY_NAME,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "../../services/asset-packs/system-packs/system-foundation-pack.constants";

export interface KnownWorkspaceSystemPackReference {
  readonly packId: AssetPackId;
  readonly packVersion: AssetPackVersion;
  readonly displayName?: string;
  readonly sourceKind: "system";
  readonly sourceLayer: "system-default";
  readonly trustStatus: "system-trusted";
}

export const KNOWN_WORKSPACE_SYSTEM_PACK_REFERENCES: readonly KnownWorkspaceSystemPackReference[] =
  [SYSTEM_FOUNDATION_PACK_VERSION, SYSTEM_FOUNDATION_CURRENT_PACK_VERSION].map(
    (packVersion) =>
      ({
        packId: SYSTEM_FOUNDATION_PACK_ID,
        packVersion,
        displayName: SYSTEM_FOUNDATION_PACK_DISPLAY_NAME,
        sourceKind: SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
        sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
        trustStatus: SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
      }) as KnownWorkspaceSystemPackReference,
  );

export function buildSystemFoundationActivationId(
  workspaceId: WorkspaceId,
): string {
  return `activation.system-foundation.${workspaceId}`;
}

export function getKnownSystemPackReference(
  packId: AssetPackId,
  packVersion: AssetPackVersion,
): KnownWorkspaceSystemPackReference | undefined {
  return KNOWN_WORKSPACE_SYSTEM_PACK_REFERENCES.find(
    (reference) =>
      reference.packId === packId && reference.packVersion === packVersion,
  );
}

export function hasValidKnownSystemPackActivationProvenance(
  activation: WorkspaceSystemPackActivation,
): boolean {
  return (
    activation.sourceKind === "system" &&
    activation.sourceLayer === "system-default" &&
    activation.trustStatus === "system-trusted"
  );
}

export function isKnownSystemPackActivation(
  activation: WorkspaceSystemPackActivation,
): boolean {
  return Boolean(
    getKnownSystemPackReference(activation.packId, activation.packVersion),
  );
}

export function isValidKnownSystemPackActivation(
  activation: WorkspaceSystemPackActivation,
): boolean {
  return (
    isKnownSystemPackActivation(activation) &&
    hasValidKnownSystemPackActivationProvenance(activation)
  );
}

export function createSystemFoundationWorkspaceActivation(
  workspaceId: WorkspaceId,
  activatedAt: string,
  activatedByActorRef?: WorkspaceActorReference,
  packVersion: AssetPackVersion = SYSTEM_FOUNDATION_PACK_VERSION,
): WorkspaceSystemPackActivation {
  return {
    activationId: buildSystemFoundationActivationId(workspaceId),
    workspaceId,
    packId: SYSTEM_FOUNDATION_PACK_ID,
    packVersion,
    sourceKind: "system",
    sourceLayer: "system-default",
    trustStatus: "system-trusted",
    status: "active",
    activatedAt,
    ...(activatedByActorRef ? { activatedByActorRef } : {}),
  };
}
