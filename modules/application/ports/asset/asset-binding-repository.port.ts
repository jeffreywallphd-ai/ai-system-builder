import type {
  AssetBinding,
  AssetBindingKind,
  AssetLifecycleStatus,
  AssetReference,
} from "../../../contracts/asset";

export interface AssetBindingListQuery {
  readonly bindingKind?: AssetBindingKind;
  readonly sourceRef?: AssetReference;
  readonly targetRef?: AssetReference;
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AssetBindingListResult {
  readonly bindings: readonly AssetBinding[];
  readonly nextCursor?: string;
}

export interface AssetBindingRepositoryPort {
  saveBinding(binding: AssetBinding): Promise<AssetBinding>;
  getBinding(reference: AssetReference): Promise<AssetBinding | undefined>;
  listBindings(query?: AssetBindingListQuery): Promise<AssetBindingListResult>;
  deleteBinding?(reference: AssetReference): Promise<void>;
}
