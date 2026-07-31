import {
  isGeneratedArtifact,
  isUploadedArtifact,
} from "../../artifact-browser/helpers/artifactStorageGrouping";
import {
  evaluateDatasetPreparationSourceReadiness,
  type DatasetPreparationTaskType,
} from "../../../../../../../modules/contracts/runtime";

export interface DatasetPreparationSourceArtifact {
  artifactId: string;
  label: string;
  storageKey: string;
  mediaType?: string;
  sourceKind?: string;
}

export function filterUploadedDatasetPreparationArtifacts(
  artifacts: DatasetPreparationSourceArtifact[],
): DatasetPreparationSourceArtifact[] {
  return artifacts.filter(isUploadedArtifact);
}

export function filterGeneratedDatasetPreparationArtifacts(
  artifacts: DatasetPreparationSourceArtifact[],
): DatasetPreparationSourceArtifact[] {
  return artifacts.filter(isGeneratedArtifact);
}

export function filterTaskRelevantDatasetPreparationArtifacts(
  artifacts: DatasetPreparationSourceArtifact[],
  taskType: DatasetPreparationTaskType,
): DatasetPreparationSourceArtifact[] {
  return artifacts.filter(
    (artifact) =>
      evaluateDatasetPreparationSourceReadiness({
        fileName: artifact.label || artifact.storageKey,
        mediaType: artifact.mediaType,
        taskType,
      }).ready,
  );
}
