import type { ModelTrainingRequest, ModelTrainingResult } from "../../../contracts/model";

export interface ModelTrainingPort {
  trainModel(request: ModelTrainingRequest): Promise<ModelTrainingResult>;
}
