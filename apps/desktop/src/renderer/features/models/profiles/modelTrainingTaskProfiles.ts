import {
  DATASET_PREPARATION_TASK_PROFILE_DEFINITIONS,
  type DatasetPreparationTaskProfileDefinition,
  type DatasetPreparationTaskType,
} from "../../../../../../../modules/contracts/runtime";

export interface ModelTrainingTaskProfileOption {
  readonly taskType: DatasetPreparationTaskType;
  readonly label: string;
  readonly description: string;
  readonly runtimeSupport: DatasetPreparationTaskProfileDefinition["runtimeSupport"];
  readonly executableTrainingSupport: "text-causal-lm" | "diffusion-lora" | "vision-lora-or-full-finetune";
  readonly statusLabel: string;
}

const TASK_PROFILE_COPY: Record<DatasetPreparationTaskType, Pick<ModelTrainingTaskProfileOption, "label" | "description" | "executableTrainingSupport">> = {
  "llm-instruction": {
    label: "Instruction tuning",
    description: "Trains a text model on instruction and response examples.",
    executableTrainingSupport: "text-causal-lm",
  },
  "llm-classification": {
    label: "Text classification",
    description: "Trains a text model from text and category examples.",
    executableTrainingSupport: "text-causal-lm",
  },
  "llm-extraction": {
    label: "Information extraction",
    description: "Trains a text model from text and expected field examples.",
    executableTrainingSupport: "text-causal-lm",
  },
  "llm-embedding": {
    label: "Embedding pairs",
    description: "Trains a text model from related and unrelated text pairs.",
    executableTrainingSupport: "text-causal-lm",
  },
  "llm-reranker": {
    label: "Reranking",
    description: "Trains a text model from query, passage, and relevance examples.",
    executableTrainingSupport: "text-causal-lm",
  },
  "diffusion-lora": {
    label: "Image LoRA",
    description: "Trains a small adapter for a text-to-image model from image and caption examples.",
    executableTrainingSupport: "diffusion-lora",
  },
  "vision-classification": {
    label: "Image classification",
    description: "Trains a vision model to assign categories to images.",
    executableTrainingSupport: "vision-lora-or-full-finetune",
  },
  "vision-detection": {
    label: "Object detection",
    description: "Trains a vision model to find labeled objects in images.",
    executableTrainingSupport: "vision-lora-or-full-finetune",
  },
  "vision-segmentation": {
    label: "Image segmentation",
    description: "Trains a vision model to mark labeled areas within images.",
    executableTrainingSupport: "vision-lora-or-full-finetune",
  },
};

export const MODEL_TRAINING_TASK_PROFILE_OPTIONS: readonly ModelTrainingTaskProfileOption[] =
  DATASET_PREPARATION_TASK_PROFILE_DEFINITIONS.map((profile) => {
    const copy = TASK_PROFILE_COPY[profile.taskType];
    return {
      taskType: profile.taskType,
      label: copy.label,
      description: copy.description,
      runtimeSupport: profile.runtimeSupport,
      executableTrainingSupport: copy.executableTrainingSupport,
      statusLabel: "Trainable now",
    };
  });
