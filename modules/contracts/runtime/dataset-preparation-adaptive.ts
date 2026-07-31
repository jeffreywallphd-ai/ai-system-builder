import type {
  DatasetPreparationSourceCapability,
  DatasetPreparationSourceFormat,
  DatasetPreparationSourceKind,
} from "./dataset-preparation-capabilities";
import type { DatasetPreparationTaskType } from "./dataset-preparation";

export const DATASET_PREPARATION_INPUT_INTENTS = [
  "use-existing-dataset",
  "combine-existing-datasets",
  "create-from-source-material",
] as const;

export type DatasetPreparationInputIntent =
  (typeof DATASET_PREPARATION_INPUT_INTENTS)[number];

export const DATASET_PREPARATION_METHOD_IDS = [
  "validate-and-split",
  "combine-and-split",
  "fixed-length",
  "topic-aware",
  "structure-aware",
  "use-source-metadata",
  "model-assisted-metadata",
  "use-existing-annotations",
] as const;

export type DatasetPreparationMethodId =
  (typeof DATASET_PREPARATION_METHOD_IDS)[number];

export const DATASET_PREPARATION_ADAPTIVE_CONTROL_IDS = [
  "normalization",
  "fixed-length",
  "fixed-overlap",
  "document-boundaries",
  "maximum-section-count",
  "maximum-token-length",
  "topic-boundary-sensitivity",
  "maximum-source-spans",
  "similarity-threshold",
  "model",
  "prompt",
  "generation-failure-policy",
  "generation-candidate-count",
  "generation-sampling",
  "structured-output",
  "task-fields",
  "dataset-split",
  "output",
] as const;

export type DatasetPreparationAdaptiveControlId =
  (typeof DATASET_PREPARATION_ADAPTIVE_CONTROL_IDS)[number];

export type DatasetPreparationGenerationMode =
  "none" | "task-examples" | "metadata-text";

export interface DatasetPreparationMethodOption {
  id: DatasetPreparationMethodId;
  tier: "basic" | "balanced" | "advanced";
  generationMode: DatasetPreparationGenerationMode;
  contentStrategy?: "character" | "semantic" | "layout";
  controls: readonly DatasetPreparationAdaptiveControlId[];
}

export interface DatasetPreparationAdaptiveResolution {
  status: "needs-input" | "ready" | "unsupported";
  taskType: DatasetPreparationTaskType;
  sourceKinds: readonly DatasetPreparationSourceKind[];
  sourceFormats: readonly DatasetPreparationSourceFormat[];
  inputIntent?: DatasetPreparationInputIntent;
  methods: readonly DatasetPreparationMethodOption[];
  defaultMethodId?: DatasetPreparationMethodId;
  message: string;
  action?: string;
}

export interface DatasetPreparationExecutionPlan {
  schemaVersion: "1";
  inputIntent: DatasetPreparationInputIntent;
  method: DatasetPreparationMethodId;
  sourceKinds: DatasetPreparationSourceKind[];
  generationMode: DatasetPreparationGenerationMode;
}

const COMMON_CONTROLS = [
  "task-fields",
  "dataset-split",
  "output",
] as const satisfies readonly DatasetPreparationAdaptiveControlId[];

const GENERATION_CONTROLS = [
  "model",
  "prompt",
  "generation-failure-policy",
  "generation-candidate-count",
  "generation-sampling",
  "structured-output",
] as const satisfies readonly DatasetPreparationAdaptiveControlId[];

const method = (
  input: Omit<DatasetPreparationMethodOption, "controls"> & {
    controls?: readonly DatasetPreparationAdaptiveControlId[];
  },
): DatasetPreparationMethodOption => ({
  ...input,
  controls: [...(input.controls ?? []), ...COMMON_CONTROLS],
});

const VALIDATE_AND_SPLIT = method({
  id: "validate-and-split",
  tier: "basic",
  generationMode: "none",
});

const COMBINE_AND_SPLIT = method({
  id: "combine-and-split",
  tier: "balanced",
  generationMode: "none",
});

const FIXED_LENGTH = method({
  id: "fixed-length",
  tier: "basic",
  generationMode: "task-examples",
  contentStrategy: "character",
  controls: [
    "normalization",
    "fixed-length",
    "fixed-overlap",
    "document-boundaries",
    "maximum-section-count",
    ...GENERATION_CONTROLS,
  ],
});

