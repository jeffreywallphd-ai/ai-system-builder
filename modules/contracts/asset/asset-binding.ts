import type { AssetMetadata } from "./asset-metadata";
import type { AssetBindingConstraint } from "./asset-binding-constraint";
import type { AssetId } from "./asset-id";
import type { AssetLifecycleStatus } from "./asset-lifecycle-status";
import type { AssetProvenance } from "./asset-provenance";
import type { AssetReference } from "./asset-reference";

export const ASSET_BINDING_KINDS = [
  "input",
  "output",
  "event",
  "control",
  "resource",
  "runtime",
  "adapter",
  "dependency",
] as const;

export type AssetBindingKind = (typeof ASSET_BINDING_KINDS)[number];

export interface AssetBinding {
  readonly bindingId: AssetId | string;
  readonly bindingKind: AssetBindingKind;
  readonly sourceRef: AssetReference;
  readonly targetRef: AssetReference;
  readonly sourcePortRef?: AssetReference;
  readonly targetPortRef?: AssetReference;
  readonly constraints?: readonly AssetBindingConstraint[];
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly provenance?: AssetProvenance;
  readonly metadata?: AssetMetadata;
}

export function isAssetBindingKind(value: string): value is AssetBindingKind {
  return ASSET_BINDING_KINDS.includes(value as AssetBindingKind);
}

export function normalizeAssetBindingKind(value: string): AssetBindingKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetBindingKind(normalized)) {
    throw new Error(
      `Asset binding kind must be one of ${ASSET_BINDING_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
