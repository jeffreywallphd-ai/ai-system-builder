import { useState } from "react";

import {
  ApplicationIcon,
  PanelHeading,
  TermWithHint,
  WorkflowSequence,
  WorkflowStep,
} from "../../../../../../../modules/ui/shared";
import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { SettingsPanel } from "../../settings";
import type { useModelTrainingFeature } from "../hooks/useModelTrainingFeature";
import { MODEL_TRAINING_TASK_PROFILE_OPTIONS } from "../profiles/modelTrainingTaskProfiles";

function toDatasetOptionLabel(
  storageKey: string,
  originalName?: string,
): string {
  if (originalName && originalName.trim().length > 0) {
    return originalName;
  }

  const storageSegments = storageKey.split("/");
  return storageSegments[storageSegments.length - 1] ?? storageKey;
}

type ModelTrainingState = ReturnType<typeof useModelTrainingFeature>;

export function TrainModelTab({ state: s }: { state: ModelTrainingState }) {
  const [showHuggingFaceDefaults, setShowHuggingFaceDefaults] = useState(false);

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="models" tone="cyan">
          Train Model
        </PanelHeading>
      </header>
      <div className="ui-panel__section-body model-training-workflow ui-stack ui-stack--sm">
        <p>
          Current backend support: LoRA, QLoRA, and full fine-tuning when
          runtime dependencies are available.
        </p>

        <WorkflowSequence ariaLabel="Model training workflow">
          <WorkflowStep
            title="Training inputs"
            description="Choose a base model and one or more prepared training datasets."
          >
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="model">Base model</TermWithHint>
              </span>
              <select
                className="ui-input"
                value={s.baseModelRecordId}
                onChange={(event) => s.setBaseModelRecordId(event.target.value)}
              >
                <option value="">Select model</option>
                {s.models.map((model) => (
                  <option key={model.modelRecordId} value={model.modelRecordId}>
                    {model.displayName} ·{" "}
                    {model.modelId ?? model.localPath ?? "n/a"} · {model.source}{" "}
                    · {model.lifecycleStatus}
                  </option>
                ))}
              </select>
            </label>

            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="trainingDataset">
                  Training datasets (Parquet artifacts)
                </TermWithHint>
              </span>
              <select
                className="ui-input model-training-workflow__datasets"
                multiple
                value={s.selectedDatasetArtifactIds}
                onChange={(event) => {
                  const selectedOptions = Array.from(
                    event.target.selectedOptions,
                  ).map((option) => option.value);
                  s.setSelectedDatasetArtifactIds(selectedOptions);
                }}
              >
                {s.datasetArtifacts.map((artifact) => (
                  <option key={artifact.artifactId} value={artifact.artifactId}>
                    {toDatasetOptionLabel(
                      artifact.storageKey,
                      artifact.originalName,
                    )}{" "}
                    ({artifact.artifactId})
                  </option>
                ))}
              </select>
            </label>
          </WorkflowStep>

          <WorkflowStep
            title="Training approach"
            description="Select the task profile and fine-tuning method."
          >
            <div className="ui-workflow__field-grid">
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="trainingTask">
                    Training task
                  </TermWithHint>
                </span>
                <select
                  className="ui-input"
                  value={s.trainingTask}
                  onChange={(event) =>
                    s.setTrainingTask(
                      event.target.value as typeof s.trainingTask,
                    )
                  }
                >
                  {MODEL_TRAINING_TASK_PROFILE_OPTIONS.map((option) => (
                    <option key={option.taskType} value={option.taskType}>
                      {option.label} - {option.statusLabel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="trainingMethod">Method</TermWithHint>
                </span>
                <select
                  className="ui-input"
                  value={s.method}
                  onChange={(event) =>
                    s.setMethod(
                      event.target.value as "lora" | "qlora" | "full-finetune",
                    )
                  }
                >
                  <option value="lora">LoRA</option>
                  <option value="qlora">QLoRA</option>
                  <option value="full-finetune">Full fine-tune</option>
                </select>
              </label>
            </div>
          </WorkflowStep>

          <WorkflowStep
            title="Training schedule"
            description="Set the main optimization limits and expand advanced controls when needed."
          >
            <div className="ui-workflow__field-grid">
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="epoch">Epochs</TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.numEpochs}
                  onChange={(event) => s.setNumEpochs(event.target.value)}
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="trainingStepLimit">
                    Max steps
                  </TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.maxSteps}
                  onChange={(event) => s.setMaxSteps(event.target.value)}
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="batchSize">Batch size</TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.batchSize}
                  onChange={(event) => s.setBatchSize(event.target.value)}
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="learningRate">
                    Learning rate
                  </TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.learningRate}
                  onChange={(event) => s.setLearningRate(event.target.value)}
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="sequenceLength">
                    Sequence length
                  </TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.maxSequenceLength}
                  onChange={(event) =>
                    s.setMaxSequenceLength(event.target.value)
                  }
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="seed">Seed</TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.seed}
                  onChange={(event) => s.setSeed(event.target.value)}
                />
              </label>
            </div>

            <CollapsiblePanel
              title="Advanced training settings"
              isExpanded={s.showAdvanced}
              onToggle={() => s.setShowAdvanced(!s.showAdvanced)}
            >
              <div className="ui-workflow__field-grid">
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="loraRank">LoRA rank</TermWithHint>
                  </span>
                  <input
                    className="ui-input"
                    value={s.loraRank}
                    onChange={(event) => s.setLoraRank(event.target.value)}
                  />
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="loraAlpha">LoRA alpha</TermWithHint>
                  </span>
                  <input
                    className="ui-input"
                    value={s.loraAlpha}
                    onChange={(event) => s.setLoraAlpha(event.target.value)}
                  />
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="loraDropout">
                      LoRA dropout
                    </TermWithHint>
                  </span>
                  <input
                    className="ui-input"
                    value={s.loraDropout}
                    onChange={(event) => s.setLoraDropout(event.target.value)}
                  />
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="targetModules">
                      Target modules
                    </TermWithHint>
                  </span>
                  <input
                    className="ui-input"
                    value={s.loraTargetModules}
                    onChange={(event) =>
                      s.setLoraTargetModules(event.target.value)
                    }
                  />
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="gradientAccumulation">
                      Grad accumulation
                    </TermWithHint>
                  </span>
                  <input
                    className="ui-input"
                    value={s.gradientAccumulationSteps}
                    onChange={(event) =>
                      s.setGradientAccumulationSteps(event.target.value)
                    }
                  />
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="checkpointInterval">
                      Checkpoint interval
                    </TermWithHint>
                  </span>
                  <input
                    className="ui-input"
                    value={s.checkpointIntervalSteps}
                    onChange={(event) =>
                      s.setCheckpointIntervalSteps(event.target.value)
                    }
                  />
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="evalInterval">
                      Eval interval
                    </TermWithHint>
                  </span>
                  <input
                    className="ui-input"
                    value={s.evalIntervalSteps}
                    onChange={(event) =>
                      s.setEvalIntervalSteps(event.target.value)
                    }
                  />
                </label>
              </div>
            </CollapsiblePanel>
          </WorkflowStep>

          <WorkflowStep
            title="Output model"
            description="Name the generated model record and control output packaging."
          >
            <div className="ui-workflow__field-grid">
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="outputModelName">
                    Output model name
                  </TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.outputModelName}
                  onChange={(event) => s.setOutputModelName(event.target.value)}
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="assetDisplayName">
                    Generated model display name
                  </TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.generatedDisplayName}
                  onChange={(event) =>
                    s.setGeneratedDisplayName(event.target.value)
                  }
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="safetensors">
                    Max safetensors shard size
                  </TermWithHint>
                </span>
                <input
                  className="ui-input"
                  value={s.maxShardSize}
                  onChange={(event) => s.setMaxShardSize(event.target.value)}
                />
              </label>
            </div>
          </WorkflowStep>

          <WorkflowStep
            title="Output destinations"
            description="Choose local storage, Hugging Face publishing, and post-training validation."
          >
            <CollapsiblePanel
              title="Hugging Face defaults"
              isExpanded={showHuggingFaceDefaults}
              onToggle={() => setShowHuggingFaceDefaults((current) => !current)}
            >
              <SettingsPanel
                compact
                title="Hugging Face defaults"
                keys={["huggingface.token", "huggingface.defaultNamespace"]}
              />
            </CollapsiblePanel>
            <div className="ui-cluster">
              <label className="ui-workflow__checkbox-row">
                <input
                  type="checkbox"
                  checked={s.localDestinationEnabled}
                  onChange={(event) =>
                    s.setLocalDestinationEnabled(event.target.checked)
                  }
                />
                <span>
                  <TermWithHint termId="outputDestination">
                    Store locally
                  </TermWithHint>
                </span>
              </label>
              <label className="ui-workflow__checkbox-row">
                <input
                  type="checkbox"
                  checked={s.huggingFaceDestinationEnabled}
                  onChange={(event) =>
                    s.setHuggingFaceDestinationEnabled(event.target.checked)
                  }
                />
                <span>
                  <TermWithHint termId="huggingFace">
                    Publish to Hugging Face
                  </TermWithHint>
                </span>
              </label>
              <label className="ui-workflow__checkbox-row">
                <input
                  type="checkbox"
                  checked={s.validateAfterTraining}
                  onChange={(event) =>
                    s.setValidateAfterTraining(event.target.checked)
                  }
                />
                <span>
                  <TermWithHint termId="validateAfterTraining">
                    Validate after training
                  </TermWithHint>
                </span>
              </label>
            </div>
            {s.huggingFaceDestinationEnabled ? (
              <div className="ui-workflow__field-grid">
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="repository">
                      Model repository name
                    </TermWithHint>
                  </span>
                  <input
                    className="ui-input"
                    value={s.huggingFaceRepository}
                    onChange={(event) =>
                      s.setHuggingFaceRepository(event.target.value)
                    }
                    placeholder={
                      s.defaultHuggingFaceNamespace
                        ? "your-model-repo"
                        : "owner/repository"
                    }
                  />
                  <small className="ui-text-muted">
                    {s.defaultHuggingFaceNamespace
                      ? `Namespace: ${s.defaultHuggingFaceNamespace} (publishes to ${s.defaultHuggingFaceNamespace}/${s.huggingFaceRepository.trim() || "your-model-repo"}).`
                      : "Format: owner/repository."}
                  </small>
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="revision">Revision</TermWithHint>{" "}
                    (optional)
                  </span>
                  <input
                    className="ui-input"
                    value={s.huggingFaceRevision}
                    onChange={(event) =>
                      s.setHuggingFaceRevision(event.target.value)
                    }
                  />
                </label>
                <label className="ui-stack ui-stack--sm">
                  <span>
                    <TermWithHint termId="pathPrefix">Path prefix</TermWithHint>{" "}
                    (optional)
                  </span>
                  <input
                    className="ui-input"
                    value={s.huggingFacePathPrefix}
                    onChange={(event) =>
                      s.setHuggingFacePathPrefix(event.target.value)
                    }
                  />
                </label>
              </div>
            ) : null}
          </WorkflowStep>

          <WorkflowStep
            title="Review and train"
            description="Review the configuration above and start the training run."
            active={s.canSubmit}
          >
            <div className="ui-workflow__actions">
              <button
                className="ui-button"
                type="button"
                onClick={() => void s.submitTraining()}
                disabled={!s.canSubmit}
              >
                <ApplicationIcon name="play" />
                <span className="ui-button__label">Start Training</span>
              </button>
            </div>
            {s.message ? (
              <p
                className="ui-workflow__status"
                role={s.status === "failed" ? "alert" : "status"}
              >
                {s.message}
              </p>
            ) : null}
            {s.result?.outputModel ? (
              <p className="ui-workflow__status">
                Generated model record: {s.result.outputModel.modelRecordId} ·{" "}
                {s.result.outputModel.displayName}
              </p>
            ) : null}
            {s.result?.validationReportPath ? (
              <p className="ui-workflow__status">
                Validation report: {s.result.validationReportPath}
              </p>
            ) : null}
          </WorkflowStep>
        </WorkflowSequence>
      </div>
    </section>
  );
}
