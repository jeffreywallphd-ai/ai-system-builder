import type {
  DatasetPublicationVisibility,
  DatasetVersionComparison,
  DatasetVersionPublicationRecord,
  DatasetVersionRecord,
  DatasetVersionReproduction,
} from "../dataset";
import { createTransportOperation } from "../transport";
import type { ApiResponse } from "./api-response";

export const API_DATASET_VERSION_LIST_OPERATION = createTransportOperation("dataset-version", "list");
export const API_DATASET_VERSION_COMPARE_OPERATION = createTransportOperation("dataset-version", "compare");
export const API_DATASET_VERSION_REPRODUCE_OPERATION = createTransportOperation("dataset-version", "reproduce");
export const API_DATASET_VERSION_PUBLISH_OPERATION = createTransportOperation("dataset-version", "publish");

export interface ApiDatasetVersionListValue { versions: readonly DatasetVersionRecord[]; }
export interface ApiDatasetVersionCompareValue { comparison: DatasetVersionComparison; }
export interface ApiDatasetVersionReproduceValue { reproduction: DatasetVersionReproduction; }
export interface ApiDatasetVersionPublishCommand {
  workspaceId: string;
  repositoryId: string;
  visibility: Exclude<DatasetPublicationVisibility, "protected">;
  createRepository?: boolean;
  publicAccessConfirmed?: true;
}
export interface ApiDatasetVersionPublishValue { publication: DatasetVersionPublicationRecord; }

export type ApiDatasetVersionListResponse = ApiResponse<ApiDatasetVersionListValue, Record<string, unknown>, typeof API_DATASET_VERSION_LIST_OPERATION>;
export type ApiDatasetVersionCompareResponse = ApiResponse<ApiDatasetVersionCompareValue, Record<string, unknown>, typeof API_DATASET_VERSION_COMPARE_OPERATION>;
export type ApiDatasetVersionReproduceResponse = ApiResponse<ApiDatasetVersionReproduceValue, Record<string, unknown>, typeof API_DATASET_VERSION_REPRODUCE_OPERATION>;
export type ApiDatasetVersionPublishResponse = ApiResponse<ApiDatasetVersionPublishValue, Record<string, unknown>, typeof API_DATASET_VERSION_PUBLISH_OPERATION>;
