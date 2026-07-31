import type { RuntimeCapabilityId } from "../runtime";
import type { AssetConfigurationMetadata } from "./asset-configuration-value";
import type { AssetReference } from "./asset-reference";
import type { AssetFamily } from "./asset-family";
import type { AssetType } from "./asset-type";

export const ASSET_PORT_CONTRACT_KINDS = [
  "asset",
  "asset-instance",
  "asset-definition",
  "resource",
  "artifact",
  "external-repository-object",
  "configuration",
  "runtime-capability",
  "event",
  "control",
  "json",
  "text",
  "binary-reference",
  "custom",
] as const;

export type AssetPortContractKind = (typeof ASSET_PORT_CONTRACT_KINDS)[number];

export interface AssetPortContract {
  readonly contractId?: string;
  readonly contractKind: AssetPortContractKind;
  readonly dataKind?: string;
  readonly assetType?: AssetType;
  readonly assetFamily?: AssetFamily;
  readonly resourceKind?: string;
  readonly runtimeCapabilityId?: RuntimeCapabilityId;
  readonly schemaRef?: AssetReference;
  readonly description?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetPortContractKind(
  value: string,
): value is AssetPortContractKind {
  return ASSET_PORT_CONTRACT_KINDS.includes(value as AssetPortContractKind);
}

export function normalizeAssetPortContractKind(
  value: string,
): AssetPortContractKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetPortContractKind(normalized)) {
    throw new Error(
      `Asset port contract kind must be one of ${ASSET_PORT_CONTRACT_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
