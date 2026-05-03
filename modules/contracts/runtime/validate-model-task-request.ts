export interface ValidateModelTaskRequest {
  modelRecordId: string;
  modelPath: string;
  reportOutputDirectory?: string;
  expectedLoRA?: boolean;
  expectedRecurrentAdditions?: boolean;
  validationStrictness?: "normal" | "publish";
}
