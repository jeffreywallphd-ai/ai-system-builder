import { useMemo, useState, type ReactNode } from "react";

import {
  createDesktopDatasetPreparationClient,
  type DesktopDatasetPreparationClient,
} from "../api/desktopDatasetPreparationClient";
import type { DesktopPythonRuntimeClient } from "../../python-runtime/api/desktopPythonRuntimeClient";
import type { DesktopModelsClient } from "../../models/api/desktopModelsClient";
import type { DesktopApplicationSettingsClient } from "../../settings";
import {
  ApplicationIcon,
  EmptyState,
  PanelHeading,
  TermWithHint,
  TransientNotificationPublisher,
  TypeBadge,
  useOptionalNotificationCenter,
  DatasetVersionPanel,
  DatasetPreparationOutputShapeEditor,
  WorkflowSequence,
  WorkflowStep,
  getDatasetInspectionCopy,
  getDatasetPreparationIntentCopy,
  getDatasetPreparationMethodCopy,
} from "../../../../../../../modules/ui/shared";
import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { useDatasetPreparationFeature } from "../hooks/useDatasetPreparationFeature";
import {
  DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS,
  type DatasetPreparationMethodId,
} from "../../../../../../../modules/contracts/runtime";
import {
  DATASET_PREPARATION_TASK_PROFILE_OPTIONS,
  getDatasetPreparationTaskProfileOption,
} from "../profiles/datasetPreparationTaskProfiles";

export interface DatasetPreparationFeatureProps {
  onPrepared?: () => void;
  client?: DesktopDatasetPreparationClient;
  settingsClient?: DesktopApplicationSettingsClient;
  modelsClient?: DesktopModelsClient;
  runtimeStatusClient?: Pick<
    DesktopPythonRuntimeClient,
    "readStatus" | "controlRuntime"
  >;
  workspaceId?: string;
  workspaceName?: string;
}

const QUALITY_REASON_LABELS: Record<string, string> = {
  "mapping-required-fields-missing": "Required columns were not found",
  "schema-invalid": "Required values were missing or invalid",
  "task-relationship-invalid": "Task values did not form a usable example",
  "label-invalid": "Label did not match the selected task settings",
  "image-annotation-invalid": "Box or mask structure was invalid",
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
};

function qualityStatusLabel(status: "ready" | "needs-attention" | "blocked") {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  return "Needs attention";
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
    return "Recommended for this computer. It is turned on automatically until you choose a different setting.";
  }
  if (reason === "decoder-unavailable") {
    return "This option will be available after the local model tools are ready.";
  }
  if (reason === "schema-unsupported") {
    return "This field layout or model mode cannot use this option.";
  }
  if (reason === "snapshot-stale") {
    return "The computer check is out of date, so this option starts turned off.";
  }
  if (reason === "model-size-unknown") {
    return "The model size is unknown, so this option starts turned off.";
  }
  if (reason === "capacity-insufficient") {
    return "This option starts turned off because the selected model may need more memory or processing capacity.";
  }
  return "Computer capacity has not been confirmed, so this option starts turned off.";
}

