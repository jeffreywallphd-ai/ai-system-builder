import type {
  DatasetOutputConfig,
  DatasetPreparationRecipe,
  DatasetPreparationSourceInput,
  DatasetSplitConfig,
} from "./dataset-preparation";

export interface DatasetPreparationRuntimeOptions {
  runtimeWorkingDirectory?: string;
}

export interface PrepareTrainingDatasetRequest {
  sourceInputs: DatasetPreparationSourceInput[];
  recipe: DatasetPreparationRecipe;
  split: DatasetSplitConfig;
  output: DatasetOutputConfig;
  runtime?: DatasetPreparationRuntimeOptions;
}
