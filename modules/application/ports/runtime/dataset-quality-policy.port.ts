import type {
  DatasetQualityEffectivePolicy,
  DatasetQualityPolicyResolutionRequest,
} from "../../../contracts/runtime";

export interface DatasetQualityPolicyProviderPort {
  resolveDatasetQualityPolicy(
    request: DatasetQualityPolicyResolutionRequest,
  ): Promise<DatasetQualityEffectivePolicy>;
}