export function DatasetPreparationFeature({
  onPrepared,
  client,
  settingsClient,
  modelsClient,
  runtimeStatusClient,
  workspaceId,
}: DatasetPreparationFeatureProps) {
  const notifications = useOptionalNotificationCenter();
  const {
    artifacts,
    allArtifactCount,
    filteredArtifacts,
    uploadedArtifacts,
    generatedArtifacts,
    selectedArtifactStorageFilter,
    selectedArtifactIds,
    preparationResolution,
    preparationPlan,
    preparationMethodId,
    taskType,
    labelSet,
    multiLabel,
    extractionStrictSchema,
    diffusionConceptKind,
    diffusionTriggerToken,
    diffusionRegularizationClass,
    detectionBoxFormat,
    segmentationMaskFormat,
    textGenerationPrompt,
    visualOutputShape,
    constrainedJsonResolution,
    constrainedDecodingEnabled,
    constrainedDecodingAvailable,
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    maxTokensPerChunk,
    topicBoundarySensitivity,
    maxSourceSpans,
    similarityThreshold,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
    modelMemoryOverflowPolicy,
    maxExamplesPerChunk,
    batchSize,
    failurePolicy,
    generationTemperature,
    generationTopP,
    generationMaxNewTokens,
    trainRatio,
    validationRatio,
    testRatio,
    seed,
    shuffle,
    outputFormat,
    outputBaseName,
    localDestinationEnabled,
    huggingFaceDestinationEnabled,
    huggingFaceRepository,
    huggingFaceRevision,
    huggingFacePathPrefix,
    qualityPreset,
    requireLicenseMetadata,
    requireConsentMetadata,
    includeSourceAttribution,
    defaultHuggingFaceNamespace,
    status,
    resultSummary,
    qualityReview,
    reviewActionInFlight,
    canUnloadModel,
    stopTrainingInFlight,
    unloadModelInFlight,
    selectedGenerationModelAvailable,
    generationModelAvailabilityChecked,
    modelDownloadInFlight,
    modelDownloadStatus,
    savedTrainingSettings,
    selectedSavedTrainingSettingsId,
    hasTrainingSettingsChanges,
    onToggleArtifact,
    setPreparationMethodId,
    setSelectedArtifactStorageFilter,
    setTaskType,
    setLabelSet,
    setMultiLabel,
    setExtractionStrictSchema,
    setDiffusionConceptKind,
    setDiffusionTriggerToken,
    setDiffusionRegularizationClass,
    setDetectionBoxFormat,
    setSegmentationMaskFormat,
    setTextGenerationPrompt,
    setVisualOutputShape,
    setConstrainedDecodingPreference,
    setUnsupportedDocumentPolicy,
    setNormalizationMode,
    setChunkSize,
    setChunkOverlap,
    setPreserveDocumentBoundaries,
    setMaxChunkCount,
    setMaxTokensPerChunk,
    setTopicBoundarySensitivity,
    setMaxSourceSpans,
    setSimilarityThreshold,
    setModelId,
    setModelInferenceMode,
    setModelDevice,
    setModelTorchDtype,
    setModelMemoryOverflowPolicy,
    setMaxExamplesPerChunk,
    setBatchSize,
    setFailurePolicy,
    setGenerationTemperature,
    setGenerationTopP,
    setGenerationMaxNewTokens,
    setTrainRatio,
    setValidationRatio,
    setTestRatio,
    setSeed,
    setShuffle,
    setOutputFormat,
    setOutputBaseName,
    setLocalDestinationEnabled,
    setHuggingFaceDestinationEnabled,
    setHuggingFaceRepository,
    setHuggingFaceRevision,
    setHuggingFacePathPrefix,
    setQualityPreset,
    setRequireLicenseMetadata,
    setRequireConsentMetadata,
    setIncludeSourceAttribution,
    setSelectedSavedTrainingSettingsId,
    onSubmit,
    onStopTraining,
    onApproveReview,
    onDiscardReview,
    onUnloadModel,
    onDownloadGenerationModel,
    onSaveTrainingSettings,
    onLoadTrainingSettings,
    onReuseDatasetVersion,
  } = useDatasetPreparationFeature({
    client,
    settingsClient,
    modelsClient,
    runtimeStatusClient,
    onPrepared,
    workspaceId,
  });
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>(
    {},
  );
  const versionClient = useMemo(
    () => client ?? createDesktopDatasetPreparationClient(),
    [client],
  );
  const versionService = useMemo(
    () => ({
      list: (targetWorkspaceId: string, targetDatasetId?: string) =>
        versionClient.listVersions?.(targetWorkspaceId, targetDatasetId) ??
        Promise.resolve([]),
      compare: (
        targetWorkspaceId: string,
        fromVersionId: string,
        toVersionId: string,
      ) =>
        versionClient.compareVersions?.(
          targetWorkspaceId,
          fromVersionId,
          toVersionId,
        ) ??
        Promise.reject(new Error("Dataset version comparison is unavailable.")),
      reproduce: (targetWorkspaceId: string, versionId: string) =>
        versionClient.readReproduction?.(targetWorkspaceId, versionId) ??
        Promise.reject(new Error("Saved dataset setup is unavailable.")),
      publish: (
        input: Parameters<
          NonNullable<DesktopDatasetPreparationClient["publishVersion"]>
        >[0],
      ) =>
        versionClient.publishVersion?.(input) ??
        Promise.reject(new Error("Dataset publishing is unavailable.")),
    }),
    [versionClient],
  );
  const transientStatusMessage = [
    "Training settings saved.",
    "Model unloaded from memory.",
  ].includes(status.message ?? "");
  const formLocked = status.kind === "loading";
  const configuredLabels = useMemo(() => {
    const labels = labelSet
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    return labels.length > 0 ? labels : undefined;
  }, [labelSet]);
  const showUploadedArtifacts = selectedArtifactStorageFilter !== "generated";
  const showGeneratedArtifacts = selectedArtifactStorageFilter !== "uploaded";
  const selectedTaskProfile = getDatasetPreparationTaskProfileOption(taskType);
  const isSelectedTaskAvailable =
    selectedTaskProfile.runtimeSupport === "supported";
  const isModelTextGenerationEnabled =
    preparationPlan?.generationMode !== undefined &&
    preparationPlan.generationMode !== "none";
  const usesDocumentPreparation =
    preparationMethodId === "fixed-length" ||
    preparationMethodId === "topic-aware" ||
    preparationMethodId === "structure-aware";
  const usesFixedSections = preparationMethodId === "fixed-length";
  const usesTopicSections = preparationMethodId === "topic-aware";
  const usesAdaptiveSections =
    usesTopicSections || preparationMethodId === "structure-aware";
  const inspectionCopy = getDatasetInspectionCopy(taskType);
  const showGenerationModelDownload =
    isModelTextGenerationEnabled &&
    generationModelAvailabilityChecked &&
    modelId.trim().length > 0 &&
    !selectedGenerationModelAvailable;
  const supportsAllowedLabels =
    taskType === "llm-classification" ||
    taskType === "vision-classification" ||
    taskType === "vision-detection" ||
    taskType === "vision-segmentation";
  const hasTaskSettings =
    supportsAllowedLabels ||
    taskType === "llm-extraction" ||
    taskType === "diffusion-lora";
  const isTextTask = taskType.startsWith("llm-");
  const selectedModelPresetId =
    DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS.find(
      (preset) => preset.model.modelId === modelId,
    )?.id ?? "custom";
  const applyModelPreset = (presetId: string) => {
    if (presetId === "custom") {
      return;
    }
    const preset = DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS.find(
      (candidate) => candidate.id === presetId,
    );
    if (!preset) {
      return;
    }
    const inferenceMode =
      preset.model.inferenceMode === "text2text" ||
      preset.model.inferenceMode === "causal" ||
      preset.model.inferenceMode === "chat" ||
      preset.model.inferenceMode === "auto"
        ? preset.model.inferenceMode
        : "auto";
    setModelId(preset.model.modelId);
    setModelInferenceMode(inferenceMode);
    setModelDevice(preset.model.device ?? "auto");
    setModelTorchDtype(preset.model.torchDtype ?? "");
  };

  const toggleCard = (cardId: string) => {
    setExpandedCards((current) => ({ ...current, [cardId]: !current[cardId] }));
  };
  const renderCollapsibleSection = (
    cardId: string,
    title: string,
    children: ReactNode,
  ) => (
    <CollapsiblePanel
      className="dataset-preparation__section dataset-preparation__section--collapsible"
      title={title}
      isExpanded={Boolean(expandedCards[cardId])}
      onToggle={() => toggleCard(cardId)}
    >
      <div className="ui-stack ui-stack--sm">{children}</div>
    </CollapsiblePanel>
  );

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="dataset" tone="blue">
          Dataset Preparation
        </PanelHeading>
      </header>
      <div className="ui-panel__section-body dataset-preparation ui-stack ui-stack--sm">
        <p>Prepare training datasets from selected artifacts.</p>
        <form
          className="dataset-preparation__form ui-stack ui-stack--sm"
          onSubmit={(event) => void onSubmit(event)}
        >
          <section className="dataset-preparation__saved-settings ui-stack ui-stack--sm">
            <div className="dataset-preparation__saved-settings-header">
              <div className="ui-stack ui-stack--sm">
                <h3>Training settings</h3>
                <p className="dataset-preparation__section-description ui-text-muted">
                  Save the current workflow choices or load a saved set across
                  all four steps.
                </p>
              </div>
              <button
                className="ui-button dataset-preparation__save-settings-action"
                type="button"
                disabled={formLocked || !hasTrainingSettingsChanges}
                onClick={() => onSaveTrainingSettings()}
              >
                <ApplicationIcon name="save" />
                <span className="ui-button__label">Save training settings</span>
              </button>
            </div>
            <div className="ui-grid ui-grid--two">
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="savedTrainingSettings">
                    Saved training settings
                  </TermWithHint>
                </span>
                <select
                  className="ui-input"
                  value={selectedSavedTrainingSettingsId}
                  disabled={formLocked || savedTrainingSettings.length === 0}
                  onChange={(event) =>
                    setSelectedSavedTrainingSettingsId(event.target.value)
                  }
                >
                  <option value="">
                    {savedTrainingSettings.length > 0
                      ? "Choose saved settings"
                      : "No saved settings yet"}
                  </option>
                  {savedTrainingSettings.map((settings) => (
                    <option key={settings.id} value={settings.id}>
                      {settings.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="dataset-preparation__load-settings-action">
                <button
                  className="ui-button"
                  type="button"
                  disabled={
                    formLocked ||
                    savedTrainingSettings.length === 0 ||
                    selectedSavedTrainingSettingsId.length === 0
                  }
                  onClick={() => onLoadTrainingSettings()}
                >
                  Load settings
                </button>
              </div>
            </div>
          </section>
          <fieldset
            className="dataset-preparation__fieldset"
            disabled={formLocked}
          >
            <WorkflowSequence ariaLabel="Dataset preparation workflow">
              <WorkflowStep
                title="Add data"
                description="Choose what you want to create and the source files to use."
              >
                <section className="dataset-preparation__section">
                  <h4 className="dataset-preparation__section-title">
                    Training task
                  </h4>
                  <p className="dataset-preparation__section-description ui-text-muted">
                    Choose the kind of training dataset this preparation run
                    should create.
                  </p>
                  <label className="ui-stack ui-stack--sm">
                    <span>
                      <TermWithHint termId="trainingTask">
                        Training task
                      </TermWithHint>
                    </span>
                    <select
                      className="ui-input"
                      value={taskType}
                      onChange={(event) =>
                        setTaskType(event.target.value as typeof taskType)
                      }
                    >
                      {DATASET_PREPARATION_TASK_PROFILE_OPTIONS.map(
                        (option) => (
                          <option
                            key={option.taskType}
                            value={option.taskType}
                            disabled={option.runtimeSupport !== "supported"}
                          >
                            {option.label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <p className="dataset-preparation__section-description ui-text-muted">
                    {selectedTaskProfile.description}
                  </p>
                </section>

                {hasTaskSettings
                  ? renderCollapsibleSection(
                      "task-settings",
                      "Task settings",
                      <>
                        <p className="dataset-preparation__section-description ui-text-muted">
                          Set the extra details needed for the selected training
                          task.
                        </p>
                        {supportsAllowedLabels ? (
                          <div className="ui-grid ui-grid--two">
                            <label className="ui-stack ui-stack--sm">
                              <span>
                                <TermWithHint termId="labelSet">
                                  Allowed labels
                                </TermWithHint>{" "}
                                (optional)
                              </span>
                              <input
                                className="ui-input"
                                value={labelSet}
                                onChange={(event) =>
                                  setLabelSet(event.target.value)
                                }
                                placeholder="support, billing, bug report"
                              />
                            </label>
                            {taskType === "llm-classification" ? (
                              <label className="dataset-preparation__checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={multiLabel}
                                  onChange={(event) =>
                                    setMultiLabel(event.target.checked)
                                  }
                                />
                                <span>
                                  <TermWithHint termId="multiLabel">
                                    Allow more than one label
                                  </TermWithHint>
                                </span>
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                        {taskType === "llm-extraction" ? (
                          <label className="dataset-preparation__checkbox-row">
                            <input
                              type="checkbox"
                              checked={extractionStrictSchema}
                              onChange={(event) =>
                                setExtractionStrictSchema(event.target.checked)
                              }
                            />
                            <span>
                              <TermWithHint termId="strictSchema">
                                Keep extracted fields strict
                              </TermWithHint>
                            </span>
                          </label>
                        ) : null}
                        {taskType === "diffusion-lora" ? (
                          <div className="ui-grid ui-grid--two">
                            <label className="ui-stack ui-stack--sm">
                              <span>
                                <TermWithHint termId="conceptKind">
                                  Concept kind
                                </TermWithHint>
                              </span>
                              <select
                                className="ui-input"
                                value={diffusionConceptKind}
                                onChange={(event) =>
                                  setDiffusionConceptKind(
                                    event.target
                                      .value as typeof diffusionConceptKind,
                                  )
                                }
                              >
                                <option value="subject">Subject</option>
                                <option value="style">Style</option>
                                <option value="concept">Concept</option>
                              </select>
                            </label>
                            <label className="ui-stack ui-stack--sm">
                              <span>
                                <TermWithHint termId="triggerToken">
                                  Trigger token
                                </TermWithHint>{" "}
                                (optional)
                              </span>
                              <input
                                className="ui-input"
                                value={diffusionTriggerToken}
                                onChange={(event) =>
                                  setDiffusionTriggerToken(event.target.value)
                                }
                              />
                            </label>
                            <label className="ui-stack ui-stack--sm">
                              <span>
                                <TermWithHint termId="regularizationClass">
                                  Regularization class
                                </TermWithHint>{" "}
                                (optional)
                              </span>
                              <input
                                className="ui-input"
                                value={diffusionRegularizationClass}
                                onChange={(event) =>
                                  setDiffusionRegularizationClass(
                                    event.target.value,
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : null}
                        {taskType === "vision-detection" ? (
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="boxFormat">
                                Box format
                              </TermWithHint>
                            </span>
                            <select
                              className="ui-input"
                              value={detectionBoxFormat}
                              onChange={(event) =>
                                setDetectionBoxFormat(
                                  event.target
                                    .value as typeof detectionBoxFormat,
                                )
                              }
                            >
                              <option value="coco">COCO</option>
                              <option value="xyxy">XYXY</option>
                              <option value="xywh">XYWH</option>
                            </select>
                          </label>
                        ) : null}
                        {taskType === "vision-segmentation" ? (
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="maskFormat">
                                Mask format
                              </TermWithHint>
                            </span>
                            <select
                              className="ui-input"
                              value={segmentationMaskFormat}
                              onChange={(event) =>
                                setSegmentationMaskFormat(
                                  event.target
                                    .value as typeof segmentationMaskFormat,
                                )
                              }
                            >
                              <option value="png">PNG mask</option>
                              <option value="coco-rle">COCO RLE</option>
                              <option value="polygon">Polygon</option>
                            </select>
                          </label>
                        ) : null}
                      </>,
                    )
                  : null}

                <section className="dataset-preparation__section">
                  <h4 className="dataset-preparation__section-title">
                    Source artifacts
                  </h4>
                  <p className="dataset-preparation__section-description ui-text-muted">
                    Choose the uploaded or generated files that should become
                    the source material for the training dataset.
                  </p>
                  {isTextTask ? (
                    <p className="dataset-preparation__section-description ui-text-muted">
                      Accepted text sources: .csv, .json, .jsonl/.ndjson,
                      .parquet, .txt, .md/.markdown, .html/.htm, .pdf, and
                      .docx. Convert legacy .doc files to .docx and Excel
                      .xls/.xlsx files to .csv before adding them. .tsv, .rtf,
                      and .odt are not currently accepted. If a supported file
                      is missing, make sure its original filename and extension
                      were retained when it was added.
                    </p>
                  ) : null}
                  <label className="ui-stack ui-stack--sm">
                    <span>
                      <TermWithHint termId="filterSource">
                        Filter artifacts
                      </TermWithHint>
                    </span>
                    <select
                      className="ui-input"
                      value={selectedArtifactStorageFilter}
                      onChange={(event) =>
                        setSelectedArtifactStorageFilter(
                          event.target
                            .value as typeof selectedArtifactStorageFilter,
                        )
                      }
                    >
                      <option value="all">All artifacts</option>
                      <option value="uploaded">Uploaded artifacts</option>
                      <option value="generated">Generated artifacts</option>
                    </select>
                  </label>
                  {allArtifactCount === 0 ? (
                    <p>No artifacts available yet.</p>
                  ) : artifacts.length === 0 ? (
                    <p className="ui-text-muted">
                      No source artifacts match this training task. Choose a
                      different task or add files that fit this kind of dataset.
                    </p>
                  ) : (
                    <>
                      <div className="dataset-preparation__artifact-groups">
                        <section className="dataset-preparation__artifact-group ui-stack ui-stack--sm">
                          <h4 className="dataset-preparation__group-title">
                            Uploaded Artifacts
                          </h4>
                          {!showUploadedArtifacts ? (
                            <p className="ui-text-muted">Filtered out.</p>
                          ) : uploadedArtifacts.length === 0 ? (
                            <p>No uploaded artifacts available.</p>
                          ) : (
                            uploadedArtifacts.map((artifact) => (
                              <label
                                className="dataset-preparation__checkbox-row"
                                key={artifact.artifactId}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedArtifactIds.includes(
                                    artifact.artifactId,
                                  )}
                                  onChange={() =>
                                    onToggleArtifact(artifact.artifactId)
                                  }
                                />
                                <TypeBadge
                                  value={artifact.mediaType ?? artifact.label}
                                />
                                <span>{artifact.label}</span>
                              </label>
                            ))
                          )}
                        </section>
                        <section className="dataset-preparation__artifact-group ui-stack ui-stack--sm">
                          <h4 className="dataset-preparation__group-title">
                            Generated Artifacts
                          </h4>
                          {!showGeneratedArtifacts ? (
                            <p className="ui-text-muted">Filtered out.</p>
                          ) : generatedArtifacts.length === 0 ? (
                            <EmptyState
                              compact
                              icon="dataset"
                              title="No generated artifacts yet"
                              description="Run dataset preparation to generate artifacts for reuse."
                            />
                          ) : (
                            generatedArtifacts.map((artifact) => (
                              <label
                                className="dataset-preparation__checkbox-row"
                                key={artifact.artifactId}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedArtifactIds.includes(
                                    artifact.artifactId,
                                  )}
                                  onChange={() =>
                                    onToggleArtifact(artifact.artifactId)
                                  }
                                />
                                <TypeBadge
                                  value={artifact.mediaType ?? artifact.label}
                                />
                                <span>{artifact.label}</span>
                              </label>
                            ))
                          )}
                        </section>
                      </div>
                      {selectedArtifactStorageFilter !== "all" ? (
                        <p className="ui-text-muted">
                          Showing {filteredArtifacts.length} artifact(s) for the
                          selected filter.
                        </p>
                      ) : null}
                    </>
                  )}
                </section>
              </WorkflowStep>
              <WorkflowStep
                title="Check data"
                description="Confirm that the selected files can be prepared for this training task."
              >
                <div className="dataset-preparation__readiness" role="status">
                  <strong>
                    {preparationResolution.status === "ready"
                      ? "Sources match this training goal"
                      : preparationResolution.status === "unsupported"
                        ? "Change the selected sources"
                        : "Add at least one source file"}
                  </strong>
                  <p className="ui-text-muted">
                    {preparationResolution.action
                      ? `${preparationResolution.message} ${preparationResolution.action}`
                      : preparationResolution.message}
                  </p>
                </div>
                <div className="dataset-preparation__readiness">
                  <strong>What these checks cover</strong>
                  <p className="ui-text-muted">{inspectionCopy.checked}</p>
                  <p className="ui-text-muted">{inspectionCopy.limitation}</p>
                  <p className="ui-text-muted">
                    Every accepted training example must remain linked to a
                    selected source. This association is always required.
                  </p>
                </div>
                <label className="ui-stack ui-stack--sm">
                  <span>Data checks</span>
                  <select
                    className="ui-input"
                    value={qualityPreset}
                    onChange={(event) =>
                      setQualityPreset(
                        event.target.value as typeof qualityPreset,
                      )
                    }
                  >
                    <option value="recommended">Standard</option>
                    <option value="strict">Strict</option>
                  </select>
                  <small className="ui-text-muted">
                    {qualityPreset === "strict"
                      ? "Completes all standard checks, but uses narrower text-length limits and searches more broadly for similar examples. It may move more examples into the review list."
                      : "Uses practical limits for the selected task and checks task fields, source links, duplicates, personal-data patterns, credential-like text, and split safety."}
                  </small>
                </label>
                <details>
                  <summary>Advanced data rules</summary>
                  <div className="ui-stack ui-stack--sm">
                    <label className="dataset-preparation__checkbox-row">
                      <input
                        type="checkbox"
                        checked={requireLicenseMetadata}
                        onChange={(event) =>
                          setRequireLicenseMetadata(event.target.checked)
                        }
                      />
                      <span>
                        Require license information for each training example
                      </span>
                    </label>
                    <p className="ui-text-muted">
                      License information belongs to the selected source, such
                      as a Creative Commons license. Each example must retain a
                      source link so the source and author can be identified.
                    </p>
                    <label className="dataset-preparation__checkbox-row">
                      <input
                        type="checkbox"
                        checked={requireConsentMetadata}
                        onChange={(event) =>
                          setRequireConsentMetadata(event.target.checked)
                        }
                      />
                      <span>
                        Require consent information for each training example
                      </span>
                    </label>
                    <p className="ui-text-muted">
                      Consent information records the source's stated basis for
                      using the material. An example means a prepared text,
                      image, box, or mask example, not a page or PDF row.
                    </p>
                    <label className="dataset-preparation__checkbox-row">
                      <input
                        type="checkbox"
                        checked={includeSourceAttribution}
                        onChange={(event) =>
                          setIncludeSourceAttribution(event.target.checked)
                        }
                      />
                      <span>Include source attribution with each example</span>
                    </label>
                    <p className="ui-text-muted">
                      Adds the source ID and any available source name, public
                      link, author, and license beside every saved example.
                    </p>
                  </div>
                </details>
              </WorkflowStep>
              <WorkflowStep
                title="Prepare dataset"
                description="Confirm what the selected sources need, then adjust only settings used by that method."
              >
                {preparationResolution.status === "ready" &&
                preparationResolution.inputIntent &&
                preparationMethodId ? (
                  <>
                    <div
                      className="dataset-preparation__readiness"
                      role="status"
                    >
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
                    </div>
                    {preparationResolution.methods.length > 1 ? (
                      <label className="ui-stack ui-stack--sm">
                        <span>How should the source material be divided?</span>
                        <select
                          className="ui-input"
                          value={preparationMethodId}
                          disabled={formLocked}
                          onChange={(event) =>
                            setPreparationMethodId(
                              event.target.value as DatasetPreparationMethodId,
                            )
                          }
                        >
                          {preparationResolution.methods.map((method) => (
                            <option key={method.id} value={method.id}>
                              {getDatasetPreparationMethodCopy(method.id).label}
                            </option>
                          ))}
                        </select>
                        <small className="ui-text-muted">
                          {
                            getDatasetPreparationMethodCopy(preparationMethodId)
                              .description
                          }
                        </small>
                      </label>
                    ) : (
                      <div className="dataset-preparation__readiness">
                        <strong>
                          {
                            getDatasetPreparationMethodCopy(preparationMethodId)
                              .label
                          }
                        </strong>
                        <p className="ui-text-muted">
                          {
                            getDatasetPreparationMethodCopy(preparationMethodId)
                              .description
                          }
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="dataset-preparation__readiness" role="status">
                    <strong>Choose compatible sources first</strong>
                    <p className="ui-text-muted">
                      {preparationResolution.action
                        ? `${preparationResolution.message} ${preparationResolution.action}`
                        : preparationResolution.message}
                    </p>
                  </div>
                )}
                {isModelTextGenerationEnabled && showGenerationModelDownload ? (
                  <section className="dataset-preparation__quick-download ui-stack ui-stack--sm">
                    <p className="ui-text-muted">
                      The selected model is not downloaded for the current
                      workspace yet. Download it before preparing the dataset.
                    </p>
                    <button
                      className="ui-button"
                      type="button"
                      disabled={
                        modelDownloadInFlight ||
                        !workspaceId ||
                        modelId.trim().length === 0
                      }
                      onClick={() => {
                        notifications?.setPanelOpen(true);
                        void onDownloadGenerationModel();
                      }}
                    >
                      {modelDownloadInFlight
                        ? "Downloading..."
                        : "Download model"}
                    </button>
                    {modelDownloadStatus.message ? (
                      <p
                        role={
                          modelDownloadStatus.kind === "error"
                            ? "alert"
                            : "status"
                        }
                      >
                        {modelDownloadStatus.message}
                      </p>
                    ) : null}
                  </section>
                ) : isModelTextGenerationEnabled &&
                  modelDownloadStatus.message &&
                  modelDownloadStatus.kind === "success" ? (
                  <p role="status">{modelDownloadStatus.message}</p>
                ) : null}
                <CollapsiblePanel
                  className="dataset-preparation__advanced-settings"
                  title="Advanced settings"
                  isExpanded={Boolean(expandedCards["advanced-settings"])}
                  onToggle={() => toggleCard("advanced-settings")}
                >
                  <div className="ui-stack ui-stack--sm">
                    {usesDocumentPreparation
                      ? renderCollapsibleSection(
                          "normalization",
                          "Normalization",
                          <>
                            <p className="dataset-preparation__section-description ui-text-muted">
                              Control how source files are cleaned and converted
                              so the rest of the preparation process receives
                              consistent text.
                            </p>
                            <div className="ui-grid ui-grid--two">
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="unsupportedDocumentPolicy">
                                    Unsupported document policy
                                  </TermWithHint>
                                </span>
                                <select
                                  className="ui-input"
                                  value={unsupportedDocumentPolicy}
                                  onChange={(event) =>
                                    setUnsupportedDocumentPolicy(
                                      event.target
                                        .value as typeof unsupportedDocumentPolicy,
                                    )
                                  }
                                >
                                  <option value="">Runtime default</option>
                                  <option value="fail">Fail</option>
                                  <option value="skip">Skip</option>
                                </select>
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="normalizationMode">
                                    Normalization mode
                                  </TermWithHint>
                                </span>
                                <select
                                  className="ui-input"
                                  value={normalizationMode}
                                  onChange={(event) =>
                                    setNormalizationMode(
                                      event.target
                                        .value as typeof normalizationMode,
                                    )
                                  }
                                >
                                  <option value="">Runtime default</option>
                                  <option value="strict">Strict</option>
                                  <option value="best-effort">
                                    Best effort
                                  </option>
                                </select>
                              </label>
                            </div>
                          </>,
                        )
                      : null}

                    {usesFixedSections
                      ? renderCollapsibleSection(
                          "fixed-sections",
                          "Fixed-length section settings",
                          <>
                            <p className="dataset-preparation__section-description ui-text-muted">
                              These values apply only to the fixed-length
                              method.
                            </p>
                            <div className="ui-grid ui-grid--two">
                              <label className="ui-stack ui-stack--sm">
                                <span>Section length (characters)</span>
                                <input
                                  className="ui-input"
                                  value={chunkSize}
                                  onChange={(event) =>
                                    setChunkSize(event.target.value)
                                  }
                                />
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>Section overlap (characters)</span>
                                <input
                                  className="ui-input"
                                  value={chunkOverlap}
                                  onChange={(event) =>
                                    setChunkOverlap(event.target.value)
                                  }
                                />
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>Maximum section count (optional)</span>
                                <input
                                  className="ui-input"
                                  value={maxChunkCount}
                                  onChange={(event) =>
                                    setMaxChunkCount(event.target.value)
                                  }
                                />
                              </label>
                              <label className="dataset-preparation__checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={preserveDocumentBoundaries}
                                  onChange={(event) =>
                                    setPreserveDocumentBoundaries(
                                      event.target.checked,
                                    )
                                  }
                                />
                                <span>Keep each source document separate</span>
                              </label>
                            </div>
                          </>,
                        )
                      : usesAdaptiveSections
                        ? renderCollapsibleSection(
                            "adaptive-sections",
                            usesTopicSections
                              ? "Topic-aware section settings"
                              : "Document-structure section settings",
                            <>
                              <p className="dataset-preparation__section-description ui-text-muted">
                                Size and overlap do not apply to this method.
                                These controls refine the selected method
                                without changing it.
                              </p>
                              <div className="ui-grid ui-grid--two">
                                <label className="ui-stack ui-stack--sm">
                                  <span>Maximum section length (tokens)</span>
                                  <input
                                    className="ui-input"
                                    value={maxTokensPerChunk}
                                    onChange={(event) =>
                                      setMaxTokensPerChunk(event.target.value)
                                    }
                                  />
                                </label>
                                {usesTopicSections ? (
                                  <label className="ui-stack ui-stack--sm">
                                    <span>
                                      Topic change sensitivity (0 to 1)
                                    </span>
                                    <input
                                      className="ui-input"
                                      value={topicBoundarySensitivity}
                                      onChange={(event) =>
                                        setTopicBoundarySensitivity(
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </label>
                                ) : null}
                                <label className="ui-stack ui-stack--sm">
                                  <span>Maximum source sections</span>
                                  <input
                                    className="ui-input"
                                    value={maxSourceSpans}
                                    onChange={(event) =>
                                      setMaxSourceSpans(event.target.value)
                                    }
                                  />
                                </label>
                                <label className="ui-stack ui-stack--sm">
                                  <span>
                                    Similar-example threshold (0 to 1)
                                  </span>
                                  <input
                                    className="ui-input"
                                    value={similarityThreshold}
                                    onChange={(event) =>
                                      setSimilarityThreshold(event.target.value)
                                    }
                                  />
                                </label>
                              </div>
                            </>,
                          )
                        : null}

                    {renderCollapsibleSection(
                      "automated-formatting",
                      "Generation prompt",
                      <>
                        <p className="dataset-preparation__section-description ui-text-muted">
                          {isModelTextGenerationEnabled
                            ? "This method creates the task-specific text fields with a local model. Generation is separate from how documents are divided."
                            : "This method uses task fields already present in the dataset or attached source metadata. No local generation model is used."}
                        </p>
                        {isModelTextGenerationEnabled ? (
                          <>
                            <label className="ui-stack ui-stack--sm">
                              <span>
                                <TermWithHint termId="systemPrompt">
                                  System prompt instructions
                                </TermWithHint>
                              </span>
                              <textarea
                                className="ui-input dataset-preparation__prompt-textarea"
                                value={textGenerationPrompt}
                                onChange={(event) =>
                                  setTextGenerationPrompt(event.target.value)
                                }
                                rows={6}
                              />
                            </label>
                            <DatasetPreparationOutputShapeEditor
                              idPrefix="desktop-dataset-preparation-output"
                              taskType={taskType}
                              shape={visualOutputShape}
                              outputFormat={outputFormat}
                              allowedLabels={configuredLabels}
                              multiLabel={multiLabel}
                              includeSourceAttribution={
                                includeSourceAttribution
                              }
                              disabled={formLocked}
                              onChange={setVisualOutputShape}
                            />
                            <div className="ui-stack ui-stack--sm">
                              <label className="dataset-preparation__checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={constrainedDecodingEnabled}
                                  disabled={
                                    formLocked || !constrainedDecodingAvailable
                                  }
                                  onChange={(event) =>
                                    setConstrainedDecodingPreference(
                                      event.target.checked,
                                    )
                                  }
                                />
                                <span>Keep generated JSON well structured</span>
                              </label>
                              <p className="ui-text-muted">
                                When enabled, the local model follows the field
                                layout while it writes each example.{" "}
                                {constrainedJsonRecommendationCopy(
                                  constrainedJsonResolution.recommendationReason,
                                )}
                              </p>
                            </div>
                            <div className="ui-grid ui-grid--two">
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="modelPreset">
                                    Model preset
                                  </TermWithHint>
                                </span>
                                <select
                                  className="ui-input"
                                  value={selectedModelPresetId}
                                  onChange={(event) =>
                                    applyModelPreset(event.target.value)
                                  }
                                >
                                  {DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS.map(
                                    (preset) => (
                                      <option key={preset.id} value={preset.id}>
                                        {preset.label}
                                      </option>
                                    ),
                                  )}
                                  <option value="custom">
                                    Custom model ID
                                  </option>
                                </select>
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="modelId">
                                    Model ID
                                  </TermWithHint>
                                </span>
                                <input
                                  className="ui-input"
                                  value={modelId}
                                  onChange={(event) =>
                                    setModelId(event.target.value)
                                  }
                                />
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="inference">
                                    Inference mode
                                  </TermWithHint>
                                </span>
                                <select
                                  className="ui-input"
                                  value={modelInferenceMode}
                                  onChange={(event) =>
                                    setModelInferenceMode(
                                      event.target
                                        .value as typeof modelInferenceMode,
                                    )
                                  }
                                >
                                  <option value="auto">auto</option>
                                  <option value="text2text">text2text</option>
                                  <option value="causal">causal</option>
                                  <option value="chat">chat</option>
                                </select>
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="runtime">
                                    Model device
                                  </TermWithHint>
                                </span>
                                <select
                                  className="ui-input"
                                  value={modelDevice}
                                  onChange={(event) =>
                                    setModelDevice(
                                      event.target.value as typeof modelDevice,
                                    )
                                  }
                                >
                                  <option value="">Runtime default</option>
                                  <option value="auto">Auto</option>
                                  <option value="cpu">CPU</option>
                                  <option value="cuda">CUDA</option>
                                </select>
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="settingValue">
                                    Torch dtype
                                  </TermWithHint>
                                </span>
                                <select
                                  className="ui-input"
                                  value={modelTorchDtype}
                                  onChange={(event) =>
                                    setModelTorchDtype(
                                      event.target
                                        .value as typeof modelTorchDtype,
                                    )
                                  }
                                >
                                  <option value="">Runtime default</option>
                                  <option value="auto">Auto</option>
                                  <option value="float16">float16</option>
                                  <option value="bfloat16">bfloat16</option>
                                  <option value="float32">float32</option>
                                </select>
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>When memory is full</span>
                                <select
                                  className="ui-input"
                                  value={modelMemoryOverflowPolicy}
                                  onChange={(event) =>
                                    setModelMemoryOverflowPolicy(
                                      event.target
                                        .value as typeof modelMemoryOverflowPolicy,
                                    )
                                  }
                                >
                                  <option value="limited">
                                    Use a little disk space (up to 1 GB)
                                  </option>
                                  <option value="none">
                                    Keep everything in memory
                                  </option>
                                  <option value="extended">
                                    Use more disk space (up to 4 GB)
                                  </option>
                                </select>
                                <small className="ui-text-muted">
                                  Disk/swap can keep a model running when free
                                  memory is low, but generation may be slower.
                                  The 4 GB option can also make the computer
                                  less responsive.
                                </small>
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="failurePolicy">
                                    Failure policy
                                  </TermWithHint>
                                </span>
                                <select
                                  className="ui-input"
                                  value={failurePolicy}
                                  onChange={(event) =>
                                    setFailurePolicy(
                                      event.target
                                        .value as typeof failurePolicy,
                                    )
                                  }
                                >
                                  <option value="">Runtime default</option>
                                  <option value="fail">Fail</option>
                                  <option value="skip">Skip</option>
                                </select>
                              </label>
                              {usesAdaptiveSections ? (
                                <label className="ui-stack ui-stack--sm">
                                  <span>Candidate examples per section</span>
                                  <input
                                    className="ui-input"
                                    value={maxExamplesPerChunk}
                                    onChange={(event) =>
                                      setMaxExamplesPerChunk(event.target.value)
                                    }
                                  />
                                </label>
                              ) : null}
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="batchSize">
                                    Batch size
                                  </TermWithHint>
                                </span>
                                <input
                                  className="ui-input"
                                  value={batchSize}
                                  onChange={(event) =>
                                    setBatchSize(event.target.value)
                                  }
                                />
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="temperature">
                                    Temperature
                                  </TermWithHint>
                                </span>
                                <input
                                  className="ui-input"
                                  value={generationTemperature}
                                  onChange={(event) =>
                                    setGenerationTemperature(event.target.value)
                                  }
                                />
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="topP">
                                    Top P
                                  </TermWithHint>
                                </span>
                                <input
                                  className="ui-input"
                                  value={generationTopP}
                                  onChange={(event) =>
                                    setGenerationTopP(event.target.value)
                                  }
                                />
                              </label>
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="maxNewTokens">
                                    Max new tokens
                                  </TermWithHint>
                                </span>
                                <input
                                  className="ui-input"
                                  value={generationMaxNewTokens}
                                  onChange={(event) =>
                                    setGenerationMaxNewTokens(
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                            </div>
                          </>
                        ) : (
                          <p className="ui-text-muted">
                            The run will use labels, captions, answers, or
                            annotations already present in selected source
                            files, metadata, or structured manifests.
                          </p>
                        )}
                      </>,
                    )}

                    {renderCollapsibleSection(
                      "dataset-split",
                      "Dataset split",
                      <>
                        <p className="dataset-preparation__section-description ui-text-muted">
                          Decide how much prepared data is used for training and
                          how much is held back for checking results.
                        </p>
                        <div className="ui-grid ui-grid--two">
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="trainRatio">
                                Train ratio
                              </TermWithHint>
                            </span>
                            <input
                              className="ui-input"
                              value={trainRatio}
                              onChange={(event) =>
                                setTrainRatio(event.target.value)
                              }
                            />
                          </label>
                          <label className="ui-stack ui-stack--sm">
                            <span>Validation ratio</span>
                            <input
                              className="ui-input"
                              value={validationRatio}
                              onChange={(event) =>
                                setValidationRatio(event.target.value)
                              }
                            />
                          </label>
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="testRatio">
                                Test ratio
                              </TermWithHint>
                            </span>
                            <input
                              className="ui-input"
                              value={testRatio}
                              onChange={(event) =>
                                setTestRatio(event.target.value)
                              }
                            />
                          </label>
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="seed">Seed</TermWithHint>{" "}
                              (optional)
                            </span>
                            <input
                              className="ui-input"
                              value={seed}
                              onChange={(event) => setSeed(event.target.value)}
                            />
                          </label>
                          <label className="dataset-preparation__checkbox-row">
                            <input
                              type="checkbox"
                              checked={shuffle}
                              onChange={(event) =>
                                setShuffle(event.target.checked)
                              }
                            />
                            <span>
                              <TermWithHint termId="shuffleRows">
                                Shuffle rows
                              </TermWithHint>
                            </span>
                          </label>
                        </div>
                      </>,
                    )}

                    {renderCollapsibleSection(
                      "output-file",
                      "Output file",
                      <>
                        <p className="dataset-preparation__section-description ui-text-muted">
                          Pick the saved file format and optional name so the
                          dataset can be reused in other workflows.
                        </p>
                        <div className="ui-grid ui-grid--two">
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="outputFormat">
                                Output format
                              </TermWithHint>
                            </span>
                            <select
                              className="ui-input"
                              value={outputFormat}
                              onChange={(event) =>
                                setOutputFormat(
                                  event.target.value as typeof outputFormat,
                                )
                              }
                            >
                              <option value="parquet">Parquet</option>
                              <option value="jsonl">JSONL</option>
                              <option value="json">JSON</option>
                              <option value="csv">CSV</option>
                            </select>
                          </label>
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="outputBaseName">
                                Output base name
                              </TermWithHint>{" "}
                              (optional)
                            </span>
                            <input
                              className="ui-input"
                              value={outputBaseName}
                              onChange={(event) =>
                                setOutputBaseName(event.target.value)
                              }
                            />
                          </label>
                        </div>
                      </>,
                    )}
                  </div>
                </CollapsiblePanel>
              </WorkflowStep>
              <WorkflowStep
                title="Review and create"
                description="Review the result you will create, choose where to save it, and start preparation."
              >
                <p className="ui-text-muted">
                  Create a {selectedTaskProfile.label.toLowerCase()} dataset
                  from {selectedArtifactIds.length} selected source file
                  {selectedArtifactIds.length === 1 ? "" : "s"}. The prepared
                  rows will be kept in separate training, validation, and test
                  files.
                </p>

                {qualityReview ? (
                  <section
                    className="dataset-preparation__quality-review ui-stack ui-stack--sm"
                    aria-labelledby="dataset-quality-review-title"
                  >
                    <h4 id="dataset-quality-review-title">Check results</h4>
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
                      <div className="dataset-preparation__readiness">
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
                        aria-labelledby="dataset-advanced-review-title"
                      >
                        <h5 id="dataset-advanced-review-title">
                          Preparation checks
                        </h5>
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
                    {Object.keys(qualityReview.report.reasonCounts).length >
                    0 ? (
                      <>
                        <h5>What needs attention</h5>
                        <ul>
                          {Object.entries(
                            qualityReview.report.reasonCounts,
                          ).map(([reason, count]) => (
                            <li key={reason}>
                              {QUALITY_REASON_LABELS[reason] ??
                                "Other data issue"}
                              : {count}
                            </li>
                          ))}
                        </ul>
                      </>
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
                    <div className="dataset-preparation__actions ui-workflow__actions">
                      <button
                        className="ui-button"
                        type="button"
                        disabled={
                          reviewActionInFlight ||
                          !qualityReview.report.approvalAllowed
                        }
                        onClick={() => void onApproveReview()}
                      >
                        {reviewActionInFlight
                          ? "Saving..."
                          : "Approve and save dataset"}
                      </button>
                      <button
                        className="ui-button"
                        type="button"
                        disabled={reviewActionInFlight}
                        onClick={() => void onDiscardReview()}
                      >
                        Discard review
                      </button>
                    </div>
                    {!qualityReview.report.approvalAllowed ? (
                      <p role="alert">
                        This dataset cannot be saved. Adjust the source data or
                        rules, then run the checks again.
                      </p>
                    ) : null}
                  </section>
                ) : null}

                <p className="dataset-preparation__section-description ui-text-muted">
                  The prepared dataset is saved locally as a reusable version
                  first.
                </p>
                <p>
                  After it is saved, use <strong>Saved versions</strong> to
                  publish it privately or publicly.
                </p>

                <div className="dataset-preparation__actions ui-workflow__actions">
                  <button
                    className="ui-button"
                    type="submit"
                    disabled={
                      !isSelectedTaskAvailable ||
                      selectedArtifactIds.length === 0 ||
                      status.kind === "loading" ||
                      qualityReview !== undefined
                    }
                  >
                    <ApplicationIcon name="play" />
                    <span className="ui-button__label">
                      {status.kind === "loading"
                        ? "Preparing..."
                        : "Run checks and prepare"}
                    </span>
                  </button>
                </div>
              </WorkflowStep>
            </WorkflowSequence>
          </fieldset>
          {status.kind === "loading" || canUnloadModel ? (
            <div className="dataset-preparation__actions ui-workflow__actions">
              {status.kind === "loading" ? (
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => void onStopTraining()}
                  disabled={stopTrainingInFlight}
                >
                  {stopTrainingInFlight
                    ? "Stopping training..."
                    : "Stop training"}
                </button>
              ) : null}
              {canUnloadModel ? (
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => void onUnloadModel()}
                  disabled={unloadModelInFlight}
                >
                  {unloadModelInFlight ? "Unloading model..." : "Unload model"}
                </button>
              ) : null}
            </div>
          ) : null}
        </form>

        {status.message && !transientStatusMessage ? (
          <p
            className="dataset-preparation__status"
            role={status.kind === "error" ? "alert" : "status"}
          >
            {status.message}
          </p>
        ) : null}
        <TransientNotificationPublisher
          message={transientStatusMessage ? status.message : undefined}
          title="Dataset preparation updated"
          tone="success"
          source="Dataset Preparation"
          workspaceId={workspaceId}
        />
        {resultSummary ? (
          <dl className="dataset-preparation__summary ui-grid ui-grid--two">
            <dt>
              <TermWithHint termId="artifact">Dataset artifact</TermWithHint>
            </dt>
            <dd>{resultSummary.datasetKey}</dd>
            <dt>
              <TermWithHint termId="dataset">Dataset rows</TermWithHint>
            </dt>
            <dd>{resultSummary.datasetRows}</dd>
            <dt>Training rows</dt>
            <dd>{resultSummary.trainRows}</dd>
            <dt>Validation rows</dt>
            <dd>{resultSummary.validationRows}</dd>
            <dt>Test rows</dt>
            <dd>{resultSummary.testRows}</dd>
          </dl>
        ) : null}
        {workspaceId && versionClient.listVersions ? (
          <DatasetVersionPanel
            workspaceId={workspaceId}
            currentVersionId={resultSummary?.datasetVersion?.versionId}
            datasetId={resultSummary?.datasetVersion?.datasetId}
            service={versionService}
            onReuse={onReuseDatasetVersion}
          />
        ) : null}
        {resultSummary?.warnings.length ? (
          <div className="dataset-preparation__warnings" role="status">
            <h3>Needs attention</h3>
            <ul>
              {resultSummary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
