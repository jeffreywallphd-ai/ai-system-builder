import { useEffect, useState } from "react";

import {
  type DesktopDatasetPreparationClient,
} from "../api/desktopDatasetPreparationClient";
import type { DesktopPythonRuntimeClient } from "../../python-runtime/api/desktopPythonRuntimeClient";
import type { DesktopApplicationSettingsClient } from "../../settings";
import { SettingsPanel } from "../../settings";
import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { useDatasetPreparationFeature } from "../hooks/useDatasetPreparationFeature";

export interface DatasetPreparationFeatureProps {
  onPrepared?: () => void;
  client?: DesktopDatasetPreparationClient;
  settingsClient?: DesktopApplicationSettingsClient;
  runtimeStatusClient?: Pick<DesktopPythonRuntimeClient, "readStatus" | "controlRuntime">;
}

export function DatasetPreparationFeature({ onPrepared, client, settingsClient, runtimeStatusClient }: DatasetPreparationFeatureProps) {
  const {
    artifacts,
    filteredArtifacts,
    uploadedArtifacts,
    generatedArtifacts,
    selectedArtifactStorageFilter,
    selectedArtifactIds,
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
    defaultHuggingFaceNamespace,
    status,
    resultSummary,
    canUnloadModel,
    stopTrainingInFlight,
    unloadModelInFlight,
    onToggleArtifact,
    setSelectedArtifactStorageFilter,
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
    onSubmit,
    onStopTraining,
    onUnloadModel,
  } = useDatasetPreparationFeature({
    client,
    settingsClient,
    runtimeStatusClient,
    onPrepared,
  });
  const [showModelOverrides, setShowModelOverrides] = useState(false);
  const [showHuggingFaceDefaults, setShowHuggingFaceDefaults] = useState(false);
  const formLocked = status.kind === "loading";
  const showUploadedArtifacts = selectedArtifactStorageFilter !== "generated";
  const showGeneratedArtifacts = selectedArtifactStorageFilter !== "uploaded";

  useEffect(() => {
    if (formLocked) {
      setShowModelOverrides(false);
      setShowHuggingFaceDefaults(false);
    }
  }, [formLocked]);

  return (
    <section className="ui-panel ui-panel--elevated ui-stack ui-stack--sm">
      <h2 className="ui-panel__title">Dataset Preparation</h2>
      <p>Prepare training datasets from selected artifacts.</p>
      <form className="ui-stack ui-stack--sm" onSubmit={(event) => void onSubmit(event)}>
        <fieldset className="ui-stack ui-stack--sm" disabled={formLocked}>
        <section className="ui-stack ui-stack--sm">
          <h3>Source artifacts</h3>
          <label className="ui-stack ui-stack--sm">
            <span>Filter artifacts</span>
            <select
              className="ui-input"
              value={selectedArtifactStorageFilter}
              onChange={(event) => setSelectedArtifactStorageFilter(event.target.value as typeof selectedArtifactStorageFilter)}
            >
              <option value="all">All artifacts</option>
              <option value="uploaded">Uploaded artifacts</option>
              <option value="generated">Generated artifacts</option>
            </select>
          </label>
          {artifacts.length === 0 ? <p>No artifacts available yet.</p> : (
            <>
              <section className="ui-stack ui-stack--sm">
                <h4>Uploaded Artifacts</h4>
                {!showUploadedArtifacts ? <p className="ui-text-muted">Filtered out.</p> : uploadedArtifacts.length === 0 ? <p>No uploaded artifacts available.</p> : uploadedArtifacts.map((artifact) => (
                  <label key={artifact.artifactId}>
                    <input
                      type="checkbox"
                      checked={selectedArtifactIds.includes(artifact.artifactId)}
                      onChange={() => onToggleArtifact(artifact.artifactId)}
                    />
                    {artifact.label}
                  </label>
                ))}
              </section>
              <section className="ui-stack ui-stack--sm">
                <h4>Generated Artifacts</h4>
                {!showGeneratedArtifacts ? <p className="ui-text-muted">Filtered out.</p> : generatedArtifacts.length === 0 ? <p>No generated artifacts available.</p> : generatedArtifacts.map((artifact) => (
                  <label key={artifact.artifactId}>
                    <input
                      type="checkbox"
                      checked={selectedArtifactIds.includes(artifact.artifactId)}
                      onChange={() => onToggleArtifact(artifact.artifactId)}
                    />
                    {artifact.label}
                  </label>
                ))}
              </section>
              {selectedArtifactStorageFilter !== "all" ? (
                <p className="ui-text-muted">Showing {filteredArtifacts.length} artifact(s) for the selected filter.</p>
              ) : null}
            </>
          )}
        </section>

        <section className="ui-stack ui-stack--sm">
          <h3>Normalization</h3>
          <div className="ui-grid ui-grid--two">
            <label className="ui-stack ui-stack--sm">
              <span>Unsupported document policy</span>
              <select
                className="ui-input"
                value={unsupportedDocumentPolicy}
                onChange={(event) => setUnsupportedDocumentPolicy(event.target.value as typeof unsupportedDocumentPolicy)}
              >
                <option value="">Runtime default</option>
                <option value="fail">Fail</option>
                <option value="skip">Skip</option>
              </select>
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Normalization mode</span>
              <select
                className="ui-input"
                value={normalizationMode}
                onChange={(event) => setNormalizationMode(event.target.value as typeof normalizationMode)}
              >
                <option value="">Runtime default</option>
                <option value="strict">Strict</option>
                <option value="best-effort">Best effort</option>
              </select>
            </label>
          </div>
        </section>

        <section className="ui-stack ui-stack--sm">
          <h3>Chunking</h3>
          <div className="ui-grid ui-grid--two">
            <label className="ui-stack ui-stack--sm">
              <span>Chunk size</span>
              <input className="ui-input" value={chunkSize} onChange={(event) => setChunkSize(event.target.value)} />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Chunk overlap</span>
              <input className="ui-input" value={chunkOverlap} onChange={(event) => setChunkOverlap(event.target.value)} />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Max chunk count (optional)</span>
              <input className="ui-input" value={maxChunkCount} onChange={(event) => setMaxChunkCount(event.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={preserveDocumentBoundaries}
                onChange={(event) => setPreserveDocumentBoundaries(event.target.checked)}
              />
              Preserve document boundaries
            </label>
          </div>
        </section>

        <section className="ui-stack ui-stack--sm">
          <h3>Generation</h3>
          <p className="ui-text-muted">Model override applies to this run only. Save global defaults from settings panels below.</p>
          <SettingsPanel
            compact
            title="Dataset preparation model defaults"
            keys={[
              "features.datasetPreparation.qaGeneration.default",
              "models.tasks.qaGeneration.default",
            ]}
          />
          <CollapsiblePanel
            title="Model override defaults"
            isExpanded={showModelOverrides}
            onToggle={() => setShowModelOverrides((current) => !current)}
          >
            <div className="ui-grid ui-grid--two">
            <label className="ui-stack ui-stack--sm">
              <span>Model ID</span>
              <input className="ui-input" value={modelId} onChange={(event) => setModelId(event.target.value)} />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Inference mode</span>
              <select className="ui-input" value={modelInferenceMode} onChange={(event) => setModelInferenceMode(event.target.value as typeof modelInferenceMode)}>
                <option value="auto">auto</option>
                <option value="text2text">text2text</option>
                <option value="causal">causal</option>
                <option value="chat">chat</option>
              </select>
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Model device</span>
              <select className="ui-input" value={modelDevice} onChange={(event) => setModelDevice(event.target.value as typeof modelDevice)}>
                <option value="">Runtime default</option>
                <option value="auto">Auto</option>
                <option value="cpu">CPU</option>
                <option value="cuda">CUDA</option>
              </select>
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Torch dtype</span>
              <select
                className="ui-input"
                value={modelTorchDtype}
                onChange={(event) => setModelTorchDtype(event.target.value as typeof modelTorchDtype)}
              >
                <option value="">Runtime default</option>
                <option value="auto">Auto</option>
                <option value="float16">float16</option>
                <option value="bfloat16">bfloat16</option>
                <option value="float32">float32</option>
              </select>
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Failure policy</span>
              <select className="ui-input" value={failurePolicy} onChange={(event) => setFailurePolicy(event.target.value as typeof failurePolicy)}>
                <option value="">Runtime default</option>
                <option value="fail">Fail</option>
                <option value="skip">Skip</option>
              </select>
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Max examples/chunk (optional)</span>
              <input className="ui-input" value={maxExamplesPerChunk} onChange={(event) => setMaxExamplesPerChunk(event.target.value)} />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Batch size (optional)</span>
              <input className="ui-input" value={batchSize} onChange={(event) => setBatchSize(event.target.value)} />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Temperature (optional)</span>
              <input
                className="ui-input"
                value={generationTemperature}
                onChange={(event) => setGenerationTemperature(event.target.value)}
              />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Top P (optional)</span>
              <input className="ui-input" value={generationTopP} onChange={(event) => setGenerationTopP(event.target.value)} />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>Max new tokens (optional)</span>
              <input
                className="ui-input"
                value={generationMaxNewTokens}
                onChange={(event) => setGenerationMaxNewTokens(event.target.value)}
              />
            </label>
            </div>
          </CollapsiblePanel>
        </section>

        <section className="ui-grid ui-grid--two">
          <label className="ui-stack ui-stack--sm">
            <span>Train ratio</span>
            <input className="ui-input" value={trainRatio} onChange={(event) => setTrainRatio(event.target.value)} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>Test ratio</span>
            <input className="ui-input" value={testRatio} onChange={(event) => setTestRatio(event.target.value)} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>Seed (optional)</span>
            <input className="ui-input" value={seed} onChange={(event) => setSeed(event.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} />
            Shuffle rows
          </label>
        </section>

        <label className="ui-stack ui-stack--sm">
          <span>Output format</span>
          <select className="ui-input" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as typeof outputFormat)}>
            <option value="parquet">Parquet</option>
            <option value="jsonl">JSONL</option>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label className="ui-stack ui-stack--sm">
          <span>Output base name (optional)</span>
          <input className="ui-input" value={outputBaseName} onChange={(event) => setOutputBaseName(event.target.value)} />
        </label>

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
              checked={localDestinationEnabled}
              onChange={(event) => setLocalDestinationEnabled(event.target.checked)}
            />
            Store locally
          </label>
          <label>
            <input
              type="checkbox"
              checked={huggingFaceDestinationEnabled}
              onChange={(event) => setHuggingFaceDestinationEnabled(event.target.checked)}
            />
            Publish to Hugging Face
          </label>
          {huggingFaceDestinationEnabled ? (
            <div className="ui-grid ui-grid--two">
              <label className="ui-stack ui-stack--sm">
                <span>Dataset repository name</span>
                <input
                  className="ui-input"
                  value={huggingFaceRepository}
                  onChange={(event) => setHuggingFaceRepository(event.target.value)}
                  placeholder={defaultHuggingFaceNamespace ? "your-dataset-repo" : "owner/repository"}
                />
                {defaultHuggingFaceNamespace ? (
                  <small className="ui-text-muted">
                    Namespace: {defaultHuggingFaceNamespace} (publishes to {defaultHuggingFaceNamespace}/{huggingFaceRepository.trim() || "your-dataset-repo"}).
                  </small>
                ) : (
                  <small className="ui-text-muted">Format: owner/repository.</small>
                )}
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>Revision (optional)</span>
                <input className="ui-input" value={huggingFaceRevision} onChange={(event) => setHuggingFaceRevision(event.target.value)} />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>Path prefix (optional)</span>
                <input className="ui-input" value={huggingFacePathPrefix} onChange={(event) => setHuggingFacePathPrefix(event.target.value)} />
              </label>
            </div>
          ) : null}
        </section>

        <button className="ui-button" type="submit" disabled={selectedArtifactIds.length === 0 || status.kind === "loading"}>
          {status.kind === "loading" ? "Preparing..." : "Prepare training dataset"}
        </button>
        </fieldset>
        {status.kind === "loading" ? (
          <button className="ui-button" type="button" onClick={() => void onStopTraining()} disabled={stopTrainingInFlight}>
            {stopTrainingInFlight ? "Stopping training..." : "Stop training"}
          </button>
        ) : null}
        {canUnloadModel ? (
          <button className="ui-button" type="button" onClick={() => void onUnloadModel()} disabled={unloadModelInFlight}>
            {unloadModelInFlight ? "Unloading model..." : "Unload model"}
          </button>
        ) : null}
      </form>

      {status.message ? <p role={status.kind === "error" ? "alert" : "status"}>{status.message}</p> : null}
      {resultSummary ? (
        <dl className="ui-grid ui-grid--two">
          <dt>Dataset artifact</dt>
          <dd>{resultSummary.datasetKey}</dd>
          <dt>Dataset rows</dt>
          <dd>{resultSummary.datasetRows}</dd>
        </dl>
      ) : null}
    </section>
  );
}
