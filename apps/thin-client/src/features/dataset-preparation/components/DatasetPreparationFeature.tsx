import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ApiDatasetPreparationCommand,
  ApiPreparedTrainingDatasetResult,
} from "../../../../../../modules/contracts/api";
import {
  createDefaultDatasetPreparationTaskRecipe,
  createDefaultDatasetPreparationVisualOutputShape,
  createDatasetPreparationAdvancedConfigForMethod,
  compileDatasetPreparationVisualOutputShape,
  createDatasetPreparationExecutionPlan,
  evaluateDatasetPreparationSourceReadiness,
  resolveDatasetPreparationAdaptivePlan,
  resolveDatasetPreparationMethodOption,
  resolveDatasetPreparationSourceCapability,
  resolveDefaultDatasetPreparationPromptTemplate,
  resolveDefaultDatasetPreparationTextGenerationModel,
  resolveDatasetPreparationConstrainedJson,
  resolveDatasetPreparationGenerationModelEstimatedBytes,
  type DatasetPreparationAdvancedReport,
  type DatasetPreparationExecutionPlan,
  type DatasetPreparationMethodId,
  type DatasetPreparationSourceCapability,
  type DatasetPreparationTaskRecipe,
  type DatasetPreparationTaskType,
  type DatasetPreparationVisualOutputShape,
  type DatasetPreparationGenerationCapacitySnapshot,
  type DatasetQualityPreset,
  type DatasetQualityReport,
} from "../../../../../../modules/contracts/runtime";
import {
  DATASET_PREPARATION_TASK_OPTIONS,
  TransientNotificationPublisher,
  DatasetVersionPanel,
  DatasetPreparationOutputShapeEditor,
  WorkflowSequence,
  WorkflowStep,
  getDatasetInspectionCopy,
  getDatasetPreparationIntentCopy,
  getDatasetPreparationMethodCopy,
  getDatasetPreparationTaskOption,
} from "../../../../../../modules/ui/shared";
import {
  createApiArtifactBrowserClient,
  type ArtifactBrowserApiClient,
  type ThinClientArtifactBrowseItem,
} from "../../artifact-browser/api/apiArtifactBrowserClient";
import {
  createApiDatasetPreparationClient,
  type ApiDatasetPreparationClient,
} from "../api/apiDatasetPreparationClient";

export interface DatasetPreparationFeatureProps {
  workspaceId: string;
  artifactClient?: ArtifactBrowserApiClient;
  preparationClient?: ApiDatasetPreparationClient;
}

type Status =
  | { kind: "idle"; message?: string }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

const waitForNextPoll = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 750));

const QUALITY_REASON_LABELS: Record<string, string> = {
  "mapping-required-fields-missing": "Required columns were not found",
  "schema-invalid": "Required values were missing or invalid",
  "exact-duplicate": "Exact duplicates",
  "fuzzy-duplicate": "Very similar examples",
  "semantic-duplicate": "Examples with the same meaning",
  "synthetic-schema-invalid": "Generated example did not fit the training goal",
  "synthetic-grounding-low": "Generated answer was not supported by the source",
  "synthetic-citation-missing":
    "Generated example could not be traced to its source",
  "synthetic-critic-rejected":
    "Generated example did not pass the independent check",
  "synthetic-duplicate": "Repeated generated example",
  "synthetic-diversity-low": "Generated examples were too similar",
  "synthetic-safety-rejected": "Generated example needs safety review",
  "text-too-short": "Text was too short",
  "text-too-long": "Text was too long",
  "language-not-allowed": "Language was not allowed",
  "language-uncertain": "Language could not be confirmed",
  "sensitive-personal-data": "Possible personal data",
  "secret-like-content": "Possible passwords or credentials",
  "unsafe-content": "Content marked unsafe",
  "benchmark-excluded": "Excluded benchmark content",
  "source-not-allowed": "Source was not allowed",
  "license-metadata-missing": "Missing license information",
  "consent-metadata-missing": "Missing consent information",
  "source-row-limit": "Source row limit reached",
  "task-relationship-invalid": "Task fields do not form a valid example",
  "label-invalid": "Label is missing or is not allowed",
  "image-annotation-invalid": "Box or mask information is invalid",
};

function qualityStatusLabel(status: DatasetQualityReport["status"]): string {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  return "Needs attention";
}

function supportedSource(item: ThinClientArtifactBrowseItem): boolean {
  return Boolean(
    resolveDatasetPreparationSourceCapability({
      fileName: item.originalName ?? item.storageKey,
      mediaType: item.mediaType,
    }),
  );
}

const splitLabels = (value: string): string[] | undefined => {
  const labels = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return labels.length > 0 ? labels : undefined;
};

interface PersistedStructuredOutputSettings {
  constrainedDecodingPreference?: boolean;
  shapes?: Partial<
    Record<DatasetPreparationTaskType, DatasetPreparationVisualOutputShape>
  >;
}

const structuredOutputStorageKey = (workspaceId: string) =>
  `ai-system-builder.dataset-preparation.structured-output.v1:${workspaceId}`;

function readPersistedStructuredOutputSettings(
  workspaceId: string,
): PersistedStructuredOutputSettings {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(structuredOutputStorageKey(workspaceId)) ??
        "{}",
    ) as Record<string, unknown>;
    return {
      ...(typeof parsed.constrainedDecodingPreference === "boolean"
        ? {
            constrainedDecodingPreference:
              parsed.constrainedDecodingPreference,
          }
        : {}),
      ...(parsed.shapes &&
      typeof parsed.shapes === "object" &&
      !Array.isArray(parsed.shapes)
        ? {
            shapes: parsed.shapes as PersistedStructuredOutputSettings["shapes"],
          }
        : {}),
    };
  } catch {
    return {};
  }
}

function writePersistedStructuredOutputSettings(
  workspaceId: string,
  settings: PersistedStructuredOutputSettings,
): void {
  try {
    window.localStorage.setItem(
      structuredOutputStorageKey(workspaceId),
      JSON.stringify(settings),
    );
  } catch {
    // Persistence is a convenience; preparation remains available without it.
  }
}

function constrainedJsonRecommendationCopy(
  reason:
    | "recommended-cuda"
    | "recommended-cpu"
    | "decoder-unavailable"
    | "schema-unsupported"
    | "snapshot-missing"
    | "snapshot-stale"
    | "model-size-unknown"
    | "capacity-insufficient",
): string {
  if (reason === "recommended-cuda" || reason === "recommended-cpu") {
    return "Recommended for this computer and turned on automatically until you choose otherwise.";
  }
  if (reason === "decoder-unavailable")
    return "Available after the local model tools are ready.";
  if (reason === "schema-unsupported")
    return "This field layout or model mode cannot use this option.";
  if (reason === "snapshot-stale")
    return "The computer check is out of date, so this starts turned off.";
  if (reason === "model-size-unknown")
    return "The model size is unknown, so this starts turned off.";
  if (reason === "capacity-insufficient")
    return "This starts turned off because the selected model may need more capacity.";
  return "Computer capacity has not been confirmed, so this starts turned off.";
}

