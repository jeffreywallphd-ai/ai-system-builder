import { useId, type ChangeEvent, type ComponentProps } from "react";

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

function ImageFieldLabel({
  controlId,
  termId,
  text,
  checkbox = false,
}: {
  controlId: string;
  termId: ComponentProps<typeof TermWithHint>["termId"];
  text: string;
  checkbox?: boolean;
}) {
  return (
    <span className={checkbox ? undefined : "ui-label"}>
      <TermWithHint termId={termId}>
        <label htmlFor={controlId}>{text}</label>
      </TermWithHint>
    </span>
  );
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
  const formId = useId();
  const fieldId = (key: keyof ImageGenerationFormValues) => `${formId}-${key}`;
  const bindText = (key: keyof ImageGenerationFormValues) => ({
    id: fieldId(key),
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
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("model")} termId="model" text="Model/Checkpoint" />
            <select
              id={fieldId("model")}
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
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("latentSourceArtifactId")} termId="latentSourceArtifact" text="Latent Source" />
            <select
              id={fieldId("latentSourceArtifactId")}
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
          </div>
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

        <div className="ui-stack ui-stack--sm">
          <ImageFieldLabel controlId={fieldId("prompt")} termId="prompt" text="Prompt" />
          <textarea
            id={fieldId("prompt")}
            className="ui-input ui-textarea"
            data-testid="image-prompt"
            value={form.prompt}
            onChange={(event) => setText("prompt", event.target.value)}
          />
        </div>
        <div className="ui-stack ui-stack--sm">
          <ImageFieldLabel controlId={fieldId("negativePrompt")} termId="negativePrompt" text="Negative Prompt" />
          <textarea
            id={fieldId("negativePrompt")}
            className="ui-input ui-textarea"
            value={form.negativePrompt}
            onChange={(event) => setText("negativePrompt", event.target.value)}
          />
        </div>

        <div className="ui-workflow__checkbox-row">
          <input
            id={fieldId("faceIdEnabled")}
            type="checkbox"
            checked={form.faceIdEnabled}
            onChange={(event) =>
              setForm({ ...form, faceIdEnabled: event.target.checked })
            }
          />
          <ImageFieldLabel
            controlId={fieldId("faceIdEnabled")}
            termId="faceId"
            text="Enable FaceID (optional)"
            checkbox
          />
        </div>
        {form.faceIdEnabled ? (
          <div className="ui-workflow__subpanel ui-stack ui-stack--sm">
            <p className="ui-text-muted">
              FaceID requires ComfyUI InstantID custom nodes and models. The
              runtime will attempt setup when required.
            </p>
            <div className="ui-workflow__field-grid">
              {([
                "faceIdArtifactId1",
                "faceIdArtifactId2",
                "faceIdArtifactId3",
              ] as const).map((key, index) => (
                <div className="ui-stack ui-stack--sm" key={key}>
                  <ImageFieldLabel
                    controlId={fieldId(key)}
                    termId="faceReferenceImage"
                    text={`Face reference image ${index + 1}${index > 0 ? " (optional)" : ""}`}
                  />
                  <select
                    id={fieldId(key)}
                    className="ui-input"
                    value={String(form[key])}
                    onChange={(event) => setText(key, event.target.value)}
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
                </div>
              ))}
            </div>
            <div className="ui-workflow__field-grid">
              <div className="ui-stack ui-stack--sm">
                <ImageFieldLabel controlId={fieldId("faceIdIdentityStrength")} termId="faceIdentityWeight" text="Face identity weight" />
                <input
                  className="ui-input"
                  type="number"
                  step="0.01"
                  {...bindText("faceIdIdentityStrength")}
                />
              </div>
              <div className="ui-stack ui-stack--sm">
                <ImageFieldLabel controlId={fieldId("faceIdStructureStrength")} termId="faceStructureWeight" text="Face structure weight" />
                <input
                  className="ui-input"
                  type="number"
                  step="0.01"
                  {...bindText("faceIdStructureStrength")}
                />
              </div>
              <div className="ui-stack ui-stack--sm">
                <ImageFieldLabel controlId={fieldId("faceIdNoise")} termId="faceNoise" text="Face noise" />
                <input
                  className="ui-input"
                  type="number"
                  step="0.01"
                  {...bindText("faceIdNoise")}
                />
              </div>
            </div>
          </div>
        ) : null}
      </WorkflowStep>

      <WorkflowStep
        title="Generation settings"
        description="Set the image dimensions, sampling behavior, and output count."
      >
        <div className="ui-workflow__field-grid">
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("seed")} termId="seed" text="Seed" />
            <input className="ui-input" {...bindText("seed")} />
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("width")} termId="width" text="Width" />
            <input className="ui-input" type="number" {...bindText("width")} />
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("height")} termId="height" text="Height" />
            <input className="ui-input" type="number" {...bindText("height")} />
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("steps")} termId="steps" text="Steps" />
            <input className="ui-input" type="number" {...bindText("steps")} />
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("cfg")} termId="cfg" text="CFG" />
            <input className="ui-input" type="number" {...bindText("cfg")} />
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("denoise")} termId="denoise" text="Denoise" />
            <input
              className="ui-input"
              type="number"
              min="0"
              max="1"
              step="0.01"
              {...bindText("denoise")}
            />
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("sampler")} termId="sampler" text="Sampler" />
            <input className="ui-input" {...bindText("sampler")} />
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("scheduler")} termId="scheduler" text="Scheduler" />
            <input className="ui-input" {...bindText("scheduler")} />
          </div>
          <div className="ui-stack ui-stack--sm">
            <ImageFieldLabel controlId={fieldId("numImages")} termId="numberOfImages" text="Number of Images" />
            <input
              className="ui-input"
              type="number"
              {...bindText("numImages")}
            />
          </div>
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
