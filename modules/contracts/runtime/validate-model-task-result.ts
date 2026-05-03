import type { ModelValidationStatus } from "../model";

export interface ValidateModelTaskResult {
  modelRecordId: string;
  status: ModelValidationStatus;
  validationReportPath?: string;
  validationDiffPath?: string;
  serializationFormat?: string;
  shardCount?: number;
  detectedLoRA?: boolean;
  detectedRecurrentAdditions?: boolean;
  warnings?: string[];
  errors?: string[];
}
