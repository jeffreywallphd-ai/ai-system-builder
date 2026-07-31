import { createWorkspaceId, type WorkspaceId } from "../workspace";
import { normalizeModelSerializationFormat, type ModelSerializationFormat } from "../../domain/model";

export const MODEL_VALIDATION_STATUSES = ["unknown", "valid", "invalid", "warning"] as const;

export type ModelValidationStatus = (typeof MODEL_VALIDATION_STATUSES)[number];

const MODEL_VALIDATION_STATUS_SET = new Set<string>(MODEL_VALIDATION_STATUSES);

export interface ModelValidationSummary {
  status: ModelValidationStatus;
  checkedAt?: string;
  reportPath?: string;
  expectedLoRA?: boolean;
  expectedRecurrentAdditions?: boolean;
  detectedLoRA?: boolean;
  detectedRecurrentAdditions?: boolean;
  serializationFormat?: ModelSerializationFormat;
  shardCount?: number;
  warnings?: string[];
  errors?: string[];
}

export interface ValidateModelRequest {
  workspaceId: WorkspaceId;
  modelRecordId: string;
  modelPath?: string;
  reportOutputDirectory?: string;
  expectedLoRA?: boolean;
  expectedRecurrentAdditions?: boolean;
  allowWarnings?: boolean;
  validationStrictness?: "normal" | "publish";
}

export interface ValidateModelResult {
  requestId?: string;
  modelRecordId: string;
  status: ModelValidationStatus;
  reportPath?: string;
  diffPath?: string;
  serializationFormat?: ModelSerializationFormat;
  shardCount?: number;
  detectedLoRA?: boolean;
  detectedRecurrentAdditions?: boolean;
  validatedModelPath?: string;
  validatedAt?: string;
  validationStrictness?: "normal" | "publish";
  tensorChecksCompleted?: boolean;
  warnings?: string[];
  errors?: string[];
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringList(values: readonly string[] | undefined): string[] | undefined {
  const normalized = values
    ?.map((value) => value.trim())
    .filter((value) => value.length > 0);

  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function normalizeModelValidationStatus(value: string): ModelValidationStatus {
  const normalized = value.trim().toLowerCase();
  if (MODEL_VALIDATION_STATUS_SET.has(normalized)) {
    return normalized as ModelValidationStatus;
  }

  throw new Error(
    `Model validation status must be one of: ${MODEL_VALIDATION_STATUSES.join(", ")}. Received: ${value}`,
  );
}

export function normalizeModelValidationSummary(summary: ModelValidationSummary): ModelValidationSummary {
  return {
    status: normalizeModelValidationStatus(summary.status),
    checkedAt: normalizeOptionalText(summary.checkedAt),
    reportPath: normalizeOptionalText(summary.reportPath),
    expectedLoRA: typeof summary.expectedLoRA === "boolean" ? summary.expectedLoRA : undefined,
    expectedRecurrentAdditions:
      typeof summary.expectedRecurrentAdditions === "boolean" ? summary.expectedRecurrentAdditions : undefined,
    detectedLoRA: typeof summary.detectedLoRA === "boolean" ? summary.detectedLoRA : undefined,
    detectedRecurrentAdditions:
      typeof summary.detectedRecurrentAdditions === "boolean" ? summary.detectedRecurrentAdditions : undefined,
    serializationFormat:
      typeof summary.serializationFormat === "string"
        ? normalizeModelSerializationFormat(summary.serializationFormat)
        : undefined,
    shardCount: typeof summary.shardCount === "number" ? summary.shardCount : undefined,
    warnings: normalizeStringList(summary.warnings),
    errors: normalizeStringList(summary.errors),
  };
}


function normalizeRequiredWorkspaceId(value: WorkspaceId | string | undefined): WorkspaceId {
  if (typeof value !== "string") {
    throw new Error("workspaceId must be provided for workspace-scoped model operations.");
  }

  return createWorkspaceId(value);
}

export function normalizeValidateModelRequest(request: ValidateModelRequest): ValidateModelRequest {
  return {
    workspaceId: normalizeRequiredWorkspaceId(request.workspaceId),
    modelRecordId: normalizeRequiredText(request.modelRecordId, "modelRecordId"),
    modelPath: normalizeOptionalText(request.modelPath),
    reportOutputDirectory: normalizeOptionalText(request.reportOutputDirectory),
    expectedLoRA: typeof request.expectedLoRA === "boolean" ? request.expectedLoRA : undefined,
    expectedRecurrentAdditions: typeof request.expectedRecurrentAdditions === "boolean" ? request.expectedRecurrentAdditions : undefined,
    allowWarnings: typeof request.allowWarnings === "boolean" ? request.allowWarnings : undefined,
    validationStrictness: request.validationStrictness === "publish" ? "publish" : request.validationStrictness === "normal" ? "normal" : undefined,
  };
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty trimmed string.`);
  }

  return normalized;
}