const TOPIC_AWARE = method({
  id: "topic-aware",
  tier: "balanced",
  generationMode: "task-examples",
  contentStrategy: "semantic",
  controls: [
    "normalization",
    "maximum-token-length",
    "topic-boundary-sensitivity",
    "maximum-source-spans",
    "similarity-threshold",
    ...GENERATION_CONTROLS,
  ],
});

const STRUCTURE_AWARE = method({
  id: "structure-aware",
  tier: "advanced",
  generationMode: "task-examples",
  contentStrategy: "layout",
  controls: [
    "normalization",
    "maximum-token-length",
    "maximum-source-spans",
    "similarity-threshold",
    ...GENERATION_CONTROLS,
  ],
});

const USE_SOURCE_METADATA = method({
  id: "use-source-metadata",
  tier: "basic",
  generationMode: "none",
});

const MODEL_ASSISTED_METADATA = method({
  id: "model-assisted-metadata",
  tier: "balanced",
  generationMode: "metadata-text",
  controls: GENERATION_CONTROLS,
});

const USE_EXISTING_ANNOTATIONS = method({
  id: "use-existing-annotations",
  tier: "basic",
  generationMode: "none",
});

const uniqueSorted = <T extends string>(values: readonly T[]): T[] =>
  [...new Set(values)].sort() as T[];

function unsupported(
  taskType: DatasetPreparationTaskType,
  sources: readonly DatasetPreparationSourceCapability[],
  message: string,
  action: string,
): DatasetPreparationAdaptiveResolution {
  return {
    status: "unsupported",
    taskType,
    sourceKinds: uniqueSorted(sources.map((source) => source.kind)),
    sourceFormats: uniqueSorted(sources.map((source) => source.format)),
    methods: [],
    message,
    action,
  };
}

export function resolveDatasetPreparationAdaptivePlan(input: {
  taskType: DatasetPreparationTaskType;
  sources: readonly DatasetPreparationSourceCapability[];
}): DatasetPreparationAdaptiveResolution {
  const { taskType, sources } = input;
  if (sources.length === 0) {
    return {
      status: "needs-input",
      taskType,
      sourceKinds: [],
      sourceFormats: [],
      methods: [],
      message: "Choose at least one supported source.",
    };
  }

  if (sources.some((source) => !source.taskTypes.includes(taskType))) {
    return unsupported(
      taskType,
      sources,
      "One or more selected sources do not support this training goal.",
      "Choose compatible sources or select a different training goal.",
    );
  }

  const sourceKinds = uniqueSorted(sources.map((source) => source.kind));
  const sourceFormats = uniqueSorted(sources.map((source) => source.format));
  if (sourceKinds.length !== 1) {
    return unsupported(
      taskType,
      sources,
      "Existing datasets and source material cannot be mixed in one preparation run.",
      "Prepare the existing datasets and source material separately, then combine compatible dataset versions.",
    );
  }

  const sourceKind = sourceKinds[0];
  if (sourceKind === "structured") {
    const inputIntent =
      sources.length === 1
        ? "use-existing-dataset"
        : "combine-existing-datasets";
    const selectedMethod =
      sources.length === 1 ? VALIDATE_AND_SPLIT : COMBINE_AND_SPLIT;
    return {
      status: "ready",
      taskType,
      sourceKinds,
      sourceFormats,
      inputIntent,
      methods: [selectedMethod],
      defaultMethodId: selectedMethod.id,
      message:
        sources.length === 1
          ? "This dataset will be checked and divided without document conversion."
          : `${sources.length} compatible datasets will be combined, checked, and divided.`,
    };
  }

  if (sourceKind === "document") {
    const methods: DatasetPreparationMethodOption[] = [
      FIXED_LENGTH,
      TOPIC_AWARE,
    ];
    if (sourceFormats.some((format) => format !== "text")) {
      methods.push(STRUCTURE_AWARE);
    }
    return {
      status: "ready",
      taskType,
      sourceKinds,
      sourceFormats,
      inputIntent: "create-from-source-material",
      methods,
      defaultMethodId: "topic-aware",
      message:
        "Training examples will be created from the selected source material.",
    };
  }

  if (taskType === "vision-detection" || taskType === "vision-segmentation") {
    return {
      status: "ready",
      taskType,
      sourceKinds,
      sourceFormats,
      inputIntent: "create-from-source-material",
      methods: [USE_EXISTING_ANNOTATIONS],
      defaultMethodId: USE_EXISTING_ANNOTATIONS.id,
      message:
        taskType === "vision-detection"
          ? "Selected images must already include reviewed box annotations."
          : "Selected images must already include reviewed mask annotations.",
      action:
        taskType === "vision-detection"
          ? "If boxes are stored in a table or manifest, select that structured dataset instead."
          : "If masks are stored in a table or manifest, select that structured dataset instead.",
    };
  }

  return {
    status: "ready",
    taskType,
    sourceKinds,
    sourceFormats,
    inputIntent: "create-from-source-material",
    methods: [USE_SOURCE_METADATA, MODEL_ASSISTED_METADATA],
    defaultMethodId: USE_SOURCE_METADATA.id,
    message:
      taskType === "diffusion-lora"
        ? "Captions will be prepared for the selected images."
        : "Labels will be prepared for the selected images.",
  };
}

