import type { AssetConfigurationMetadata } from "./asset-configuration-value";
import type { AssetPortCardinality } from "./asset-port-cardinality";
import type { AssetPortContract } from "./asset-port-contract";
import type { AssetPortDirection } from "./asset-port-direction";

export interface AssetPort {
  readonly portId: string;
  readonly direction: AssetPortDirection;
  readonly displayName?: string;
  readonly description?: string;
  readonly contract?: AssetPortContract;
  readonly cardinality?: AssetPortCardinality;
  readonly metadata?: AssetConfigurationMetadata;
}
