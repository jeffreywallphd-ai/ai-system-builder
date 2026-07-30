import { useMemo, useState, type ReactNode } from "react";

import { createDesktopDatasetPreparationClient, type DesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";
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
  DatasetVersionPanel,
  WorkflowSequence,
  WorkflowStep,
} from "../../../../../../../modules/ui/shared";
import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { useDatasetPreparationFeature } from "../hooks/useDatasetPreparationFeature";
import { DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS } from "../../../../../../../modules/contracts/runtime";
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
  "exact-duplicate": "Exact duplicates",
  "fuzzy-duplicate": "Very similar examples",
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

export function DatasetPreparationFeature({
  onPrepared,
  client,
  settingsClient,
  modelsClient,
  runtimeStatusClient,
  workspaceId,
}: DatasetPreparationFeatureProps) {
  const {
    artifacts,
    allArtifactCount,
    filteredArtifacts,
    uploadedArtifacts,
    generatedArtifacts,
    selectedArtifactStorageFilter,
    selectedArtifactIds,
    taskType,
    labelSet,
    multiLabel,
    extractionStrictSchema,
    diffusionConceptKind,
    diffusionTriggerToken,
    diffusionRegularizationClass,
    detectionBoxFormat,
    segmentationMaskFormat,
    textInputMode,
    textGenerationPrompt,
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
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
    setTextInputMode,
    setTextGenerationPrompt,
    setUnsupportedDocumentPolicy,
    setNormalizationMode,
    setChunkSize,
    setChunkOverlap,
    setPreserveDocumentBoundaries,
    setMaxChunkCount,
    setModelId,
    setModelInferenceMode,
    setModelDevice,
    setModelTorchDtype,
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
  const versionClient = useMemo(() => client ?? createDesktopDatasetPreparationClient(), [client]);
  const versionService = useMemo(() => ({
    list: (targetWorkspaceId: string, targetDatasetId?: string) => versionClient.listVersions?.(targetWorkspaceId, targetDatasetId) ?? Promise.resolve([]),
    compare: (targetWorkspaceId: string, fromVersionId: string, toVersionId: string) => versionClient.compareVersions?.(targetWorkspaceId, fromVersionId, toVersionId) ?? Promise.reject(new Error("Dataset version comparison is unavailable.")),
    reproduce: (targetWorkspaceId: string, versionId: string) => versionClient.readReproduction?.(targetWorkspaceId, versionId) ?? Promise.reject(new Error("Saved dataset setup is unavailable.")),
    publish: (input: Parameters<NonNullable<DesktopDatasetPreparationClient["publishVersion"]>>[0]) => versionClient.publishVersion?.(input) ?? Promise.reject(new Error("Dataset publishing is unavailable.")),
  }), [versionClient]);
  const transientStatusMessage = [
    "Training settings saved.",
    "Model unloaded from memory.",
  ].includes(status.message ?? "");
  const formLocked = status.kind === "loading";
  const showUploadedArtifacts = selectedArtifactStorageFilter !== "generated";
  const showGeneratedArtifacts = selectedArtifactStorageFilter !== "uploaded";
  const selectedTaskProfile = getDatasetPreparationTaskProfileOption(taskType);
  const isSelectedTaskAvailable =
    selectedTaskProfile.runtimeSupport === "supported";
  const isModelTextGenerationEnabled = textInputMode === "generate";
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
        {savedTrainingSettings.length > 0 ? (
          <section className="dataset-preparation__saved-settings ui-stack ui-stack--sm">
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
                  onChange={(event) =>
                    setSelectedSavedTrainingSettingsId(event.target.value)
                  }
                >
                  <option value="">Choose saved settings</option>
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
                    formLocked || selectedSavedTrainingSettingsId.length === 0
                  }
                  onClick={() => onLoadTrainingSettings()}
                >
                  Load settings
                </button>
              </div>
            </div>
          </section>
        ) : null}
        <form
          className="dataset-preparation__form ui-stack ui-stack--sm"
          onSubmit={(event) => void onSubmit(event)}
        >
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

                {renderCollapsibleSection(
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
                              event.target.value as typeof detectionBoxFormat,
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
                    {taskType === "llm-instruction" ||
                    taskType === "llm-embedding" ||
                    taskType === "llm-reranker" ||
                    taskType === "vision-classification" ? (
                      <p className="ui-text-muted">
                        This task can run with the default settings.
                      </p>
                    ) : null}
                  </>,
                )}

                <section className="dataset-preparation__section">
                  <h4 className="dataset-preparation__section-title">
                    Source artifacts
                  </h4>
                  <p className="dataset-preparation__section-description ui-text-muted">
                    Choose the uploaded or generated files that should become
                    the source material for the training dataset.
                  </p>
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
                    {selectedArtifactIds.length > 0
                      ? "Ready to prepare"
                      : "Add at least one source file"}
                  </strong>
                  <p className="ui-text-muted">
                    {selectedArtifactIds.length > 0
                      ? selectedArtifactIds.length +
                        " supported source file" +
                        (selectedArtifactIds.length === 1 ? " is" : "s are") +
                        " selected for " +
                        selectedTaskProfile.label +
                        "."
                      : "Choose a supported source file above. Files that do not work with this training task are not offered."}
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
                    <option value="recommended">Recommended</option>
                    <option value="strict">Strict</option>
                  </select>
                  <small className="ui-text-muted">
                    {qualityPreset === "strict"
                      ? "Applies tighter checks before any dataset is saved."
                      : "Checks structure, duplicates, personal data, credentials, and split safety."}
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
                      <span>Require license information for every row</span>
                    </label>
                    <label className="dataset-preparation__checkbox-row">
                      <input
                        type="checkbox"
                        checked={requireConsentMetadata}
                        onChange={(event) =>
                          setRequireConsentMetadata(event.target.checked)
                        }
                      />
                      <span>Require consent information for every row</span>
                    </label>
                  </div>
                </details>
              </WorkflowStep>
              <WorkflowStep
                title="Prepare dataset"
                description="Use the recommended setup, or open Advanced settings when you need more control."
              >
                <p className="ui-text-muted">
                  Recommended: clean and divide the selected data, then create
                  training, validation, and test sets using an 80/10/10 split.
                </p>
                <CollapsiblePanel
                  className="dataset-preparation__advanced-settings"
                  title="Advanced settings"
                  isExpanded={Boolean(expandedCards["advanced-settings"])}
                  onToggle={() => toggleCard("advanced-settings")}
                >
                  <div className="ui-stack ui-stack--sm">
                    {renderCollapsibleSection(
                      "normalization",
                      "Normalization",
                      <>
                        <p className="dataset-preparation__section-description ui-text-muted">
                          Control how source files are cleaned and converted so
                          the rest of the preparation process receives
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
                              <option value="best-effort">Best effort</option>
                            </select>
                          </label>
                        </div>
                      </>,
                    )}

                    {renderCollapsibleSection(
                      "chunking",
                      "Chunking",
                      <>
                        <p className="dataset-preparation__section-description ui-text-muted">
                          Set how large documents are divided into smaller
                          pieces so examples stay focused and manageable.
                        </p>
                        <div className="ui-grid ui-grid--two">
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="chunkSize">
                                Chunk size
                              </TermWithHint>
                            </span>
                            <input
                              className="ui-input"
                              value={chunkSize}
                              onChange={(event) =>
                                setChunkSize(event.target.value)
                              }
                            />
                          </label>
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="chunkOverlap">
                                Chunk overlap
                              </TermWithHint>
                            </span>
                            <input
                              className="ui-input"
                              value={chunkOverlap}
                              onChange={(event) =>
                                setChunkOverlap(event.target.value)
                              }
                            />
                          </label>
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="maxChunkCount">
                                Max chunk count
                              </TermWithHint>{" "}
                              (optional)
                            </span>
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
                            <span>
                              <TermWithHint termId="preserveDocumentBoundaries">
                                Preserve document boundaries
                              </TermWithHint>
                            </span>
                          </label>
                        </div>
                      </>,
                    )}

                    {renderCollapsibleSection(
                      "automated-formatting",
                      "Automated Data Formatting",
                      <>
                        <p className="dataset-preparation__section-description ui-text-muted">
                          Choose whether labels, captions, questions, answers,
                          or other text fields come from the selected data or
                          are generated by a local text model.
                        </p>
                        <div className="ui-grid ui-grid--two">
                          <label className="ui-stack ui-stack--sm">
                            <span>
                              <TermWithHint termId="textInputMode">
                                Text source
                              </TermWithHint>
                            </span>
                            <select
                              className="ui-input"
                              value={textInputMode}
                              onChange={(event) =>
                                setTextInputMode(
                                  event.target.value as typeof textInputMode,
                                )
                              }
                            >
                              <option value="provided">
                                Use text already in the source data
                              </option>
                              <option value="generate">
                                Generate missing text with a model
                              </option>
                            </select>
                          </label>
                        </div>
                        {isModelTextGenerationEnabled ? (
                          <>
                            <label className="ui-stack ui-stack--sm">
                              <span>
                                <TermWithHint termId="systemPrompt">
                                  System prompt
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
                            {showGenerationModelDownload ? (
                              <section className="dataset-preparation__quick-download ui-stack ui-stack--sm">
                                <p className="ui-text-muted">
                                  This model is not downloaded for the current
                                  workspace yet. Review the model ID below, then
                                  download it for this workspace.
                                </p>
                                <button
                                  className="ui-button"
                                  type="button"
                                  disabled={
                                    modelDownloadInFlight ||
                                    !workspaceId ||
                                    modelId.trim().length === 0
                                  }
                                  onClick={() =>
                                    void onDownloadGenerationModel()
                                  }
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
                            ) : modelDownloadStatus.message &&
                              modelDownloadStatus.kind === "success" ? (
                              <p role="status">{modelDownloadStatus.message}</p>
                            ) : null}
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
                              <label className="ui-stack ui-stack--sm">
                                <span>
                                  <TermWithHint termId="maxExamplesPerChunk">
                                    Max examples/chunk
                                  </TermWithHint>
                                </span>
                                <input
                                  className="ui-input"
                                  value={maxExamplesPerChunk}
                                  onChange={(event) =>
                                    setMaxExamplesPerChunk(event.target.value)
                                  }
                                />
                              </label>
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
                      <dt>Rows checked</dt>
                      <dd>{qualityReview.report.counts.inputRows}</dd>
                      <dt>Rows ready</dt>
                      <dd>{qualityReview.report.counts.acceptedRows}</dd>
                      <dt>Rows set aside</dt>
                      <dd>{qualityReview.report.counts.quarantinedRows}</dd>
                    </dl>
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
                        No rows were set aside by the selected checks.
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

                {renderCollapsibleSection(
                  "output-destinations",
                  "Save and publish",
                  <div className="ui-stack ui-stack--sm">
                    <p className="dataset-preparation__section-description ui-text-muted">
                      The prepared dataset is saved locally as a reusable
                      version first.
                    </p>
                    <p>After it is saved, use <strong>Saved versions</strong> to publish it privately or publicly.</p>
                  </div>,
                )}

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
                  {hasTrainingSettingsChanges ? (
                    <button
                      className="ui-button dataset-preparation__save-settings-action"
                      type="button"
                      onClick={() => onSaveTrainingSettings()}
                    >
                      <ApplicationIcon name="save" />
                      <span className="ui-button__label">
                        Save training settings
                      </span>
                    </button>
                  ) : null}
                </div>
              </WorkflowStep>
            </WorkflowSequence>
          </fieldset>
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
