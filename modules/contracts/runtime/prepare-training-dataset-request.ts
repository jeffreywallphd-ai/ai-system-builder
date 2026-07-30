import type { WorkspaceId } from "../workspace";
import type {
  DatasetOutputConfig,
  DatasetPreparationRecipe,
  DatasetPreparationSourceInput,
  DatasetSplitConfig,
} from "./dataset-preparation";
import type { DatasetQualityRuntimeConfig } from "./dataset-quality";
import type { DatasetPreparationAdvancedConfig } from "./dataset-preparation-advanced";
import type { DatasetPreparationExecutionPlan } from "./dataset-preparation-adaptive";
import type { DatasetPreparationOutputPurpose } from "./dataset-preparation-output-shape";

export interface DatasetPreparationRuntimeStructuredOutput {
  schema: Record<string, unknown>;
  schemaFingerprint: string;
  payloadKey: "example" | "value";
  purposePaths: Partial<
    Record<DatasetPreparationOutputPurpose, readonly string[]>
  >;
  constrainedDecoding: boolean;
}

export interface DatasetPreparationRuntimeOptions {
  runtimeWorkingDirectory?: string;
  /** Host-compiled only. Never accepted directly from a public command. */
  structuredOutput?: DatasetPreparationRuntimeStructuredOutput;
}

export interface PrepareTrainingDatasetRequest {
  workspaceId?: WorkspaceId;
  sourceInputs: DatasetPreparationSourceInput[];
  preparation?: DatasetPreparationExecutionPlan;
  recipe: DatasetPreparationRecipe;
  split: DatasetSplitConfig;
  output: DatasetOutputConfig;
  quality?: DatasetQualityRuntimeConfig;
  advanced?: DatasetPreparationAdvancedConfig;
  runtime?: DatasetPreparationRuntimeOptions;
}
