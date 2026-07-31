import { useEffect, useState } from "react";

import {
  ApplicationIcon,
  EmptyState,
  formatImageGenerationModelDropdownLabel,
  PanelHeading,
  TermWithHint,
  TransientNotificationPublisher,
  WorkflowSequence,
  WorkflowStep,
} from "../../../../../../modules/ui/shared";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { secureFetch } from "../../../security/secureFetch";
import { useImageGenerationFeature } from "../hooks/useImageGenerationFeature";

function GeneratedImagePreview({ src, alt }: { src: string; alt: string }) {
  const [objectUrl, setObjectUrl] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl: string | undefined;
    setObjectUrl(undefined);
    setFailed(false);

    void secureFetch(src, {
      method: "GET",
      headers: { "x-client-source": "thin-client.image-generation.preview" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Image preview request failed with HTTP ${response.status}.`,
          );
        }
        const blob = await response.blob();
        if (cancelled) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [src]);

  if (failed) {
    return <p role="alert">Image preview could not be loaded.</p>;
  }

  if (!objectUrl) {
    return (
      <p role="status">
        <LoadingSpinner label="Loading image preview" /> Loading image
        preview...
      </p>
    );
  }

  return <img src={objectUrl} alt={alt} />;
}

function renderImageGenerationNumericLabel(label: string) {
  if (label.startsWith("Seed")) {
    return (
      <>
        <TermWithHint termId="seed">Seed</TermWithHint> (optional)
      </>
    );
  }
  if (label === "Steps") {
    return <TermWithHint termId="steps">Steps</TermWithHint>;
  }
  if (label === "Width") {
    return <TermWithHint termId="width">Width</TermWithHint>;
  }
  if (label === "Height") {
    return <TermWithHint termId="height">Height</TermWithHint>;
  }
  if (label === "CFG") {
    return <TermWithHint termId="cfg">CFG</TermWithHint>;
  }
  if (label === "Sampler") {
    return <TermWithHint termId="sampler">Sampler</TermWithHint>;
  }
  if (label === "Scheduler") {
    return <TermWithHint termId="scheduler">Scheduler</TermWithHint>;
  }
  if (label === "Number of Images") {
    return (
      <TermWithHint termId="numberOfImages">Number of Images</TermWithHint>
    );
  }
  return label;
}

export function ImageGenerationFeature({
  onGenerated,
  onNavigateToArtifacts,
  onNavigateToModels,
  workspaceId,
}: {
  onGenerated?: () => void;
  onNavigateToArtifacts?: () => void;
  onNavigateToModels?: () => void;
  workspaceId?: string;
  workspaceName?: string;
} = {}) {
  const feature = useImageGenerationFeature(
    undefined,
    () => onGenerated?.(),
    undefined,
    undefined,
    workspaceId,
  );
  const selectedModelDownloaded = feature.selectedModelRecord
    ? ["downloaded", "generated", "validated"].includes(
        feature.selectedModelRecord.lifecycleStatus,
      )
    : false;
  const isBusy = ["starting", "queued", "running", "finalizing"].includes(
    feature.status,
  );

  const setFormValue = (key: keyof typeof feature.form, value: string) => {
    feature.setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <section
      className="ui-panel ui-panel--elevated ui-panel--sectioned"
      aria-label="Image Generation"
    >
      <header className="ui-panel__section-header">
        <PanelHeading icon="image-generation" tone="violet">
          Image Generation
        </PanelHeading>
      </header>
      <div className="ui-panel__section-body image-generation-workflow ui-stack ui-stack--sm">
        <p className="ui-text-muted">
          Generate images from a prompt. Completed generations are registered in
          Artifacts automatically.
        </p>

        <WorkflowSequence ariaLabel="Image generation workflow">
          <WorkflowStep
            title="Model and runtime"
            description="Choose an available image model and the server runtime mode."
          >
            <div className="ui-workflow__field-grid ui-workflow__field-grid--wide">
              <label className="ui-stack ui-stack--xs">
                <span>
                  <TermWithHint termId="modelInventory">Model</TermWithHint>{" "}
                  (server inventory)
                </span>
                <select
                  className="ui-input"
                  id="image-generation-model-record"
                  value={feature.selectedModelRecordId}
                  onChange={(event) =>
                    feature.setSelectedModelRecordId(event.target.value)
                  }
                >
                  <option value="">Select a server model...</option>
                  <optgroup label="Downloaded image models">
                    {feature.downloadedImageGenerationModels.map((model) => (
                      <option
                        key={model.modelRecordId}
                        value={model.modelRecordId}
                      >
                        {formatImageGenerationModelDropdownLabel(model)}
                      </option>
                    ))}
                  </optgroup>
                  {feature.referenceOnlyImageGenerationModels.length > 0 ? (
                    <optgroup label="Saved references / download required">
                      {feature.referenceOnlyImageGenerationModels.map(
                        (model) => (
                          <option
                            key={model.modelRecordId}
                            value={model.modelRecordId}
                          >
                            {formatImageGenerationModelDropdownLabel(
                              model,
                              true,
                            )}
                          </option>
                        ),
                      )}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              <label className="ui-stack ui-stack--xs">
                <span>
                  <TermWithHint termId="runtime">Runtime mode</TermWithHint>
                </span>
                <select
                  className="ui-input"
                  id="image-generation-runtime-mode"
                  value={feature.runtimeMode}
                  onChange={(event) =>
                    feature.setRuntimeMode(
                      event.target.value as typeof feature.runtimeMode,
                    )
                  }
                >
                  <option value="auto">Auto</option>
                  <option value="cpu">CPU</option>
                  <option value="cuda">CUDA</option>
                  <option value="directml">DirectML</option>
                </select>
              </label>
            </div>
            <div className="ui-workflow__actions">
              <button
                type="button"
                className="ui-button"
                onClick={() => void feature.refreshModelInventory()}
                disabled={feature.modelInventoryLoading}
              >
                <ApplicationIcon name="refresh" />
                <span className="ui-button__label">Refresh Models</span>
              </button>
              {feature.downloadedImageGenerationModels.length === 0 &&
              onNavigateToModels ? (
                <button
                  type="button"
                  className="ui-button ui-button--outline"
                  onClick={onNavigateToModels}
                >
                  <ApplicationIcon name="models" />
                  <span className="ui-button__label">Open Models</span>
                </button>
              ) : null}
            </div>
            {feature.modelInventoryLoading ? (
              <p className="ui-text-muted" role="status">
                <LoadingSpinner label="Loading model inventory" /> Loading model
                inventory...
              </p>
            ) : null}
            {feature.modelInventoryError ? (
              <p role="alert">{feature.modelInventoryError}</p>
            ) : null}
            {feature.downloadedImageGenerationModels.length === 0 ? (
              <p className="ui-text-muted" role="note">
                No downloaded image models found. A configured server default
                checkpoint or manual override may still be used.
              </p>
            ) : null}
            {feature.selectedModelRecord ? (
              <p role="note">
                Selected model status:{" "}
                <strong>{feature.selectedModelRecord.lifecycleStatus}</strong>
                {!selectedModelDownloaded
                  ? " (reference only; download before generating)."
                  : " (available locally)."}
              </p>
            ) : null}
          </WorkflowStep>

          <WorkflowStep
            title="Prompt and references"
            description="Describe the image and optionally provide latent or identity references."
          >
            <div className="ui-workflow__field-grid ui-workflow__field-grid--wide">
              <label className="ui-stack ui-stack--xs">
                <span>
                  <TermWithHint termId="latentSourceArtifact">
                    Latent source
                  </TermWithHint>
                </span>
                <select
                  className="ui-input"
                  id="image-generation-latent-source"
                  value={feature.form.latentSourceArtifactId}
                  onChange={(event) =>
                    setFormValue("latentSourceArtifactId", event.target.value)
                  }
                >
                  <option value="">Empty latent image</option>
                  {feature.imageArtifacts.map((artifact) => (
                    <option
                      key={artifact.storageKey}
                      value={artifact.storageKey}
                    >
                      {artifact.originalName ?? artifact.storageKey}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ui-workflow__actions">
                <button
                  type="button"
                  className="ui-button ui-button--outline"
                  onClick={() => void feature.refreshImageArtifacts()}
                  disabled={feature.imageArtifactsLoading}
                >
                  <ApplicationIcon name="refresh" />
                  <span className="ui-button__label">Refresh Images</span>
                </button>
              </div>
            </div>
            {feature.imageArtifactsError ? (
              <p role="alert">{feature.imageArtifactsError}</p>
            ) : null}

            <label className="ui-workflow__checkbox-row">
              <input
                type="checkbox"
                checked={feature.form.faceIdEnabled}
                onChange={(event) =>
                  feature.setForm((current) => ({
                    ...current,
                    faceIdEnabled: event.target.checked,
                  }))
                }
              />
              <span>
                <TermWithHint termId="faceId">Enable FaceID</TermWithHint>{" "}
                (optional)
              </span>
            </label>
            {feature.form.faceIdEnabled ? (
              <div className="ui-workflow__subpanel ui-stack ui-stack--sm">
                <p className="ui-text-muted">
                  FaceID supports one to three image artifacts. The same
                  artifact may be reused in multiple slots.
                </p>
                <div className="ui-workflow__field-grid">
                  {[
                    "faceIdArtifactId1",
                    "faceIdArtifactId2",
                    "faceIdArtifactId3",
                  ].map((key, index) => (
                    <label className="ui-stack ui-stack--xs" key={key}>
                      <span>
                        <TermWithHint termId="faceReferenceImage">
                          Face reference image {index + 1}
                        </TermWithHint>{" "}
                        {index > 0 ? "(optional)" : null}
                      </span>
                      <select
                        className="ui-input"
                        value={String(
                          feature.form[key as keyof typeof feature.form],
                        )}
                        onChange={(event) =>
                          setFormValue(
                            key as keyof typeof feature.form,
                            event.target.value,
                          )
                        }
                      >
                        <option value="">Select image artifact</option>
                        {feature.imageArtifacts.map((artifact) => (
                          <option
                            key={`${key}-${artifact.storageKey}`}
                            value={artifact.storageKey}
                          >
                            {artifact.originalName ?? artifact.storageKey}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="ui-workflow__field-grid">
                  {(
                    [
                      [
                        "faceIdIdentityStrength",
                        "faceIdentityWeight",
                        "Face identity strength",
                      ],
                      [
                        "faceIdStructureStrength",
                        "faceStructureWeight",
                        "Face structure strength",
                      ],
                      ["faceIdNoise", "faceNoise", "Face noise"],
                    ] as const
                  ).map(([key, termId, label]) => (
                    <label className="ui-stack ui-stack--xs" key={key}>
                      <span>
                        <TermWithHint termId={termId}>{label}</TermWithHint>
                      </span>
                      <input
                        className="ui-input"
                        type="number"
                        step="0.01"
                        value={String(
                          feature.form[key as keyof typeof feature.form],
                        )}
                        onInput={(event) =>
                          setFormValue(
                            key as keyof typeof feature.form,
                            event.currentTarget.value,
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="ui-stack ui-stack--xs">
              <span>
                <TermWithHint termId="prompt">Prompt</TermWithHint>
              </span>
              <textarea
                className="ui-input ui-textarea"
                id="image-generation-prompt"
                value={feature.form.prompt}
                onInput={(event) =>
                  setFormValue("prompt", event.currentTarget.value)
                }
              />
            </label>
            <label className="ui-stack ui-stack--xs">
              <span>
                <TermWithHint termId="negativePrompt">
                  Negative Prompt
                </TermWithHint>{" "}
                (optional)
              </span>
              <textarea
                className="ui-input ui-textarea"
                id="image-generation-negativePrompt"
                value={feature.form.negativePrompt}
                onInput={(event) =>
                  setFormValue("negativePrompt", event.currentTarget.value)
                }
              />
            </label>
          </WorkflowStep>

          <WorkflowStep
            title="Generation settings"
            description="Set dimensions, sampling behavior, and output count."
          >
            <div className="ui-workflow__field-grid">
              {[
                ["seed", "Seed (optional)", "number"],
                ["width", "Width", "number"],
                ["height", "Height", "number"],
                ["steps", "Steps", "number"],
                ["cfg", "CFG", "number"],
                ["sampler", "Sampler", "text"],
                ["scheduler", "Scheduler", "text"],
                ["numImages", "Number of Images", "number"],
              ].map(([key, label, type]) => {
                const formKey = key as keyof typeof feature.form;
                const id = `image-generation-${key}`;
                return (
                  <label key={id} className="ui-stack ui-stack--xs">
                    <span>{renderImageGenerationNumericLabel(label)}</span>
                    <input
                      className="ui-input"
                      id={id}
                      type={type}
                      value={String(feature.form[formKey])}
                      onInput={(event) =>
                        setFormValue(formKey, event.currentTarget.value)
                      }
                    />
                  </label>
                );
              })}
              <label className="ui-stack ui-stack--xs">
                <span>
                  <TermWithHint termId="denoise">Denoise</TermWithHint>
                </span>
                <input
                  className="ui-input"
                  id="image-generation-denoise"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={feature.form.denoise}
                  onInput={(event) =>
                    setFormValue("denoise", event.currentTarget.value)
                  }
                />
                <output htmlFor="image-generation-denoise">
                  {feature.form.denoise}
                </output>
              </label>
            </div>
            <details className="ui-workflow__subpanel">
              <summary>
                Advanced: Manual model/checkpoint override (optional)
              </summary>
              <label className="ui-stack ui-stack--xs">
                <span>
                  Manual{" "}
                  <TermWithHint termId="model">model/checkpoint</TermWithHint>
                </span>
                <input
                  className="ui-input"
                  id="image-generation-model"
                  type="text"
                  value={feature.form.model}
                  onInput={(event) =>
                    setFormValue("model", event.currentTarget.value)
                  }
                  placeholder="checkpoint.safetensors or model record id"
                />
              </label>
            </details>
          </WorkflowStep>

          <WorkflowStep
            title="Review and generate"
            description="Review the configuration and start the generation run."
            active={!feature.isGenerateDisabled}
          >
            {feature.qualityNote ? (
              <p role="note">{feature.qualityNote}</p>
            ) : null}
            {feature.validationError ? (
              <p role="alert">{feature.validationError}</p>
            ) : null}
            <div className="ui-workflow__actions">
              <button
                className="ui-button"
                type="button"
                onClick={() => void feature.start()}
                disabled={feature.isGenerateDisabled}
              >
                {feature.isGenerateDisabled ? (
                  <LoadingSpinner label="Generating image" />
                ) : (
                  <ApplicationIcon name="play" />
                )}
                <span className="ui-button__label">
                  {feature.isGenerateDisabled ? "Generating..." : "Generate"}
                </span>
              </button>
              <button
                className="ui-button ui-button--outline"
                type="button"
                onClick={() => void feature.cancel()}
                disabled={feature.isCancelDisabled}
              >
                <ApplicationIcon name="close" />
                <span className="ui-button__label">Cancel</span>
              </button>
              <button
                className="ui-button ui-button--outline"
                type="button"
                onClick={() => onNavigateToArtifacts?.()}
              >
                <ApplicationIcon name="artifacts" />
                <span className="ui-button__label">Open Artifacts</span>
              </button>
              <button
                className="ui-button ui-button--outline"
                type="button"
                onClick={() => void feature.unloadModel()}
                disabled={feature.isUnloadModelDisabled}
              >
                <ApplicationIcon name="models" />
                <span className="ui-button__label">
                  {feature.unloadModelState.status === "loading"
                    ? "Unloading model..."
                    : "Unload model"}
                </span>
              </button>
            </div>
          </WorkflowStep>

          <WorkflowStep
            title="Generation progress"
            description="Monitor runtime status and resource use for this request."
            active={isBusy}
          >
            <div className="ui-workflow__status ui-stack ui-stack--sm">
              <p role={isBusy ? "status" : undefined}>
                {isBusy ? (
                  <LoadingSpinner label="Image generation in progress" />
                ) : null}{" "}
                <strong>{feature.status}</strong>
              </p>
              <dl className="ui-workflow__field-grid">
                <div>
                  <dt>Memory</dt>
                  <dd>
                    {feature.runtimeResources.memoryUsagePercent.toFixed(1)}%
                  </dd>
                </div>
                <div>
                  <dt>CPU</dt>
                  <dd>
                    {feature.runtimeResources.cpuUsagePercent.toFixed(1)}%
                  </dd>
                </div>
                <div>
                  <dt>GPU</dt>
                  <dd>
                    {feature.runtimeResources.gpuUsagePercent.toFixed(1)}%
                  </dd>
                </div>
              </dl>
              {feature.requestId ? (
                <p>Request ID: {feature.requestId}</p>
              ) : null}
              {feature.error ? <p role="alert">{feature.error}</p> : null}
              <TransientNotificationPublisher message={feature.unloadModelState.status !== "loading" ? feature.unloadModelState.message : undefined} title={feature.unloadModelState.status === "error" ? "Model unload needs attention" : "Model unloaded"} tone={feature.unloadModelState.status === "error" ? "error" : "success"} source="Image Generation" workspaceId={workspaceId} />
            </div>
          </WorkflowStep>

          <WorkflowStep
            title="Generated images"
            description="Review the current outputs and prior generations from this session."
            active={feature.results.length > 0}
          >
            {feature.results.length > 0 ? (
              <div className="image-generation-current-result ui-stack ui-stack--sm">
                {feature.results.map((asset) => (
                  <article
                    key={asset.assetId}
                    className="image-generation-result-card ui-stack ui-stack--xs"
                  >
                    <GeneratedImagePreview
                      src={feature.createPreviewUrl(asset.storageKey)}
                      alt={`Generated image ${asset.assetId}`}
                    />
                    <p>{asset.assetId}</p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon="image-generation"
                title="No generated images yet"
                description="Run image generation to create finalized artifacts."
              />
            )}
            <section
              className="ui-stack ui-stack--sm"
              aria-label="Session gallery"
            >
              <h4>Session Gallery</h4>
              {feature.sessionGallery.length > 0 ? (
                <div className="image-generation-session-gallery image-generation-session-gallery--single">
                  {feature.sessionGallery.map((generation) => (
                    <article
                      key={generation.id}
                      className="ui-stack ui-stack--xs"
                    >
                      {generation.assets.map((asset) => (
                        <GeneratedImagePreview
                          key={`${generation.id}-${asset.assetId}`}
                          src={feature.createPreviewUrl(asset.storageKey)}
                          alt={`Previous generated image ${asset.assetId}`}
                        />
                      ))}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="ui-text-muted">
                  Previous generations from this session will appear here.
                </p>
              )}
            </section>
          </WorkflowStep>
        </WorkflowSequence>
      </div>
    </section>
  );
}
