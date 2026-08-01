import type {
  DatasetReviewDatasetGroup,
  DatasetReviewRowEditResult,
  DatasetReviewPage,
  DatasetReviewRowRejectionResult,
} from "../dataset";
import { createTransportOperation } from "../transport";
import type { ApiResponse } from "./api-response";

export const API_DATASET_REVIEW_TARGETS_OPERATION = createTransportOperation(
  "dataset-review",
  "targets",
);
export const API_DATASET_REVIEW_PAGE_OPERATION = createTransportOperation(
  "dataset-review",
  "page",
);
export const API_DATASET_REVIEW_REJECT_OPERATION = createTransportOperation(
  "dataset-review",
  "reject",
);
export const API_DATASET_REVIEW_EDIT_OPERATION = createTransportOperation(
  "dataset-review",
  "edit",
);

export type ApiDatasetReviewTargetsResponse = ApiResponse<
  { groups: readonly DatasetReviewDatasetGroup[] },
  Record<string, unknown>,
  typeof API_DATASET_REVIEW_TARGETS_OPERATION
>;
export type ApiDatasetReviewPageResponse = ApiResponse<
  { page: DatasetReviewPage },
  Record<string, unknown>,
  typeof API_DATASET_REVIEW_PAGE_OPERATION
>;
export type ApiDatasetReviewRejectResponse = ApiResponse<
  DatasetReviewRowRejectionResult,
  Record<string, unknown>,
  typeof API_DATASET_REVIEW_REJECT_OPERATION
>;
export type ApiDatasetReviewEditResponse = ApiResponse<
  DatasetReviewRowEditResult,
  Record<string, unknown>,
  typeof API_DATASET_REVIEW_EDIT_OPERATION
>;
