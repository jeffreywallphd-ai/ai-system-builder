import { useState } from "react";

import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { SettingsPanel } from "../../settings";
import type { useModelTrainingFeature } from "../hooks/useModelTrainingFeature";

function toDatasetOptionLabel(storageKey: string, originalName?: string): string {
  if (originalName && originalName.trim().length > 0) {
    return originalName;
  }

  const storageSegments = storageKey.split("/");
  return storageSegments[storageSegments.length - 1] ?? storageKey;
}

type ModelTrainingState = ReturnType<typeof useModelTrainingFeature>;

export function TrainModelTab(props: { state: ModelTrainingState }) {
  const s = props.state;
  const [showHuggingFaceDefaults, setShowHuggingFaceDefaults] = useState(false);

  return (
    <section className="ui-panel ui-panel--elevated ui-stack ui-stack--sm">
      <h2>Train Model</h2>
      <p>Current backend support: LoRA, QLoRA, and full fine-tuning when runtime dependencies are available.</p>

      <label className="ui-stack ui-stack--sm">
        <span>Base model</span>
        <select className="ui-input" value={s.baseModelRecordId} onChange={(event) => s.setBaseModelRecordId(event.target.value)}>
          <option value="">Select model</option>
          {s.models.map((model) => (
            <option key={model.modelRecordId} value={model.modelRecordId}>
              {model.displayName} · {model.modelId ?? model.localPath ?? "n/a"} · {model.source} · {model.lifecycleStatus}
            </option>
          ))}
        </select>
      </label>

      <label className="ui-stack ui-stack--sm">
        <span>Training datasets (Parquet artifacts)</span>
        <select
          className="ui-input"
          multiple
          value={s.selectedDatasetArtifactIds}
          onChange={(event) => {
            const selectedOptions = Array.from(event.target.selectedOptions).map((option) => option.value);
            s.setSelectedDatasetArtifactIds(selectedOptions);
          }}
        >
          {s.datasetArtifacts.map((artifact) => (
            <option key={artifact.artifactId} value={artifact.artifactId}>
              {toDatasetOptionLabel(artifact.storageKey, artifact.originalName)} ({artifact.artifactId})
            </option>
          ))}
        </select>
      </label>

      <label className="ui-stack ui-stack--sm">
        <span>Method</span>
        <select className="ui-input" value={s.method} onChange={(event) => s.setMethod(event.target.value as "lora" | "qlora" | "full-finetune") }>
          <option value="lora">lora</option>
          <option value="qlora">qlora</option>
          <option value="full-finetune">full-finetune</option>
        </select>
      </label>

      <div className="ui-grid ui-grid--two">
        <label className="ui-stack ui-stack--sm"><span>Epochs</span><input className="ui-input" value={s.numEpochs} onChange={(e) => s.setNumEpochs(e.target.value)} /></label>
        <label className="ui-stack ui-stack--sm"><span>Max steps</span><input className="ui-input" value={s.maxSteps} onChange={(e) => s.setMaxSteps(e.target.value)} /></label>
        <label className="ui-stack ui-stack--sm"><span>Batch size</span><input className="ui-input" value={s.batchSize} onChange={(e) => s.setBatchSize(e.target.value)} /></label>
        <label className="ui-stack ui-stack--sm"><span>Learning rate</span><input className="ui-input" value={s.learningRate} onChange={(e) => s.setLearningRate(e.target.value)} /></label>
        <label className="ui-stack ui-stack--sm"><span>Sequence length</span><input className="ui-input" value={s.maxSequenceLength} onChange={(e) => s.setMaxSequenceLength(e.target.value)} /></label>
        <label className="ui-stack ui-stack--sm"><span>Seed</span><input className="ui-input" value={s.seed} onChange={(e) => s.setSeed(e.target.value)} /></label>
      </div>

      <button className="ui-button" type="button" onClick={() => s.setShowAdvanced(!s.showAdvanced)}>
        {s.showAdvanced ? "Hide Advanced" : "Show Advanced"}
      </button>

      {s.showAdvanced ? (
        <div className="ui-grid ui-grid--two">
          <label className="ui-stack ui-stack--sm"><span>LoRA rank</span><input className="ui-input" value={s.loraRank} onChange={(e) => s.setLoraRank(e.target.value)} /></label>
          <label className="ui-stack ui-stack--sm"><span>LoRA alpha</span><input className="ui-input" value={s.loraAlpha} onChange={(e) => s.setLoraAlpha(e.target.value)} /></label>
          <label className="ui-stack ui-stack--sm"><span>LoRA dropout</span><input className="ui-input" value={s.loraDropout} onChange={(e) => s.setLoraDropout(e.target.value)} /></label>
          <label className="ui-stack ui-stack--sm"><span>Target modules</span><input className="ui-input" value={s.loraTargetModules} onChange={(e) => s.setLoraTargetModules(e.target.value)} /></label>
          <label className="ui-stack ui-stack--sm"><span>Grad accumulation</span><input className="ui-input" value={s.gradientAccumulationSteps} onChange={(e) => s.setGradientAccumulationSteps(e.target.value)} /></label>
          <label className="ui-stack ui-stack--sm"><span>Checkpoint interval</span><input className="ui-input" value={s.checkpointIntervalSteps} onChange={(e) => s.setCheckpointIntervalSteps(e.target.value)} /></label>
          <label className="ui-stack ui-stack--sm"><span>Eval interval</span><input className="ui-input" value={s.evalIntervalSteps} onChange={(e) => s.setEvalIntervalSteps(e.target.value)} /></label>
        </div>
      ) : null}

      <div className="ui-grid ui-grid--two">
        <label className="ui-stack ui-stack--sm"><span>Output model name</span><input className="ui-input" value={s.outputModelName} onChange={(e) => s.setOutputModelName(e.target.value)} /></label>
        <label className="ui-stack ui-stack--sm"><span>Generated model display name</span><input className="ui-input" value={s.generatedDisplayName} onChange={(e) => s.setGeneratedDisplayName(e.target.value)} /></label>
        <label className="ui-stack ui-stack--sm"><span>Max safetensors shard size</span><input className="ui-input" value={s.maxShardSize} onChange={(e) => s.setMaxShardSize(e.target.value)} /></label>
      </div>

      <section className="ui-stack ui-stack--sm">
        <h3>Output destinations</h3>
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
        <label>
          <input
            type="checkbox"
            checked={s.localDestinationEnabled}
            onChange={(event) => s.setLocalDestinationEnabled(event.target.checked)}
          />
          Store locally
        </label>
        <label>
          <input
            type="checkbox"
            checked={s.huggingFaceDestinationEnabled}
            onChange={(event) => s.setHuggingFaceDestinationEnabled(event.target.checked)}
          />
          Publish to Hugging Face
        </label>
        {s.huggingFaceDestinationEnabled ? (
          <div className="ui-grid ui-grid--two">
            <label className="ui-stack ui-stack--sm">
              <span>Model repository name</span>
              <input
                className="ui-input"
                value={s.huggingFaceRepository}
                onChange={(event) => s.setHuggingFaceRepository(event.target.value)}
                placeholder={s.defaultHuggingFaceNamespace ? "your-model-repo" : "owner/repository"}
              />
              {s.defaultHuggingFaceNamespace ? (
                <small className="ui-text-muted">
                  Namespace: {s.defaultHuggingFaceNamespace} (publishes to {s.defaultHuggingFaceNamespace}/{s.huggingFaceRepository.trim() || "your-model-repo"}).
                </small>
              ) : (
                <small className="ui-text-muted">Format: owner/repository.</small>
              )}
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Revision (optional)</span>
              <input className="ui-input" value={s.huggingFaceRevision} onChange={(event) => s.setHuggingFaceRevision(event.target.value)} />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Path prefix (optional)</span>
              <input className="ui-input" value={s.huggingFacePathPrefix} onChange={(event) => s.setHuggingFacePathPrefix(event.target.value)} />
            </label>
          </div>
        ) : null}
      </section>

      <label className="ui-stack ui-stack--sm">
        <span>Validate after training</span>
        <input type="checkbox" checked={s.validateAfterTraining} onChange={(event) => s.setValidateAfterTraining(event.target.checked)} />
      </label>

      <button className="ui-button" type="button" onClick={() => void s.submitTraining()} disabled={!s.canSubmit}>
        Start Training
      </button>
      {s.message ? <p role={s.status === "failed" ? "alert" : "status"}>{s.message}</p> : null}
      {s.result?.outputModel ? (
        <p>Generated model record: {s.result.outputModel.modelRecordId} · {s.result.outputModel.displayName}</p>
      ) : null}
      {s.result?.validationReportPath ? <p>Validation report: {s.result.validationReportPath}</p> : null}
    </section>
  );
}
