import type {
  DatasetPreparationSummary,
  DatasetPreparationWarning,
} from "./dataset-preparation";
import type { PythonRuntimeOutputDescriptor } from "./python-runtime-output-descriptor";
import type { DatasetQualityReport } from "./dataset-quality";
import type { DatasetPreparationAdvancedReport } from "./dataset-preparation-advanced";

export interface PrepareTrainingDatasetResult {
  outputs: PythonRuntimeOutputDescriptor[];
  summary: DatasetPreparationSummary;
  qualityReport?: DatasetQualityReport;
  advancedReport?: DatasetPreparationAdvancedReport;
  warnings?: DatasetPreparationWarning[];
}
