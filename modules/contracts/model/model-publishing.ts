import type { ModelValidationStatus } from "./model-validation";

export interface PublishModelRequest {
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
