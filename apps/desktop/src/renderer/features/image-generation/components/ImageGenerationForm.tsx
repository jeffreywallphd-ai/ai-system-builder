import type { ChangeEvent } from "react";

import {
  ApplicationIcon,
  TermWithHint,
  WorkflowStep,
} from "../../../../../../../modules/ui/shared";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import type {
  ImageGenerationArtifactOption,
  ImageGenerationFormValues,
  ImageGenerationModelLoadStatus,
  ImageGenerationModelOption,
} from "../hooks/useImageGenerationFeature";

export interface ImageGenerationFormProps {
  readonly form: ImageGenerationFormValues;
  readonly setForm: (value: ImageGenerationFormValues) => void;
  readonly validationError?: string;
  readonly isStartDisabled: boolean;
  readonly onSubmit: () => void;
  readonly availableModels: ImageGenerationModelOption[];
  readonly availableImageArtifacts?: ImageGenerationArtifactOption[];
  readonly artifactLoadMessage?: string;
  readonly modelLoadStatus: ImageGenerationModelLoadStatus;
  readonly modelLoadMessage?: string;
}

export function ImageGenerationForm({
  form,
  setForm,
  validationError,
  isStartDisabled,
  onSubmit,
  availableModels,
  availableImageArtifacts = [],
  artifactLoadMessage,
  modelLoadStatus,
  modelLoadMessage,
}: ImageGenerationFormProps) {
  const bindText = (key: keyof ImageGenerationFormValues) => ({
    value: form[key] as string,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: event.target.value }),
  });
  const setText = (key: keyof ImageGenerationFormValues, value: string) =>
    setForm({ ...form, [key]: value });

  return (
    <>
      <WorkflowStep
        title="Prompt and source"
        description="Choose the model and source imagery, then describe the image to create."
      >
        <div className="ui-workflow__field-grid ui-workflow__field-grid--wide">
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="model">Model/Checkpoint</TermWithHint>
            </span>
            <select
              className="ui-input"
              value={form.model}
              onChange={(event) => setText("model", event.target.value)}
              disabled={modelLoadStatus === "loading"}
            >
              <option value="">
                {modelLoadStatus === "loading"
                  ? "Loading downloaded models..."
                  : "Select a downloaded model"}
              </option>
              {availableModels.map((model) => (
                <option key={model.modelRecordId} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="latentSourceArtifact">
                Latent Source
              </TermWithHint>
            </span>
            <select
              className="ui-input"
              value={form.latentSourceArtifactId}
              onChange={(event) =>
                setText("latentSourceArtifactId", event.target.value)
              }
            >
              <option value="">Empty latent image</option>
              {availableImageArtifacts.map((artifact) => (
                <option key={artifact.value} value={artifact.value}>
                  {artifact.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {modelLoadMessage ? (
          <p
            role={modelLoadStatus === "error" ? "alert" : "status"}
            className={
              modelLoadStatus === "error"
                ? "ui-feedback ui-feedback--error"
                : "ui-text-muted"
            }
          >
            {modelLoadStatus === "loading" ? (
              <LoadingSpinner label="Loading model inventory" />
            ) : null}{" "}
            {modelLoadMessage}
          </p>
        ) : null}
        {artifactLoadMessage ? (
          <p role="alert" className="ui-feedback ui-feedback--error">
            {artifactLoadMessage}
          </p>
        ) : null}

        <label className="ui-stack ui-stack--sm">
          <span>
            <TermWithHint termId="prompt">Prompt</TermWithHint>
          </span>
          <textarea
            className="ui-input ui-textarea"
            data-testid="image-prompt"
            value={form.prompt}
            onChange={(event) => setText("prompt", event.target.value)}
          />
        </label>
        <label className="ui-stack ui-stack--sm">
          <span>
            <TermWithHint termId="negativePrompt">Negative Prompt</TermWithHint>
          </span>
          <textarea
            className="ui-input ui-textarea"
            value={form.negativePrompt}
            onChange={(event) => setText("negativePrompt", event.target.value)}
          />
        </label>

        <label className="ui-workflow__checkbox-row">
          <input
            type="checkbox"
            checked={form.faceIdEnabled}
            onChange={(event) =>
              setForm({ ...form, faceIdEnabled: event.target.checked })
            }
          />
          <span>
            <TermWithHint termId="faceId">Enable FaceID</TermWithHint>{" "}
            (optional)
          </span>
        </label>
        {form.faceIdEnabled ? (
          <div className="ui-workflow__subpanel ui-stack ui-stack--sm">
            <p className="ui-text-muted">
              FaceID requires ComfyUI InstantID custom nodes and models. The
              runtime will attempt setup when required.
            </p>
            <div className="ui-workflow__field-grid">
              {[
                "faceIdArtifactId1",
                "faceIdArtifactId2",
                "faceIdArtifactId3",
              ].map((key, index) => (
                <label className="ui-stack ui-stack--sm" key={key}>
                  <span>
                    <TermWithHint termId="faceReferenceImage">
                      Face reference image {index + 1}
                    </TermWithHint>{" "}
                    {index > 0 ? "(optional)" : null}
                  </span>
                  <select
                    className="ui-input"
                    value={String(form[key as keyof ImageGenerationFormValues])}
                    onChange={(event) =>
                      setText(
                        key as keyof ImageGenerationFormValues,
                        event.target.value,
                      )
                    }
                  >
                    <option value="">Select image artifact</option>
                    {availableImageArtifacts.map((artifact) => (
                      <option
                        key={`${key}-${artifact.value}`}
                        value={artifact.value}
                      >
                        {artifact.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="ui-workflow__field-grid">
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="faceIdentityWeight">
                    Face identity weight
                  </TermWithHint>
                </span>
                <input
                  className="ui-input"
                  type="number"
                  step="0.01"
                  {...bindText("faceIdIdentityStrength")}
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="faceStructureWeight">
                    Face structure weight
                  </TermWithHint>
                </span>
                <input
                  className="ui-input"
                  type="number"
                  step="0.01"
                  {...bindText("faceIdStructureStrength")}
                />
              </label>
              <label className="ui-stack ui-stack--sm">
                <span>
                  <TermWithHint termId="faceNoise">Face noise</TermWithHint>
                </span>
                <input
                  className="ui-input"
                  type="number"
                  step="0.01"
                  {...bindText("faceIdNoise")}
                />
              </label>
            </div>
          </div>
        ) : null}
      </WorkflowStep>

      <WorkflowStep
        title="Generation settings"
        description="Set the image dimensions, sampling behavior, and output count."
      >
        <div className="ui-workflow__field-grid">
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="seed">Seed</TermWithHint>
            </span>
            <input className="ui-input" {...bindText("seed")} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="width">Width</TermWithHint>
            </span>
            <input className="ui-input" type="number" {...bindText("width")} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="height">Height</TermWithHint>
            </span>
            <input className="ui-input" type="number" {...bindText("height")} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="steps">Steps</TermWithHint>
            </span>
            <input className="ui-input" type="number" {...bindText("steps")} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="cfg">CFG</TermWithHint>
            </span>
            <input className="ui-input" type="number" {...bindText("cfg")} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="denoise">Denoise</TermWithHint>
            </span>
            <input
              className="ui-input"
              type="number"
              min="0"
              max="1"
              step="0.01"
              {...bindText("denoise")}
            />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="sampler">Sampler</TermWithHint>
            </span>
            <input className="ui-input" {...bindText("sampler")} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="scheduler">Scheduler</TermWithHint>
            </span>
            <input className="ui-input" {...bindText("scheduler")} />
          </label>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="numberOfImages">
                Number of Images
              </TermWithHint>
            </span>
            <input
              className="ui-input"
              type="number"
              {...bindText("numImages")}
            />
          </label>
        </div>
      </WorkflowStep>

      <WorkflowStep
        title="Review and generate"
        description="Review the selections above and start the generation run."
        active={!isStartDisabled && !validationError}
      >
        {validationError ? (
          <p className="ui-feedback ui-feedback--error" role="alert">
            {validationError}
          </p>
        ) : null}
        <div className="ui-workflow__actions">
          <button
            type="button"
            className="ui-button"
            onClick={onSubmit}
            disabled={isStartDisabled}
          >
            {isStartDisabled ? (
              <LoadingSpinner label="Generating image" />
            ) : (
              <ApplicationIcon name="play" />
            )}
            <span className="ui-button__label">
              {isStartDisabled ? "Generating..." : "Start Generation"}
            </span>
          </button>
        </div>
      </WorkflowStep>
    </>
  );
}
