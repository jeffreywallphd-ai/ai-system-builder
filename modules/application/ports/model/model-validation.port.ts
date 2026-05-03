import type { ValidateModelRequest, ValidateModelResult } from "../../../contracts/model";

export interface ModelValidationPort {
  validateModel(request: ValidateModelRequest): Promise<ValidateModelResult>;
}
