import type { ModelInventoryRecord } from "../../../contracts/model";

const SELECTABLE_IMAGE_MODEL_LIFECYCLE_STATUSES = ["downloaded", "generated", "validated"] as const;
const SELECTABLE_IMAGE_MODEL_ARTIFACT_FORMS = ["full-model", "merged-model", "checkpoint"] as const;

export type ImageGenerationModelInventoryCandidate = Pick<
  ModelInventoryRecord,
  "artifactForm" | "displayName" | "inferenceMode" | "modelId" | "taskTags"
>;

export type ImageGenerationModelDropdownCandidate = Pick<
  ModelInventoryRecord,
  | "artifactForm"
  | "displayName"
  | "inferenceMode"
  | "lifecycleStatus"
  | "localPath"
  | "modelId"
  | "modelRecordId"
  | "provider"
  | "source"
  | "storageScope"
  | "taskTags"
>;

export interface ImageGenerationModelDropdownOption {
  value: string;
  label: string;
  modelRecordId: string;
  ready: boolean;
}

export function isImageGenerationModelCandidate(model: ImageGenerationModelInventoryCandidate): boolean {
  if (!SELECTABLE_IMAGE_MODEL_ARTIFACT_FORMS.includes(model.artifactForm as typeof SELECTABLE_IMAGE_MODEL_ARTIFACT_FORMS[number])) {
    return false;
  }

  if (model.inferenceMode === "text-to-image") {
    return true;
  }

  if ((model.taskTags ?? []).some((tag) => tag === "text-to-image")) {
    return true;
  }

  const identity = `${model.modelId ?? ""} ${model.displayName}`.toLowerCase();
  return /\b(stable-diffusion|sdxl|flux|text-to-image|txt2img|diffusion)\b/.test(identity);
}

export function isImageGenerationModelReady(model: Pick<ModelInventoryRecord, "lifecycleStatus">): boolean {
  return SELECTABLE_IMAGE_MODEL_LIFECYCLE_STATUSES.includes(model.lifecycleStatus as typeof SELECTABLE_IMAGE_MODEL_LIFECYCLE_STATUSES[number]);
}

export function toImageGenerationModelDropdownValue(
  model: Pick<ModelInventoryRecord, "displayName" | "localPath" | "modelId" | "modelRecordId">,
): string | undefined {
  const candidates = [model.modelRecordId, model.modelId, model.displayName, model.localPath];
  return candidates.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

export function formatImageGenerationModelDropdownLabel(
  model: Pick<
    ModelInventoryRecord,
    "artifactForm" | "displayName" | "inferenceMode" | "lifecycleStatus" | "modelId" | "provider" | "source" | "storageScope"
  >,
  referenceOnly = false,
): string {
  const identity = model.modelId ? ` (${model.modelId})` : "";
  const inferenceMode = model.inferenceMode ? ` - ${model.inferenceMode}` : "";
  const provider = model.provider ?? model.source;
  const storageScope = model.storageScope === "shared" ? " - shared" : " - workspace";
  const suffix = referenceOnly ? " - reference only" : "";
  return `${model.displayName}${identity}${storageScope} - ${provider} - ${model.lifecycleStatus} - ${model.artifactForm}${inferenceMode}${suffix}`;
}

export function toImageGenerationModelDropdownOption(
  model: ImageGenerationModelDropdownCandidate,
): ImageGenerationModelDropdownOption | undefined {
  if (!isImageGenerationModelCandidate(model)) {
    return undefined;
  }

  const value = toImageGenerationModelDropdownValue(model);
  if (!value) {
    return undefined;
  }

  const ready = isImageGenerationModelReady(model);
  return {
    value,
    modelRecordId: model.modelRecordId,
    ready,
    label: formatImageGenerationModelDropdownLabel(model, !ready),
  };
}