function buildTaskRecipe(input: {
  taskType: DatasetPreparationTaskType;
  plan: DatasetPreparationExecutionPlan;
  labelSet: string;
  multiLabel: boolean;
  extractionStrictSchema: boolean;
  diffusionConceptKind: "subject" | "style" | "concept";
  diffusionTriggerToken: string;
  diffusionRegularizationClass: string;
  detectionBoxFormat: "coco" | "xyxy" | "xywh";
  segmentationMaskFormat: "png" | "coco-rle" | "polygon";
}): DatasetPreparationTaskRecipe {
  const textInputMode =
    input.plan.generationMode === "none" ? "provided" : "generate";
  const base = createDefaultDatasetPreparationTaskRecipe(input.taskType);
  switch (input.taskType) {
    case "llm-classification":
      return {
        ...base,
        taskType: input.taskType,
        textInputMode,
        labelSet: splitLabels(input.labelSet),
        multiLabel: input.multiLabel,
      } as Extract<
        DatasetPreparationTaskRecipe,
        { taskType: "llm-classification" }
      >;
    case "llm-extraction":
      return {
        ...base,
        taskType: input.taskType,
        textInputMode,
        strictSchema: input.extractionStrictSchema,
      } as Extract<
        DatasetPreparationTaskRecipe,
        { taskType: "llm-extraction" }
      >;
    case "diffusion-lora":
      return {
        ...base,
        taskType: input.taskType,
        textInputMode,
        conceptKind: input.diffusionConceptKind,
        triggerToken: input.diffusionTriggerToken.trim() || undefined,
        regularizationClass:
          input.diffusionRegularizationClass.trim() || undefined,
      } as Extract<
        DatasetPreparationTaskRecipe,
        { taskType: "diffusion-lora" }
      >;
    case "vision-classification":
      return {
        ...base,
        taskType: input.taskType,
        textInputMode,
        labelSet: splitLabels(input.labelSet),
      } as Extract<
        DatasetPreparationTaskRecipe,
        { taskType: "vision-classification" }
      >;
    case "vision-detection":
      return {
        ...base,
        taskType: input.taskType,
        textInputMode,
        labelSet: splitLabels(input.labelSet),
        boxFormat: input.detectionBoxFormat,
      } as Extract<
        DatasetPreparationTaskRecipe,
        { taskType: "vision-detection" }
      >;
    case "vision-segmentation":
      return {
        ...base,
        taskType: input.taskType,
        textInputMode,
        labelSet: splitLabels(input.labelSet),
        maskFormat: input.segmentationMaskFormat,
      } as Extract<
        DatasetPreparationTaskRecipe,
        { taskType: "vision-segmentation" }
      >;
    default:
      return { ...base, textInputMode } as DatasetPreparationTaskRecipe;
  }
}

function buildCommand(
  sourceArtifactIds: string[],
  plan: DatasetPreparationExecutionPlan,
  task: {
    taskType: DatasetPreparationTaskType;
    labelSet: string;
    multiLabel: boolean;
    extractionStrictSchema: boolean;
    diffusionConceptKind: "subject" | "style" | "concept";
    diffusionTriggerToken: string;
    diffusionRegularizationClass: string;
    detectionBoxFormat: "coco" | "xyxy" | "xywh";
    segmentationMaskFormat: "png" | "coco-rle" | "polygon";
  },
  split: { trainRatio: number; validationRatio: number; testRatio: number },
  outputFormat: "parquet" | "jsonl",
  quality: {
    preset: DatasetQualityPreset;
    requireLicenseMetadata: boolean;
    requireConsentMetadata: boolean;
    includeSourceAttribution: boolean;
  },
  structuredOutput: {
    visualShape: DatasetPreparationVisualOutputShape;
    constrainedDecoding: boolean;
    promptTemplate: string;
  },
  adaptive: {
    chunkSize: number;
    chunkOverlap: number;
    maxTokensPerChunk: number;
    topicBoundarySensitivity: number;
    maxSourceSpans: number;
    similarityThreshold: number;
  },
): ApiDatasetPreparationCommand {
  const defaultAdvanced = createDatasetPreparationAdvancedConfigForMethod(
    plan.method,
  );
  const advanced = defaultAdvanced
    ? {
        ...defaultAdvanced,
        content: defaultAdvanced.content
          ? {
              ...defaultAdvanced.content,
              maxTokensPerChunk: adaptive.maxTokensPerChunk,
              maxSourceSpans: adaptive.maxSourceSpans,
              ...(plan.method === "topic-aware"
                ? {
                    semanticBoundaryThreshold:
                      adaptive.topicBoundarySensitivity,
                  }
                : {}),
            }
          : undefined,
        semantic: defaultAdvanced.semantic
          ? {
              ...defaultAdvanced.semantic,
              similarityThreshold: adaptive.similarityThreshold,
            }
          : undefined,
      }
    : undefined;
  const usesDocuments = [
    "fixed-length",
    "topic-aware",
    "structure-aware",
  ].includes(plan.method);
  const usesGeneration = plan.generationMode !== "none";
  const model = resolveDefaultDatasetPreparationTextGenerationModel(
    task.taskType,
  );
  return {
    sourceArtifactIds,
    preparation: plan,
    ...(advanced ? { advanced } : {}),
    recipe: {
      task: buildTaskRecipe({ ...task, plan }),
      ...(usesDocuments
        ? {
            normalization: {
              targetFormat: "markdown" as const,
              normalizationMode: "best-effort" as const,
              unsupportedDocumentPolicy: "fail" as const,
            },
          }
        : {}),
      ...(plan.method === "fixed-length"
        ? {
            chunking: {
              strategy: "character" as const,
              chunkSize: adaptive.chunkSize,
              chunkOverlap: adaptive.chunkOverlap,
              preserveDocumentBoundaries: true,
            },
          }
        : {}),
      ...(usesGeneration
        ? {
            generation: {
              mode: "qa" as const,
              promptTemplate:
                structuredOutput.promptTemplate.trim() ||
                resolveDefaultDatasetPreparationPromptTemplate(task.taskType),
              model: {
                provider: "transformers" as const,
                modelId: model?.modelId ?? "Qwen/Qwen2.5-7B-Instruct",
                inferenceMode: model?.inferenceMode ?? "chat",
                device: model?.device ?? "auto",
                torchDtype: model?.torchDtype ?? "auto",
              },
              failurePolicy: "skip" as const,
              structuredOutput,
            },
          }
        : {}),
    },
    split: {
      ...split,
      shuffle: true,
    },
    output: {
      format: outputFormat,
      destinations: { local: { enabled: true } },
    },
    quality: {
      policy: {
        preset: quality.preset,
        allowedLanguages: ["en"],
        requireLicenseMetadata: quality.requireLicenseMetadata,
        requireConsentMetadata: quality.requireConsentMetadata,
        includeSourceAttribution: quality.includeSourceAttribution,
      },
      reviewRequired: true,
    },
  };
}