export function createDatasetPreparationExecutionPlan(
  resolution: DatasetPreparationAdaptiveResolution,
  requestedMethodId?: DatasetPreparationMethodId,
): DatasetPreparationExecutionPlan {
  if (
    resolution.status !== "ready" ||
    !resolution.inputIntent ||
    !resolution.defaultMethodId
  ) {
    throw new Error(
      resolution.action
        ? `${resolution.message} ${resolution.action}`
        : resolution.message,
    );
  }
  const methodId = requestedMethodId ?? resolution.defaultMethodId;
  const selectedMethod = resolution.methods.find(
    (candidate) => candidate.id === methodId,
  );
  if (!selectedMethod) {
    throw new Error(
      "The selected preparation method is not compatible with these sources and training goal.",
    );
  }
  return {
    schemaVersion: "1",
    inputIntent: resolution.inputIntent,
    method: selectedMethod.id,
    sourceKinds: [...resolution.sourceKinds],
    generationMode: selectedMethod.generationMode,
  };
}

export function resolveDatasetPreparationMethodOption(
  resolution: DatasetPreparationAdaptiveResolution,
  methodId: DatasetPreparationMethodId,
): DatasetPreparationMethodOption | undefined {
  return resolution.methods.find((candidate) => candidate.id === methodId);
}

export function isDatasetPreparationControlActive(
  methodOption: DatasetPreparationMethodOption | undefined,
  controlId: DatasetPreparationAdaptiveControlId,
): boolean {
  return Boolean(methodOption?.controls.includes(controlId));
}

export function normalizeLegacyDatasetPreparationMethod(input: {
  taskType: DatasetPreparationTaskType;
  sourceKinds: readonly DatasetPreparationSourceKind[];
  sourceCount: number;
  preset?: "standard" | "better-document-understanding" | "generate-examples";
  textInputMode?: "provided" | "generate";
}): DatasetPreparationMethodId {
  const sourceKinds = uniqueSorted(input.sourceKinds);
  if (sourceKinds.length !== 1 || input.sourceCount < 1) {
    throw new Error(
      "This saved setup mixes input roles and cannot be restored safely.",
    );
  }
  if (sourceKinds[0] === "structured") {
    if (input.preset && input.preset !== "standard") {
      throw new Error(
        "This saved setup used document processing with an existing dataset and cannot be restored safely.",
      );
    }
    return input.sourceCount === 1 ? "validate-and-split" : "combine-and-split";
  }
  if (sourceKinds[0] === "document") {
    if (input.preset === "better-document-understanding") {
      return "structure-aware";
    }
    if (input.preset === "generate-examples") {
      return "topic-aware";
    }
    return "fixed-length";
  }
  if (
    input.taskType === "vision-detection" ||
    input.taskType === "vision-segmentation"
  ) {
    if (input.textInputMode === "generate") {
      throw new Error(
        "Automatic boxes and masks are not supported by this saved setup.",
      );
    }
    return "use-existing-annotations";
  }
  return input.textInputMode === "generate"
    ? "model-assisted-metadata"
    : "use-source-metadata";
}
