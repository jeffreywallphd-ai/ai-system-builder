import { createWorkspaceId, type WorkspaceId } from "../workspace";
import type { ModelValidationStatus } from "./model-validation";

export interface PublishModelRequest {
  workspaceId: WorkspaceId;
  modelRecordId: string;
  repository: string;
  owner?: string;
  revision?: string;
  private?: boolean;
  pathPrefix?: string;
  token?: string;
  allowWarningValidation?: boolean;
  allowInvalidValidation?: boolean;
  /** @deprecated Use allowWarningValidation and/or allowInvalidValidation instead. */
  allowInvalid?: boolean;
  forceRevalidate?: boolean;
}

export interface PublishModelResult {
  requestId?: string;
  modelRecordId: string;
  published: boolean;
  provider: "huggingface";
  repository: string;
  revision?: string;
  url?: string;
  validationStatus?: ModelValidationStatus;
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

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty trimmed string.`);
  }

  return normalized;
}


function normalizeRequiredWorkspaceId(value: WorkspaceId | string | undefined): WorkspaceId {
  if (typeof value !== "string") {
    throw new Error("workspaceId must be provided for workspace-scoped model operations.");
  }

  return createWorkspaceId(value);
}

export function normalizePublishModelRequest(request: PublishModelRequest): PublishModelRequest {
  return {
    workspaceId: normalizeRequiredWorkspaceId(request.workspaceId),
    modelRecordId: normalizeRequiredText(request.modelRecordId, "modelRecordId"),
    repository: normalizeRequiredText(request.repository, "repository"),
    owner: normalizeOptionalText(request.owner),
    revision: normalizeOptionalText(request.revision),
    private: typeof request.private === "boolean" ? request.private : undefined,
    pathPrefix: normalizeOptionalText(request.pathPrefix),
    token: normalizeOptionalText(request.token),
    allowWarningValidation: typeof request.allowWarningValidation === "boolean" ? request.allowWarningValidation : undefined,
    allowInvalidValidation: typeof request.allowInvalidValidation === "boolean" ? request.allowInvalidValidation : undefined,
    allowInvalid: typeof request.allowInvalid === "boolean" ? request.allowInvalid : undefined,
    forceRevalidate: typeof request.forceRevalidate === "boolean" ? request.forceRevalidate : undefined,
  };
}
