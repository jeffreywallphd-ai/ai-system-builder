import type {
  DatasetPreparationSummary,
  DatasetPreparationWarning,
  DatasetQualityApprovalRequest,
  DatasetQualityReport,
  DatasetQualityRequestedConfig,
  PrepareTrainingDatasetRequest,
} from "../runtime";
import { createTransportOperation } from "../transport";
import type { ApiResponse } from "./api-response";

export const API_DATASET_PREPARATION_START_OPERATION = createTransportOperation(
  "dataset-preparation",
  "start",
);
export const API_DATASET_PREPARATION_READ_OPERATION = createTransportOperation(
  "dataset-preparation",
  "read",
);
export const API_DATASET_PREPARATION_CANCEL_OPERATION =
  createTransportOperation("dataset-preparation", "cancel");
export const API_DATASET_PREPARATION_APPROVE_OPERATION =
  createTransportOperation("dataset-preparation", "approve");

export interface ApiDatasetPreparationCommand {
  sourceArtifactIds: string[];
  recipe: PrepareTrainingDatasetRequest["recipe"];
  split: PrepareTrainingDatasetRequest["split"];
  output: PrepareTrainingDatasetRequest["output"];
  quality?: DatasetQualityRequestedConfig;
}

export interface ApiDatasetPreparationStartValue {
  requestId: string;
  taskType: string;
  accepted: true;
  status: "queued" | "running";
}

export interface ApiDatasetPreparationStoredOutput {
  sourceKind: string;
  storage: {
    key: string;
    mediaType?: string;
    sizeBytes?: number;
    metadata?: Record<string, unknown>;
  };
}

export interface ApiDatasetPreparationRemoteOutput {
  provider: "huggingface";
  repository: string;
  path: string;
  revision?: string;
  exists: boolean;
  verifiedAt: string;
}

export interface ApiPreparedTrainingDatasetResult {
  outputs: {
    local?: {
      dataset?: ApiDatasetPreparationStoredOutput;
      train?: ApiDatasetPreparationStoredOutput;
      validation?: ApiDatasetPreparationStoredOutput;
      test?: ApiDatasetPreparationStoredOutput;
      report?: ApiDatasetPreparationStoredOutput;
      quarantine?: ApiDatasetPreparationStoredOutput;
    };
    huggingFace?: {
      dataset?: ApiDatasetPreparationRemoteOutput;
      train?: ApiDatasetPreparationRemoteOutput;
      validation?: ApiDatasetPreparationRemoteOutput;
      test?: ApiDatasetPreparationRemoteOutput;
    };
  };
  provenance: Record<string, unknown>;
  summary: DatasetPreparationSummary;
  qualityReport?: DatasetQualityReport;
  review?: {
    state: "review-required" | "approved";
    reportFingerprint: string;
    approvalAllowed: boolean;
  };
  warnings?: DatasetPreparationWarning[];
  datasetVersion?: {
    versionId: string;
    datasetId: string;
    versionDigest: string;
    createdAt: string;
  };
}

export type ApiDatasetPreparationTaskReadValue =
  | {
      requestId: string;
      status: "queued" | "running";
      progress?: {
        message?: string;
        processed?: number;
        total?: number;
      };
    }
  | {
      requestId: string;
      status: "succeeded" | "review-required";
      result: ApiPreparedTrainingDatasetResult;
    }
  | {
      requestId: string;
      status: "failed";
      error: {
        code?: string;
        message: string;
      };
    }
  | {
      requestId: string;
      status: "cancelled" | "unknown";
      message?: string;
    };

export interface ApiDatasetPreparationCancelValue {
  requestId: string;
  cancelled: boolean;
  status: "cancelled" | "running" | "unknown";
}

export interface ApiDatasetPreparationApproveValue {
  requestId: string;
  taskType: "prepare-training-dataset";
  status: "succeeded";
  result: ApiPreparedTrainingDatasetResult;
}

export interface ApiDatasetPreparationApproveCommand
  extends DatasetQualityApprovalRequest {
  workspaceId: string;
}

export type ApiDatasetPreparationStartResponse = ApiResponse<
  ApiDatasetPreparationStartValue,
  Record<string, unknown>,
  typeof API_DATASET_PREPARATION_START_OPERATION
>;

export type ApiDatasetPreparationReadResponse = ApiResponse<
  ApiDatasetPreparationTaskReadValue,
  Record<string, unknown>,
  typeof API_DATASET_PREPARATION_READ_OPERATION
>;

export type ApiDatasetPreparationCancelResponse = ApiResponse<
  ApiDatasetPreparationCancelValue,
  Record<string, unknown>,
  typeof API_DATASET_PREPARATION_CANCEL_OPERATION
>;

export type ApiDatasetPreparationApproveResponse = ApiResponse<
  ApiDatasetPreparationApproveValue,
  Record<string, unknown>,
  typeof API_DATASET_PREPARATION_APPROVE_OPERATION
>;
