import {
  DATASET_PREPARATION_TASK_PROFILE_DEFINITIONS,
  type DatasetPreparationInputIntent,
  type DatasetPreparationMethodId,
  type DatasetPreparationTaskProfileDefinition,
  type DatasetPreparationTaskType,
} from "../../../contracts/runtime";

export interface DatasetPreparationTaskProfileOption {
  readonly taskType: DatasetPreparationTaskType;
  readonly label: string;
  readonly description: string;
  readonly runtimeSupport: DatasetPreparationTaskProfileDefinition["runtimeSupport"];
}

const TASK_COPY: Record<
  DatasetPreparationTaskType,
  Pick<DatasetPreparationTaskProfileOption, "label" | "description">
> = {
  "llm-instruction": {
    label: "Instruction tuning",
    description:
      "Creates practice prompts and helpful answers. A policy document, for example, can become a question about a rule and a clear answer.",
  },
  "llm-classification": {
    label: "Text classification",
    description:
      "Creates labeled text examples. A support message, for example, can be labeled billing, bug report, or account help.",
  },
  "llm-extraction": {
    label: "Information extraction",
    description:
      "Creates examples that pair text with the facts to extract, such as vendor, invoice date, and total amount.",
  },
  "llm-embedding": {
    label: "Search matching",
    description:
      "Creates matched text pairs that teach search what belongs together, such as a query and the passage that answers it.",
  },
  "llm-reranker": {
    label: "Search result ordering",
    description:
      "Creates query-and-passage examples with usefulness scores so a model can put the best search results first.",
  },
  "diffusion-lora": {
    label: "Image LoRA",
    description:
      "Pairs images with short captions so an image model can learn a subject, style, or idea.",
  },
  "vision-classification": {
    label: "Image classification",
    description: "Pairs each image with a label, such as shoe, bag, or shirt.",
  },
  "vision-detection": {
    label: "Object detection",
    description:
      "Pairs images with reviewed boxes and labels that identify each object.",
  },
  "vision-segmentation": {
    label: "Image segmentation",
    description:
      "Pairs images with reviewed masks that outline the full area of each object.",
  },
};

export const DATASET_PREPARATION_TASK_OPTIONS: readonly DatasetPreparationTaskProfileOption[] =
  DATASET_PREPARATION_TASK_PROFILE_DEFINITIONS.map((profile) => ({
    taskType: profile.taskType,
    label: TASK_COPY[profile.taskType].label,
    description: TASK_COPY[profile.taskType].description,
    runtimeSupport: profile.runtimeSupport,
  }));

export function getDatasetPreparationTaskOption(
  taskType: DatasetPreparationTaskType,
): DatasetPreparationTaskProfileOption {
  const option = DATASET_PREPARATION_TASK_OPTIONS.find(
    (candidate) => candidate.taskType === taskType,
  );
  if (!option) {
    throw new Error(
      `Dataset preparation task option is not registered: ${taskType}`,
    );
  }
  return option;
}

const METHOD_COPY: Record<
  DatasetPreparationMethodId,
  { label: string; description: string }
> = {
  "validate-and-split": {
    label: "Check and divide this dataset",
    description:
      "Checks the existing examples, keeps their source links, divides them into training, validation, and test sets, and records a new version.",
  },
  "combine-and-split": {
    label: "Combine, check, and divide",
    description:
      "Combines the selected datasets, checks the examples together, keeps each source link, and records one divided version.",
  },
  "fixed-length": {
    label: "Fixed-length sections",
    description:
      "Divides documents by a consistent text length, with optional overlap, before creating examples. It is simple and predictable but can split a topic.",
  },
  "topic-aware": {
    label: "Topic-aware sections",
    description:
      "Finds likely topic changes, keeps related text together, then creates and checks task-specific examples. This is the balanced default.",
  },
  "structure-aware": {
    label: "Document-structure sections",
    description:
      "Uses headings, paragraphs, tables, and other available document structure before creating and checking examples. It does not read text from scanned images.",
  },
  "use-source-metadata": {
    label: "Use attached captions or labels",
    description:
      "Uses captions or labels already attached to the images, then checks and divides the resulting examples.",
  },
  "model-assisted-metadata": {
    label: "Create captions or labels locally",
    description:
      "Uses a local model to propose missing captions or labels, then checks them and requires review before saving.",
  },
  "use-existing-annotations": {
    label: "Use reviewed annotations",
    description:
      "Uses existing boxes or masks. This workflow validates annotation structure but does not create missing annotations.",
  },
};

export function getDatasetPreparationMethodCopy(
  method: DatasetPreparationMethodId,
) {
  return METHOD_COPY[method];
}

const INTENT_COPY: Record<
  DatasetPreparationInputIntent,
  { label: string; description: string }
> = {
  "use-existing-dataset": {
    label: "Use one existing dataset",
    description:
      "The selected file already contains training examples, so no document-division method is needed.",
  },
  "combine-existing-datasets": {
    label: "Combine existing datasets",
    description:
      "The selected files already contain training examples and will be combined before checks and splitting.",
  },
  "create-from-source-material": {
    label: "Create a dataset from source material",
    description:
      "The selected documents or images need to be turned into task-specific training examples.",
  },
};

export function getDatasetPreparationIntentCopy(
  intent: DatasetPreparationInputIntent,
) {
  return INTENT_COPY[intent];
}

export function getDatasetInspectionCopy(
  taskType: DatasetPreparationTaskType,
): {
  checked: string;
  limitation: string;
} {
  if (
    taskType === "diffusion-lora" ||
    taskType === "vision-classification" ||
    taskType === "vision-detection" ||
    taskType === "vision-segmentation"
  ) {
    return {
      checked:
        "Checks source links, captions or labels, and the structure of boxes or masks when the task uses them.",
      limitation:
        "Image pixels are not inspected for faces, personal details, credentials, unsafe content, or annotation accuracy.",
    };
  }
  return {
    checked:
      "Checks required task fields, source links, duplicates, common personal-data patterns, credential-like text, and split safety.",
    limitation:
      "Automated text checks can miss information whose meaning depends on context, so review remains required.",
  };
}
