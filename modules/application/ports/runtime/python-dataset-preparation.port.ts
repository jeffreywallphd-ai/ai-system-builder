import {
  PrepareTrainingDatasetRequest,
  PrepareTrainingDatasetResult,
} from "../../../contracts/runtime";
import type { ContractError } from "../../../contracts/shared";

export class PythonDatasetPreparationError extends Error {
  public readonly contractError: ContractError;

  public constructor(contractError: ContractError) {
    super(contractError.message);
    this.name = "PythonDatasetPreparationError";
    this.contractError = contractError;
  }
}

export interface PythonDatasetPreparationPort {
  prepareTrainingDataset(
    request: PrepareTrainingDatasetRequest
  ): Promise<PrepareTrainingDatasetResult>;
}