export function DatasetPreparationFeature({
  workspaceId,
  artifactClient,
  preparationClient,
}: DatasetPreparationFeatureProps) {
  const browser = useMemo(
    () => artifactClient ?? createApiArtifactBrowserClient(),
    [artifactClient],
  );
  const preparation = useMemo(
    () => preparationClient ?? createApiDatasetPreparationClient(),
    [preparationClient],
  );
  const initialStructuredOutputSettings = useMemo(
    () => readPersistedStructuredOutputSettings(workspaceId),
    [workspaceId],
  );
  const versionService = useMemo(
    () => ({
      list: async (targetWorkspaceId: string, datasetId?: string) =>
        preparation.listVersions
          ? (
              await preparation.listVersions({
                workspaceId: targetWorkspaceId,
                datasetId,
              })
            ).versions
          : [],
      compare: async (
        targetWorkspaceId: string,
        fromVersionId: string,
        toVersionId: string,
      ) => {
        if (!preparation.compareVersions)
          throw new Error("Dataset version comparison is unavailable.");
        return (
          await preparation.compareVersions({
            workspaceId: targetWorkspaceId,
            fromVersionId,
            toVersionId,
          })
        ).comparison;
      },
      reproduce: async (targetWorkspaceId: string, versionId: string) => {
        if (!preparation.readReproduction)
          throw new Error("Saved dataset setup is unavailable.");
        return (
          await preparation.readReproduction({
            workspaceId: targetWorkspaceId,
            versionId,
          })
        ).reproduction;
      },
      publish: async (input: {
        workspaceId: string;
        versionId: string;
        repositoryId: string;
        visibility: "private" | "public";
        createRepository?: boolean;
        publicAccessConfirmed?: true;
      }) => {
        if (!preparation.publishVersion)
          throw new Error("Dataset publishing is unavailable.");
        return (await preparation.publishVersion(input)).publication;
      },
    }),
    [preparation],
  );
  const mounted = useRef(true);
  const suppressNextTaskOutputReset = useRef(false);
  const [artifacts, setArtifacts] = useState<ThinClientArtifactBrowseItem[]>(
    [],
  );
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [activeRequestId, setActiveRequestId] = useState<string>();
  const [result, setResult] = useState<ApiPreparedTrainingDatasetResult>();
  const [qualityReview, setQualityReview] = useState<{
    requestId: string;
    report: DatasetQualityReport;
    advancedReport?: DatasetPreparationAdvancedReport;
  }>();
  const [reviewActionInFlight, setReviewActionInFlight] = useState(false);
  const [taskType, setTaskType] =
    useState<DatasetPreparationTaskType>("llm-instruction");
  const [textGenerationPrompt, setTextGenerationPrompt] = useState(
    () =>
      resolveDefaultDatasetPreparationPromptTemplate("llm-instruction") ?? "",
  );
  const [visualOutputShape, setVisualOutputShape] =
    useState<DatasetPreparationVisualOutputShape>(() => {
      const saved =
        initialStructuredOutputSettings.shapes?.["llm-instruction"];
      const compiled = saved
        ? compileDatasetPreparationVisualOutputShape(saved, {
            taskType: "llm-instruction",
            outputFormat: "parquet",
          })
        : undefined;
      return compiled?.ok
        ? compiled.value.shape
        : createDefaultDatasetPreparationVisualOutputShape(
            "llm-instruction",
          );
    });
  const [constrainedDecodingPreference, setConstrainedDecodingPreference] =
    useState<boolean | undefined>(
      initialStructuredOutputSettings.constrainedDecodingPreference,
    );
  const [generationCapacity, setGenerationCapacity] =
    useState<DatasetPreparationGenerationCapacitySnapshot>();
  const [preparationMethodId, setPreparationMethodId] =
    useState<DatasetPreparationMethodId>();
  const [qualityPreset, setQualityPreset] =
    useState<DatasetQualityPreset>("recommended");
  const [requireLicenseMetadata, setRequireLicenseMetadata] = useState(false);
  const [requireConsentMetadata, setRequireConsentMetadata] = useState(false);
  const [includeSourceAttribution, setIncludeSourceAttribution] =
    useState(false);
  const [labelSet, setLabelSet] = useState("");
  const [multiLabel, setMultiLabel] = useState(false);
  const [extractionStrictSchema, setExtractionStrictSchema] = useState(true);
  const [diffusionConceptKind, setDiffusionConceptKind] = useState<
    "subject" | "style" | "concept"
  >("subject");
  const [diffusionTriggerToken, setDiffusionTriggerToken] = useState("");
  const [diffusionRegularizationClass, setDiffusionRegularizationClass] =
    useState("");
  const [detectionBoxFormat, setDetectionBoxFormat] = useState<
    "coco" | "xyxy" | "xywh"
  >("coco");
  const [segmentationMaskFormat, setSegmentationMaskFormat] = useState<
    "png" | "coco-rle" | "polygon"
  >("png");
  const [chunkSize, setChunkSize] = useState("1000");
  const [chunkOverlap, setChunkOverlap] = useState("200");
  const [maxTokensPerChunk, setMaxTokensPerChunk] = useState("320");
  const [topicBoundarySensitivity, setTopicBoundarySensitivity] =
    useState("0.22");
  const [maxSourceSpans, setMaxSourceSpans] = useState("10000");
  const [similarityThreshold, setSimilarityThreshold] = useState("0.9");
  const [trainRatio, setTrainRatio] = useState("0.8");
  const [validationRatio, setValidationRatio] = useState("0.1");
  const [testRatio, setTestRatio] = useState("0.1");
  const [outputFormat, setOutputFormat] = useState<"parquet" | "jsonl">(
    "parquet",
  );
  const taskOption = getDatasetPreparationTaskOption(taskType);
  const inspectionCopy = getDatasetInspectionCopy(taskType);
  const availableArtifacts = useMemo(
    () =>
      artifacts.filter((artifact) => {
        const readiness = evaluateDatasetPreparationSourceReadiness({
          fileName: artifact.originalName ?? artifact.storageKey,
          mediaType: artifact.mediaType,
          taskType,
        });
        return readiness.ready;
      }),
    [artifacts, taskType],
  );
  const selectedSourceCapabilities = useMemo(
    () =>
      selectedArtifactIds.flatMap((artifactId) => {
        const artifact = artifacts.find(
          (candidate) => candidate.artifactId === artifactId,
        );
        if (!artifact) return [];
        const capability = resolveDatasetPreparationSourceCapability({
          fileName: artifact.originalName ?? artifact.storageKey,
          mediaType: artifact.mediaType,
        });
        return capability ? [capability] : [];
      }) as DatasetPreparationSourceCapability[],
    [artifacts, selectedArtifactIds],
  );
  const preparationResolution = useMemo(
    () =>
      resolveDatasetPreparationAdaptivePlan({
        taskType,
        sources: selectedSourceCapabilities,
      }),
    [selectedSourceCapabilities, taskType],
  );
  const effectivePreparationMethodId =
    preparationMethodId &&
    preparationResolution.methods.some(
      (candidate) => candidate.id === preparationMethodId,
    )
      ? preparationMethodId
      : preparationResolution.defaultMethodId;
  const preparationPlan = useMemo(() => {
    if (
      preparationResolution.status !== "ready" ||
      !effectivePreparationMethodId
    ) {
      return undefined;
    }
    try {
      return createDatasetPreparationExecutionPlan(
        preparationResolution,
        effectivePreparationMethodId,
      );
    } catch {
      return undefined;
    }
  }, [effectivePreparationMethodId, preparationResolution]);
  const preparationMethod = effectivePreparationMethodId
    ? resolveDatasetPreparationMethodOption(
        preparationResolution,
        effectivePreparationMethodId,
      )
    : undefined;
  const generationModel = resolveDefaultDatasetPreparationTextGenerationModel(
    taskType,
  );
  const outputShapeCompilation = useMemo(
    () =>
      compileDatasetPreparationVisualOutputShape(visualOutputShape, {
        taskType,
        outputFormat,
        multiLabel,
        allowedLabels: splitLabels(labelSet),
      }),
    [labelSet, multiLabel, outputFormat, taskType, visualOutputShape],
  );
  const constrainedDecodingAvailable = Boolean(
    preparationPlan &&
      preparationPlan.generationMode !== "none" &&
      generationModel?.inferenceMode !== "text2text" &&
      outputShapeCompilation.ok &&
      outputShapeCompilation.value.decoderCompatible,
  );
  const recommendationCapacity = useMemo(
    () =>
      generationCapacity
        ? {
            ...generationCapacity,
            schemaSupported:
              generationCapacity.schemaSupported &&
              constrainedDecodingAvailable,
          }
        : undefined,
    [constrainedDecodingAvailable, generationCapacity],
  );
  const constrainedJsonResolution = useMemo(
    () =>
      resolveDatasetPreparationConstrainedJson({
        preference: constrainedDecodingPreference,
        selectedDevice: generationModel?.device ?? "auto",
        estimatedModelBytes:
          resolveDatasetPreparationGenerationModelEstimatedBytes(
            generationModel?.modelId,
          ),
        capacity: recommendationCapacity,
      }),
    [
      constrainedDecodingPreference,
      generationModel?.device,
      generationModel?.modelId,
      recommendationCapacity,
    ],
  );
  const constrainedDecodingEnabled =
    constrainedDecodingAvailable && constrainedJsonResolution.enabled;

  useEffect(() => {
    let cancelled = false;
    if (!preparation.readGenerationCapacity) {
      setGenerationCapacity(undefined);
      return () => {
        cancelled = true;
      };
    }
    void preparation
      .readGenerationCapacity({ workspaceId })
      .then((capacity) => {
        if (!cancelled) setGenerationCapacity(capacity);
      })
      .catch(() => {
        if (!cancelled) setGenerationCapacity(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [preparation, workspaceId]);

  useEffect(() => {
    const persisted = readPersistedStructuredOutputSettings(workspaceId);
    setConstrainedDecodingPreference(
      persisted.constrainedDecodingPreference,
    );
    const saved = persisted.shapes?.[taskType];
    const compiled = saved
      ? compileDatasetPreparationVisualOutputShape(saved, {
          taskType,
          outputFormat,
          multiLabel,
          allowedLabels: splitLabels(labelSet),
        })
      : undefined;
    setVisualOutputShape(
      compiled?.ok
        ? compiled.value.shape
        : createDefaultDatasetPreparationVisualOutputShape(taskType, {
            multiLabel,
          }),
    );
  }, [workspaceId]);

  useEffect(() => {
    if (suppressNextTaskOutputReset.current) {
      suppressNextTaskOutputReset.current = false;
      return;
    }
    setTextGenerationPrompt(
      resolveDefaultDatasetPreparationPromptTemplate(taskType) ?? "",
    );
    const persisted = readPersistedStructuredOutputSettings(workspaceId);
    const saved = persisted.shapes?.[taskType];
    const compiled = saved
      ? compileDatasetPreparationVisualOutputShape(saved, {
          taskType,
          outputFormat,
          multiLabel,
          allowedLabels: splitLabels(labelSet),
        })
      : undefined;
    setVisualOutputShape(
      compiled?.ok
        ? compiled.value.shape
        : createDefaultDatasetPreparationVisualOutputShape(taskType, {
            multiLabel,
          }),
    );
  }, [taskType]);

  useEffect(() => {
    if (taskType !== "llm-classification") return;
    setVisualOutputShape((current) => {
      const priorDefault = createDefaultDatasetPreparationVisualOutputShape(
        taskType,
        { multiLabel: !multiLabel },
      );
      return JSON.stringify(current) === JSON.stringify(priorDefault)
        ? createDefaultDatasetPreparationVisualOutputShape(taskType, {
            multiLabel,
          })
        : current;
    });
  }, [multiLabel, taskType]);

  useEffect(() => {
    const persisted = readPersistedStructuredOutputSettings(workspaceId);
    writePersistedStructuredOutputSettings(workspaceId, {
      constrainedDecodingPreference,
      shapes: {
        ...(persisted.shapes ?? {}),
        [taskType]: visualOutputShape,
      },
    });
  }, [
    constrainedDecodingPreference,
    taskType,
    visualOutputShape,
    workspaceId,
  ]);
  const reuseVersionSetup = (
    reproduction: import("../../../../../../modules/contracts/dataset").DatasetVersionReproduction,
  ) => {
    const snapshot = reproduction.recipeSnapshot as any;
    const split = snapshot.split ?? {};
    const output = snapshot.output ?? {};
    const policy = snapshot.effectiveQualityPolicy ?? {};
    const savedTaskType = snapshot.recipe?.task?.taskType;
    const savedStructuredOutput =
      snapshot.recipe?.generation?.structuredOutput ?? {};
    const savedPromptTemplate = snapshot.recipe?.generation?.promptTemplate;
    const savedMethod = snapshot.preparation?.method;
    setSelectedArtifactIds([...reproduction.sourceArtifactIds]);
    if (
      DATASET_PREPARATION_TASK_OPTIONS.some(
        (option) => option.taskType === savedTaskType,
      )
    ) {
      suppressNextTaskOutputReset.current = savedTaskType !== taskType;
      setTaskType(savedTaskType);
    }
    if (
      savedStructuredOutput.visualShape &&
      typeof savedStructuredOutput.visualShape === "object" &&
      DATASET_PREPARATION_TASK_OPTIONS.some(
        (option) => option.taskType === savedTaskType,
      )
    ) {
      const compiled = compileDatasetPreparationVisualOutputShape(
        savedStructuredOutput.visualShape,
        {
          taskType: savedTaskType,
          outputFormat: ["parquet", "jsonl"].includes(output.format)
            ? output.format
            : outputFormat,
          multiLabel,
          allowedLabels: splitLabels(labelSet),
        },
      );
      if (compiled.ok) setVisualOutputShape(compiled.value.shape);
    }
    if (typeof savedStructuredOutput.constrainedDecoding === "boolean")
      setConstrainedDecodingPreference(
        savedStructuredOutput.constrainedDecoding,
      );
    if (typeof savedPromptTemplate === "string")
      setTextGenerationPrompt(savedPromptTemplate);
    if (typeof savedMethod === "string") {
      setPreparationMethodId(savedMethod as DatasetPreparationMethodId);
    }
    if (typeof split.trainRatio === "number")
      setTrainRatio(String(split.trainRatio));
    if (typeof split.validationRatio === "number")
      setValidationRatio(String(split.validationRatio));
    if (typeof split.testRatio === "number")
      setTestRatio(String(split.testRatio));
    if (["parquet", "jsonl"].includes(output.format))
      setOutputFormat(output.format);
    if (["recommended", "strict", "minimal"].includes(policy.preset))
      setQualityPreset(policy.preset);
    if (typeof policy.requireLicenseMetadata === "boolean")
      setRequireLicenseMetadata(policy.requireLicenseMetadata);
    if (typeof policy.requireConsentMetadata === "boolean")
      setRequireConsentMetadata(policy.requireConsentMetadata);
    if (typeof policy.includeSourceAttribution === "boolean")
      setIncludeSourceAttribution(policy.includeSourceAttribution);
    setStatus({ kind: "idle" });
  };

  useEffect(() => {
    mounted.current = true;
    void browser
      .browseArtifacts({ workspaceId })
      .then((items) => {
        if (mounted.current) {
          setArtifacts(items.filter(supportedSource));
        }
      })
      .catch(() => {
        if (mounted.current) {
          setStatus({
            kind: "error",
            message: "Source files could not be loaded. Try again.",
          });
        }
      });
    return () => {
      mounted.current = false;
    };
  }, [browser, workspaceId]);

  const poll = async (requestId: string) => {
    while (mounted.current) {
      const task = await preparation.read({ workspaceId, requestId });
      if (!mounted.current) return;
      if (task.status === "queued" || task.status === "running") {
        const progress =
          typeof task.progress?.processed === "number" &&
          typeof task.progress.total === "number"
            ? " (" + task.progress.processed + "/" + task.progress.total + ")"
            : "";
        setStatus({
          kind: "loading",
          message:
            (task.progress?.message ?? "Preparing dataset...") + progress,
        });
        await waitForNextPoll();
        continue;
      }
      setActiveRequestId(undefined);
      if (task.status === "review-required") {
        if (!task.result.qualityReport || !task.result.review) {
          setStatus({
            kind: "error",
            message:
              "Check results could not be verified. Run preparation again.",
          });
          return;
        }
        setQualityReview({
          requestId,
          report: task.result.qualityReport,
          advancedReport: task.result.advancedReport,
        });
        setStatus({ kind: "idle" });
        return;
      }
      if (task.status === "succeeded") {
        setResult(task.result);
        setStatus({ kind: "success", message: "Training dataset is ready." });
        return;
      }
      if (task.status === "cancelled") {
        setStatus({ kind: "idle", message: "Dataset preparation stopped." });
        return;
      }
      setStatus({
        kind: "error",
        message:
          task.status === "failed"
            ? task.error.message
            : "Dataset preparation could not be found. Start it again.",
      });
      return;
    }
  };

  const start = async () => {
    const parsed = [trainRatio, validationRatio, testRatio].map(Number);
    if (!preparationPlan) {
      setStatus({
        kind: "error",
        message:
          preparationResolution.status === "unsupported"
            ? preparationResolution.message
            : "Choose at least one compatible source file.",
      });
      return;
    }
    if (
      preparationPlan.generationMode !== "none" &&
      !outputShapeCompilation.ok
    ) {
      setStatus({
        kind: "error",
        message:
          outputShapeCompilation.diagnostics[0]?.message ??
          "Review the generated output fields before continuing.",
      });
      return;
    }
    if (
      parsed.some((value) => !Number.isFinite(value) || value < 0) ||
      Math.abs(parsed[0] + parsed[1] + parsed[2] - 1) > 0.000001
    ) {
      setStatus({
        kind: "error",
        message: "Training, validation, and test shares must add up to 1.",
      });
      return;
    }
    const adaptiveValues = {
      chunkSize: Number(chunkSize),
      chunkOverlap: Number(chunkOverlap),
      maxTokensPerChunk: Number(maxTokensPerChunk),
      topicBoundarySensitivity: Number(topicBoundarySensitivity),
      maxSourceSpans: Number(maxSourceSpans),
      similarityThreshold: Number(similarityThreshold),
    };
    if (
      preparationPlan.method === "fixed-length" &&
      (!Number.isInteger(adaptiveValues.chunkSize) ||
        adaptiveValues.chunkSize < 1 ||
        !Number.isInteger(adaptiveValues.chunkOverlap) ||
        adaptiveValues.chunkOverlap < 0 ||
        adaptiveValues.chunkOverlap >= adaptiveValues.chunkSize)
    ) {
      setStatus({
        kind: "error",
        message:
          "Section length must be a positive whole number, and overlap must be smaller.",
      });
      return;
    }
    if (
      (preparationPlan.method === "topic-aware" ||
        preparationPlan.method === "structure-aware") &&
      (!Number.isInteger(adaptiveValues.maxTokensPerChunk) ||
        adaptiveValues.maxTokensPerChunk < 32 ||
        !Number.isInteger(adaptiveValues.maxSourceSpans) ||
        adaptiveValues.maxSourceSpans < 1 ||
        adaptiveValues.similarityThreshold <= 0 ||
        adaptiveValues.similarityThreshold > 1 ||
        (preparationPlan.method === "topic-aware" &&
          (adaptiveValues.topicBoundarySensitivity <= 0 ||
            adaptiveValues.topicBoundarySensitivity >= 1)))
    ) {
      setStatus({
        kind: "error",
        message:
          "Review the selected method's advanced limits before continuing.",
      });
      return;
    }
    setResult(undefined);
    setQualityReview(undefined);
    setStatus({ kind: "loading", message: "Starting dataset preparation..." });
    try {
      const started = await preparation.start({
        workspaceId,
        command: buildCommand(
          selectedArtifactIds,
          preparationPlan,
          {
            taskType,
            labelSet,
            multiLabel,
            extractionStrictSchema,
            diffusionConceptKind,
            diffusionTriggerToken,
            diffusionRegularizationClass,
            detectionBoxFormat,
            segmentationMaskFormat,
          },
          {
            trainRatio: parsed[0],
            validationRatio: parsed[1],
            testRatio: parsed[2],
          },
          outputFormat,
          {
            preset: qualityPreset,
            requireLicenseMetadata,
            requireConsentMetadata,
            includeSourceAttribution,
          },
          {
            visualShape: visualOutputShape,
            constrainedDecoding: constrainedDecodingEnabled,
            promptTemplate: textGenerationPrompt,
          },
          adaptiveValues,
        ),
      });
      setActiveRequestId(started.requestId);
      await poll(started.requestId);
    } catch (error) {
      if (mounted.current) {
        setActiveRequestId(undefined);
        setStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Dataset preparation could not be started.",
        });
      }
    }
  };

  const cancel = async () => {
    if (!activeRequestId) return;
    try {
      await preparation.cancel({ workspaceId, requestId: activeRequestId });
      setActiveRequestId(undefined);
      setStatus({ kind: "idle", message: "Dataset preparation stopped." });
    } catch {
      setStatus({
        kind: "error",
        message: "Dataset preparation could not be stopped. Try again.",
      });
    }
  };

  const approveReview = async () => {
    if (!qualityReview || reviewActionInFlight) return;
    setReviewActionInFlight(true);
    try {
      const approved = await preparation.approve({
        workspaceId,
        requestId: qualityReview.requestId,
        reportFingerprint: qualityReview.report.reportFingerprint,
      });
      setResult(approved.result);
      setQualityReview(undefined);
      setStatus({ kind: "success", message: "Training dataset is ready." });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The reviewed dataset could not be saved.",
      });
    } finally {
      setReviewActionInFlight(false);
    }
  };

  const discardReview = async () => {
    if (!qualityReview || reviewActionInFlight) return;
    setReviewActionInFlight(true);
    try {
      await preparation.cancel({
        workspaceId,
        requestId: qualityReview.requestId,
      });
      setQualityReview(undefined);
      setStatus({ kind: "idle" });
    } catch {
      setStatus({
        kind: "error",
        message: "The review could not be discarded. Try again.",
      });
    } finally {
      setReviewActionInFlight(false);
    }
  };

  const toggleArtifact = (artifactId: string) => {
    setSelectedArtifactIds((current) =>
      current.includes(artifactId)
        ? current.filter((candidate) => candidate !== artifactId)
        : [...current, artifactId],
    );
  };

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
        <WorkflowSequence ariaLabel="Dataset preparation workflow">
          <WorkflowStep
            title="Add data"
            description="Choose the training goal first, then select compatible existing datasets or source material."
          >
            <label className="ui-stack ui-stack--sm">
              <span>Training goal</span>
              <select
                className="ui-input"
                value={taskType}
                disabled={status.kind === "loading"}
                onChange={(event) => {
                  setTaskType(event.target.value as DatasetPreparationTaskType);
                  setSelectedArtifactIds([]);
                  setPreparationMethodId(undefined);
                }}
              >
                {DATASET_PREPARATION_TASK_OPTIONS.map((option) => (
                  <option key={option.taskType} value={option.taskType}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="ui-text-muted">{taskOption.description}</small>
            </label>
            {availableArtifacts.length === 0 ? (
              <p className="ui-text-muted">
                Add a compatible dataset or source file in Artifact Ingestion
                first.
              </p>
            ) : (
              <div className="ui-stack ui-stack--sm">
                {availableArtifacts.map((artifact) => (
                  <label key={artifact.artifactId}>
                    <input
                      type="checkbox"
                      checked={selectedArtifactIds.includes(
                        artifact.artifactId,
                      )}
                      disabled={status.kind === "loading"}
                      onChange={() => toggleArtifact(artifact.artifactId)}
                    />{" "}
                    {artifact.originalName ?? artifact.storageKey}
                  </label>
                ))}
              </div>
            )}
          </WorkflowStep>
          <WorkflowStep
            title="Check data"
            description="Choose how carefully examples are checked before review."
          >
            <strong>
              {preparationResolution.status === "ready"
                ? "Ready to prepare"
                : preparationResolution.status === "unsupported"
                  ? "Selection needs attention"
                  : "Choose at least one source file"}
            </strong>
            <p className="ui-text-muted">
              {preparationResolution.message}
              {preparationResolution.action
                ? ` ${preparationResolution.action}`
                : ""}
            </p>
            <p>
              <strong>What is checked:</strong> {inspectionCopy.checked}
            </p>
            <p className="ui-text-muted">
              <strong>Important limit:</strong> {inspectionCopy.limitation}
            </p>
            <p className="ui-text-muted">
              Every accepted training example must remain linked to its source.
            </p>
            <label className="ui-stack ui-stack--sm">
              <span>Data checks</span>
              <select
                className="ui-input"
                value={qualityPreset}
                disabled={status.kind === "loading"}
                onChange={(event) =>
                  setQualityPreset(event.target.value as DatasetQualityPreset)
                }
              >
                <option value="recommended">Standard</option>
                <option value="strict">Strict</option>
              </select>
              <small className="ui-text-muted">
                {qualityPreset === "strict"
                  ? "Completes all standard checks, but uses narrower text-length limits and searches more broadly for similar examples. It may set aside more data for review."
                  : "Checks task fields, source links, duplicates, common personal-data and credential-like text patterns, and split safety."}
              </small>
            </label>
            <details>
              <summary>Advanced data rules</summary>
              <div className="ui-stack ui-stack--sm">
                <label>
                  <input
                    type="checkbox"
                    checked={requireLicenseMetadata}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setRequireLicenseMetadata(event.target.checked)
                    }
                  />{" "}
                  Require license information for every training example
                </label>
                <small className="ui-text-muted">
                  The source record must identify the license that allows the
                  example to be used.
                </small>
                <label>
                  <input
                    type="checkbox"
                    checked={requireConsentMetadata}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setRequireConsentMetadata(event.target.checked)
                    }
                  />{" "}
                  Require consent information for every training example
                </label>
                <small className="ui-text-muted">
                  The source record must identify the permission or consent
                  basis when the material requires it.
                </small>
                <label>
                  <input
                    type="checkbox"
                    checked={includeSourceAttribution}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setIncludeSourceAttribution(event.target.checked)
                    }
                  />{" "}
                  Include source attribution with each example
                </label>
                <small className="ui-text-muted">
                  Adds the source ID and any available source name, public
                  link, author, and license beside every saved example.
                </small>
              </div>
            </details>
          </WorkflowStep>
          <WorkflowStep
            title="Prepare dataset"
            description="The available preparation method and advanced settings adapt to the selected goal and source role."
          >
            {preparationResolution.inputIntent ? (
              <section className="ui-stack ui-stack--sm" role="status">
                <strong>
                  {
                    getDatasetPreparationIntentCopy(
                      preparationResolution.inputIntent,
                    ).label
                  }
                </strong>
                <p className="ui-text-muted">
                  {
                    getDatasetPreparationIntentCopy(
                      preparationResolution.inputIntent,
                    ).description
                  }
                </p>
              </section>
            ) : null}
            {preparationResolution.methods.length > 1 ? (
              <label className="ui-stack ui-stack--sm">
                <span>Preparation method</span>
                <select
                  className="ui-input"
                  value={effectivePreparationMethodId}
                  disabled={status.kind === "loading"}
                  onChange={(event) =>
                    setPreparationMethodId(
                      event.target.value as DatasetPreparationMethodId,
                    )
                  }
                >
                  {preparationResolution.methods.map((option) => (
                    <option key={option.id} value={option.id}>
                      {getDatasetPreparationMethodCopy(option.id).label}
                    </option>
                  ))}
                </select>
                <small className="ui-text-muted">
                  {effectivePreparationMethodId
                    ? getDatasetPreparationMethodCopy(
                        effectivePreparationMethodId,
                      ).description
                    : ""}
                </small>
              </label>
            ) : preparationMethod ? (
              <section className="ui-stack ui-stack--sm">
                <strong>
                  {getDatasetPreparationMethodCopy(preparationMethod.id).label}
                </strong>
                <p className="ui-text-muted">
                  {
                    getDatasetPreparationMethodCopy(preparationMethod.id)
                      .description
                  }
                </p>
              </section>
            ) : null}
            {preparationPlan && preparationPlan.generationMode !== "none" ? (
              <p className="ui-text-muted">
                A task-specific local model creates candidate examples. The
                candidates are checked and require review before saving.
              </p>
            ) : null}
            {preparationPlan?.method === "structure-aware" ? (
              <p className="ui-text-muted">
                Scanned-image text recognition is not included. Use a text-based
                PDF or add reviewed text first.
              </p>
            ) : null}
            {taskType === "llm-classification" ||
            taskType === "vision-classification" ||
            taskType === "vision-detection" ||
            taskType === "vision-segmentation" ? (
              <label className="ui-stack ui-stack--sm">
                <span>Allowed labels</span>
                <input
                  className="ui-input"
                  value={labelSet}
                  disabled={status.kind === "loading"}
                  placeholder="billing, account help, bug report"
                  onChange={(event) => setLabelSet(event.target.value)}
                />
                <small className="ui-text-muted">
                  Optional comma-separated labels. When supplied, other labels
                  are set aside for review.
                </small>
              </label>
            ) : null}
            {taskType === "llm-classification" ? (
              <label>
                <input
                  type="checkbox"
                  checked={multiLabel}
                  disabled={status.kind === "loading"}
                  onChange={(event) => setMultiLabel(event.target.checked)}
                />{" "}
                Allow more than one label per example
              </label>
            ) : null}
            {taskType === "llm-extraction" ? (
              <label>
                <input
                  type="checkbox"
                  checked={extractionStrictSchema}
                  disabled={status.kind === "loading"}
                  onChange={(event) =>
                    setExtractionStrictSchema(event.target.checked)
                  }
                />{" "}
                Require every extracted result to match the saved field layout
              </label>
            ) : null}
            {taskType === "diffusion-lora" ? (
              <div className="ui-grid ui-grid--two">
                <label>
                  What the images teach
                  <select
                    className="ui-input"
                    value={diffusionConceptKind}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setDiffusionConceptKind(
                        event.target.value as "subject" | "style" | "concept",
                      )
                    }
                  >
                    <option value="subject">Subject</option>
                    <option value="style">Style</option>
                    <option value="concept">Concept</option>
                  </select>
                </label>
                <label>
                  Optional trigger word
                  <input
                    className="ui-input"
                    value={diffusionTriggerToken}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setDiffusionTriggerToken(event.target.value)
                    }
                  />
                </label>
                <label>
                  Optional general class
                  <input
                    className="ui-input"
                    value={diffusionRegularizationClass}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setDiffusionRegularizationClass(event.target.value)
                    }
                  />
                </label>
              </div>
            ) : null}
            {taskType === "vision-detection" ? (
              <label>
                Box format
                <select
                  className="ui-input"
                  value={detectionBoxFormat}
                  disabled={status.kind === "loading"}
                  onChange={(event) =>
                    setDetectionBoxFormat(
                      event.target.value as "coco" | "xyxy" | "xywh",
                    )
                  }
                >
                  <option value="coco">COCO</option>
                  <option value="xyxy">Corner coordinates</option>
                  <option value="xywh">Position, width, and height</option>
                </select>
              </label>
            ) : null}
            {taskType === "vision-segmentation" ? (
              <label>
                Mask format
                <select
                  className="ui-input"
                  value={segmentationMaskFormat}
                  disabled={status.kind === "loading"}
                  onChange={(event) =>
                    setSegmentationMaskFormat(
                      event.target.value as "png" | "coco-rle" | "polygon",
                    )
                  }
                >
                  <option value="png">PNG mask</option>
                  <option value="coco-rle">COCO run-length data</option>
                  <option value="polygon">Polygon points</option>
                </select>
              </label>
            ) : null}
            {preparationPlan &&
            preparationPlan.generationMode !== "none" ? (
              <section className="ui-stack ui-stack--sm">
                <h3>Generation prompt</h3>
                <label className="ui-stack ui-stack--sm">
                  <span>System prompt instructions</span>
                  <textarea
                    className="ui-input"
                    value={textGenerationPrompt}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setTextGenerationPrompt(event.target.value)
                    }
                    rows={6}
                  />
                </label>
                <small className="ui-text-muted">
                  Tell the local model what to create and how to use the source.
                  Configure the exact output fields below; Instruction is copied
                  exactly, and Context is attached unchanged from the source
                  section. Built-in safety, source-grounding, and JSON-only rules
                  still apply.
                </small>
                <DatasetPreparationOutputShapeEditor
                  idPrefix="thin-dataset-preparation-output"
                  taskType={taskType}
                  shape={visualOutputShape}
                  outputFormat={outputFormat}
                  allowedLabels={splitLabels(labelSet)}
                  multiLabel={multiLabel}
                  includeSourceAttribution={includeSourceAttribution}
                  disabled={status.kind === "loading"}
                  onChange={setVisualOutputShape}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={constrainedDecodingEnabled}
                    disabled={
                      status.kind === "loading" ||
                      !constrainedDecodingAvailable
                    }
                    onChange={(event) =>
                      setConstrainedDecodingPreference(event.target.checked)
                    }
                  />{" "}
                  Keep generated JSON well structured
                </label>
                <small className="ui-text-muted">
                  When enabled, the local model follows the field layout while
                  it writes each example. {" "}
                  {constrainedJsonRecommendationCopy(
                    constrainedJsonResolution.recommendationReason,
                  )}
                </small>
              </section>
            ) : null}
            <details>
              <summary>Advanced settings</summary>
              <div className="ui-grid ui-grid--two">
                {preparationPlan?.method === "fixed-length" ? (
                  <>
                    <label>
                      Section length
                      <input
                        className="ui-input"
                        value={chunkSize}
                        disabled={status.kind === "loading"}
                        onChange={(event) => setChunkSize(event.target.value)}
                      />
                    </label>
                    <label>
                      Overlap between sections
                      <input
                        className="ui-input"
                        value={chunkOverlap}
                        disabled={status.kind === "loading"}
                        onChange={(event) =>
                          setChunkOverlap(event.target.value)
                        }
                      />
                    </label>
                  </>
                ) : null}
                {preparationPlan?.method === "topic-aware" ||
                preparationPlan?.method === "structure-aware" ? (
                  <>
                    <label>
                      Maximum section length
                      <input
                        className="ui-input"
                        value={maxTokensPerChunk}
                        disabled={status.kind === "loading"}
                        onChange={(event) =>
                          setMaxTokensPerChunk(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Maximum source sections
                      <input
                        className="ui-input"
                        value={maxSourceSpans}
                        disabled={status.kind === "loading"}
                        onChange={(event) =>
                          setMaxSourceSpans(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Similar-example threshold
                      <input
                        className="ui-input"
                        value={similarityThreshold}
                        disabled={status.kind === "loading"}
                        onChange={(event) =>
                          setSimilarityThreshold(event.target.value)
                        }
                      />
                    </label>
                  </>
                ) : null}
                {preparationPlan?.method === "topic-aware" ? (
                  <label>
                    Topic-change sensitivity
                    <input
                      className="ui-input"
                      value={topicBoundarySensitivity}
                      disabled={status.kind === "loading"}
                      onChange={(event) =>
                        setTopicBoundarySensitivity(event.target.value)
                      }
                    />
                  </label>
                ) : null}
                <label>
                  Training share
                  <input
                    className="ui-input"
                    value={trainRatio}
                    disabled={status.kind === "loading"}
                    onChange={(event) => setTrainRatio(event.target.value)}
                  />
                </label>
                <label>
                  Validation share
                  <input
                    className="ui-input"
                    value={validationRatio}
                    disabled={status.kind === "loading"}
                    onChange={(event) => setValidationRatio(event.target.value)}
                  />
                </label>
                <label>
                  Test share
                  <input
                    className="ui-input"
                    value={testRatio}
                    disabled={status.kind === "loading"}
                    onChange={(event) => setTestRatio(event.target.value)}
                  />
                </label>
                <label>
                  Saved file format
                  <select
                    className="ui-input"
                    value={outputFormat}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setOutputFormat(event.target.value as "parquet" | "jsonl")
                    }
                  >
                    <option value="parquet">Parquet</option>
                    <option value="jsonl">JSON Lines</option>
                  </select>
                </label>
              </div>
            </details>
          </WorkflowStep>
          <WorkflowStep
            title="Review and create"
            description={`Review the checks, then create the ${taskOption.label.toLowerCase()} dataset.`}
          >
            {qualityReview ? (
              <section
                className="ui-stack ui-stack--sm"
                aria-labelledby="thin-dataset-quality-review-title"
              >
                <h3 id="thin-dataset-quality-review-title">Check results</h3>
                <strong role="status">
                  {qualityStatusLabel(qualityReview.report.status)}
                </strong>
                <dl className="ui-grid ui-grid--two">
                  <dt>Examples checked</dt>
                  <dd>{qualityReview.report.counts.inputRows}</dd>
                  <dt>Examples ready</dt>
                  <dd>{qualityReview.report.counts.acceptedRows}</dd>
                  <dt>Examples set aside</dt>
                  <dd>{qualityReview.report.counts.quarantinedRows}</dd>
                </dl>
                {qualityReview.report.inspection ? (
                  <div className="ui-stack ui-stack--sm">
                    <strong>Inspection coverage</strong>
                    <p className="ui-text-muted">
                      Checked:{" "}
                      {qualityReview.report.inspection.checkedSurfaces.join(
                        ", ",
                      )}
                      .
                    </p>
                    {qualityReview.report.inspection.limitations.map(
                      (limitation) => (
                        <p className="ui-text-muted" key={limitation}>
                          {limitation}
                        </p>
                      ),
                    )}
                  </div>
                ) : null}
                {qualityReview.advancedReport ? (
                  <section
                    className="ui-stack ui-stack--sm"
                    aria-labelledby="thin-dataset-advanced-review-title"
                  >
                    <h4 id="thin-dataset-advanced-review-title">
                      Preparation checks
                    </h4>
                    <dl className="ui-grid ui-grid--two">
                      {qualityReview.advancedReport.content ? (
                        <>
                          <dt>Source sections kept</dt>
                          <dd>
                            {
                              qualityReview.advancedReport.content
                                .sourceSpanCount
                            }
                          </dd>
                          <dt>Reading quality</dt>
                          <dd>
                            {Math.round(
                              qualityReview.advancedReport.content
                                .meanExtractionQuality * 100,
                            )}
                            %
                          </dd>
                        </>
                      ) : null}
                      {qualityReview.advancedReport.semantic ? (
                        <>
                          <dt>Related examples set aside</dt>
                          <dd>
                            {
                              qualityReview.advancedReport.semantic
                                .duplicateRowCount
                            }
                          </dd>
                          <dt>Source coverage</dt>
                          <dd>
                            {Math.round(
                              qualityReview.advancedReport.semantic
                                .coverageScore * 100,
                            )}
                            %
                          </dd>
                          <dt>Useful contrast suggestions</dt>
                          <dd>
                            {
                              qualityReview.advancedReport.semantic
                                .hardNegativeRecommendationCount
                            }
                          </dd>
                        </>
                      ) : null}
                      {qualityReview.advancedReport.synthetic ? (
                        <>
                          <dt>Generated examples checked</dt>
                          <dd>
                            {
                              qualityReview.advancedReport.synthetic
                                .generatedCandidateCount
                            }
                          </dd>
                          <dt>Generated examples ready</dt>
                          <dd>
                            {
                              qualityReview.advancedReport.synthetic
                                .admittedCandidateCount
                            }
                          </dd>
                          <dt>Generated examples set aside</dt>
                          <dd>
                            {
                              qualityReview.advancedReport.synthetic
                                .quarantinedCandidateCount
                            }
                          </dd>
                          <dt>Source support</dt>
                          <dd>
                            {Math.round(
                              qualityReview.advancedReport.synthetic
                                .meanGroundingScore * 100,
                            )}
                            %
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </section>
                ) : null}
                {Object.keys(qualityReview.report.reasonCounts).length > 0 ? (
                  <ul>
                    {Object.entries(qualityReview.report.reasonCounts).map(
                      ([reason, count]) => (
                        <li key={reason}>
                          {QUALITY_REASON_LABELS[reason] ?? "Other data issue"}:{" "}
                          {count}
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p className="ui-text-muted">
                    No examples were set aside by the selected checks.
                  </p>
                )}
                {qualityReview.report.samples.length > 0 ? (
                  <details>
                    <summary>Advanced details</summary>
                    <p className="ui-text-muted">
                      These short examples are limited and cleaned to avoid
                      showing source values.
                    </p>
                    <ul>
                      {qualityReview.report.samples.map((sample) => (
                        <li
                          key={`${sample.sourceArtifactId}:${sample.sourceRowIndex}:${sample.reasonCodes.join(",")}`}
                        >
                          {sample.summary}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <button
                  className="ui-button"
                  type="button"
                  disabled={
                    reviewActionInFlight ||
                    !qualityReview.report.approvalAllowed
                  }
                  onClick={() => void approveReview()}
                >
                  {reviewActionInFlight
                    ? "Saving..."
                    : "Approve and save dataset"}
                </button>
                <button
                  className="ui-button"
                  type="button"
                  disabled={reviewActionInFlight}
                  onClick={() => void discardReview()}
                >
                  Discard review
                </button>
                {!qualityReview.report.approvalAllowed ? (
                  <p role="alert">
                    This dataset cannot be saved. Adjust the source data or
                    rules, then run the checks again.
                  </p>
                ) : null}
              </section>
            ) : null}
            <button
              className="ui-button"
              type="button"
              disabled={
                selectedArtifactIds.length === 0 ||
                !preparationPlan ||
                status.kind === "loading" ||
                qualityReview !== undefined
              }
              onClick={() => void start()}
            >
              {status.kind === "loading"
                ? "Preparing..."
                : "Run checks and prepare"}
            </button>
            {activeRequestId ? (
              <button
                className="ui-button"
                type="button"
                onClick={() => void cancel()}
              >
                Stop preparation
              </button>
            ) : null}
          </WorkflowStep>
        </WorkflowSequence>

        {status.message && status.kind !== "success" ? (
          <p role={status.kind === "error" ? "alert" : "status"}>
            {status.message}
          </p>
        ) : null}
        <TransientNotificationPublisher
          message={status.kind === "success" ? status.message : undefined}
          title="Dataset preparation"
          tone="success"
          source="Dataset Preparation"
          workspaceId={workspaceId}
        />
        {result ? (
          <div className="ui-stack ui-stack--sm">
            <h3>Dataset ready</h3>
            <dl className="ui-grid ui-grid--two">
              <dt>Total rows</dt>
              <dd>{result.summary.datasetRowCount}</dd>
              <dt>Training rows</dt>
              <dd>{result.summary.trainRowCount}</dd>
              <dt>Validation rows</dt>
              <dd>{result.summary.validationRowCount ?? 0}</dd>
              <dt>Test rows</dt>
              <dd>{result.summary.testRowCount}</dd>
              <dt>Saved as</dt>
              <dd>
                {result.outputs.local?.dataset?.storage.key ??
                  "External destination"}
              </dd>
            </dl>
            {result.warnings?.length ? (
              <>
                <h4>Needs attention</h4>
                <ul>
                  {result.warnings.map((warning) => (
                    <li key={warning.code + warning.message}>
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
        {preparation.listVersions ? (
          <DatasetVersionPanel
            workspaceId={workspaceId}
            currentVersionId={result?.datasetVersion?.versionId}
            datasetId={result?.datasetVersion?.datasetId}
            service={versionService}
            onReuse={reuseVersionSetup}
          />
        ) : null}
      </div>
    </section>
  );
}
