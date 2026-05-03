import type { ChangeEvent } from "react";
import type { ImageGenerationFormValues, ImageGenerationModelLoadStatus, ImageGenerationModelOption } from "../hooks/useImageGenerationFeature";

export function ImageGenerationForm({ form, setForm, validationError, isStartDisabled, onSubmit, availableModels, modelLoadStatus, modelLoadMessage }: { form: ImageGenerationFormValues; setForm: (v: ImageGenerationFormValues) => void; validationError?: string; isStartDisabled: boolean; onSubmit: () => void; availableModels: ImageGenerationModelOption[]; modelLoadStatus: ImageGenerationModelLoadStatus; modelLoadMessage?: string; }) {
  const bindText = (key: keyof ImageGenerationFormValues) => ({ value: form[key], onChange: (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }) });
  return (
    <section className="ui-panel ui-stack ui-stack--sm">
      <h2>Generate Image</h2>
      <label className="ui-stack ui-stack--sm"><span>Prompt</span><input className="ui-input" data-testid="image-prompt" {...bindText("prompt")} /></label>
      <label className="ui-stack ui-stack--sm"><span>Negative Prompt</span><input className="ui-input" {...bindText("negativePrompt")} /></label>
      <label className="ui-stack ui-stack--sm"><span>Seed</span><input className="ui-input" {...bindText("seed")} /></label>
      <label className="ui-stack ui-stack--sm"><span>Width</span><input className="ui-input" type="number" {...bindText("width")} /></label>
      <label className="ui-stack ui-stack--sm"><span>Height</span><input className="ui-input" type="number" {...bindText("height")} /></label>
      <label className="ui-stack ui-stack--sm"><span>Steps</span><input className="ui-input" type="number" {...bindText("steps")} /></label>
      <label className="ui-stack ui-stack--sm"><span>Sampler</span><input className="ui-input" {...bindText("sampler")} /></label>
      <label className="ui-stack ui-stack--sm"><span>Scheduler</span><input className="ui-input" {...bindText("scheduler")} /></label>
      <label className="ui-stack ui-stack--sm">
        <span>Model/Checkpoint</span>
        <select className="ui-input" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} disabled={modelLoadStatus === "loading"}>
          <option value="">{modelLoadStatus === "loading" ? "Loading downloaded models..." : "Select a downloaded model"}</option>
          {availableModels.map((model) => <option key={model.modelRecordId} value={model.value}>{model.label}</option>)}
        </select>
      </label>
      {modelLoadMessage ? <p role={modelLoadStatus === "error" ? "alert" : "status"} className={modelLoadStatus === "error" ? "ui-feedback ui-feedback--error" : undefined}>{modelLoadMessage}</p> : null}
      <label className="ui-stack ui-stack--sm"><span>Number of Images</span><input className="ui-input" type="number" {...bindText("numImages")} /></label>
      {validationError ? <p className="ui-feedback ui-feedback--error">{validationError}</p> : null}
      <button type="button" className="ui-button" onClick={onSubmit} disabled={isStartDisabled}>Start Generation</button>
    </section>
  );
}
