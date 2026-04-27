import type { StagedArtifactDescriptor } from "../ingestion";
import type {
  DatasetPreparationSummary,
  DatasetPreparationWarning,
  PrepareTrainingDatasetRequest,
} from "../runtime";
import { createTransportOperation } from "../transport";
import { createIpcChannel, type IpcChannel, type IpcChannelValue } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_DATASET_PREPARE_TRAINING_OPERATION = createTransportOperation(
  "artifact",
  "prepare-training-dataset",
);

export const DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
  "request",
);

export const DESKTOP_DATASET_PREPARE_TRAINING_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
  "response",
);

export interface DesktopDatasetPreparationBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopPrepareTrainingDatasetRequestPayload {
  command: {
    sourceArtifactIds: string[];
    recipe: PrepareTrainingDatasetRequest["recipe"];
    split: PrepareTrainingDatasetRequest["split"];
    output: PrepareTrainingDatasetRequest["output"];
  };
  boundary: DesktopDatasetPreparationBoundaryContext;
}

export interface DesktopPrepareTrainingDatasetSuccessValue {
  result: {
    outputs: {
      local?: {
        dataset: StagedArtifactDescriptor;
      };
      huggingFace?: {
        dataset: {
          provider: "huggingface";
          repository: string;
          path: string;
          revision?: string;
          exists: boolean;
          verifiedAt: string;
        };
      };
    };
    provenance: {
      sourceArtifactIds: string[];
      recipe: PrepareTrainingDatasetRequest["recipe"];
      split: PrepareTrainingDatasetRequest["split"];
      output: PrepareTrainingDatasetRequest["output"];
      generationModelId: string;
      summary: DatasetPreparationSummary;
    };
    summary: DatasetPreparationSummary;
    warnings?: DatasetPreparationWarning[];
  };
}

export type DesktopPrepareTrainingDatasetRequest = IpcRequest<
  DesktopPrepareTrainingDatasetRequestPayload,
  typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
  Record<string, never>,
  typeof DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL.value
>;

export type DesktopPrepareTrainingDatasetResponse = IpcResponse<
  DesktopPrepareTrainingDatasetSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
  Record<string, never>,
  typeof DESKTOP_DATASET_PREPARE_TRAINING_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeBoundary(
  boundary: DesktopDatasetPreparationBoundaryContext,
): DesktopDatasetPreparationBoundaryContext {
  return {
    host: "desktop",
    source: normalizeRequiredTextField(boundary.source, "boundary.source"),
  };
}

export function createDesktopPrepareTrainingDatasetRequest(
  payload: DesktopPrepareTrainingDatasetRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopPrepareTrainingDatasetRequest {
  return createIpcRequest(
    DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL,
    {
      command: payload.command,
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopPrepareTrainingDatasetSuccessResponse(
  result: DesktopPrepareTrainingDatasetSuccessValue["result"],
  options?: { requestId?: string; correlationId?: string },
): DesktopPrepareTrainingDatasetResponse {
  return createIpcSuccessResponse(
    DESKTOP_DATASET_PREPARE_TRAINING_RESPONSE_CHANNEL,
    {
      result,
    },
    options,
  );
}

export function getDesktopPrepareTrainingDatasetChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION, "request">
>;
export function getDesktopPrepareTrainingDatasetChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION, "response">
>;
export function getDesktopPrepareTrainingDatasetChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_DATASET_PREPARE_TRAINING_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL
    : DESKTOP_DATASET_PREPARE_TRAINING_RESPONSE_CHANNEL;
}
