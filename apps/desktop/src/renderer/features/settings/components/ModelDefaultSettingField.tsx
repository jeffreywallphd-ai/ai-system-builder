import { useState } from "react";

import type { ModelDefaultConfig, ModelDefaultInferenceMode } from "../../../../../../../modules/contracts/settings";

export interface ModelDefaultSettingFieldProps {
  value?: unknown;
  disabled?: boolean;
  onSave: (value: ModelDefaultConfig) => Promise<void>;
}

const INFERENCE_MODE_OPTIONS: ModelDefaultInferenceMode[] = ["auto", "text2text", "causal", "chat"];

function toInitialDraft(value?: unknown): ModelDefaultConfig {
  const source = (value && typeof value === "object" ? value : {}) as Partial<ModelDefaultConfig>;

  return {
    provider: "transformers",
    modelId: source.modelId ?? "",
    inferenceMode: source.inferenceMode ?? "auto",
    device: source.device,
    torchDtype: source.torchDtype,
  };
}

export function ModelDefaultSettingField(props: ModelDefaultSettingFieldProps) {
  const [draft, setDraft] = useState<ModelDefaultConfig>(toInitialDraft(props.value));

  return (
    <div className="settings-model-default ui-grid ui-grid--two">
      <label className="ui-stack ui-stack--sm">
        <span>Provider</span>
        <select
          className="ui-input"
          value={draft.provider}
          disabled
          onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value as "transformers" }))}
        >
          <option value="transformers">transformers</option>
        </select>
      </label>
      <label className="ui-stack ui-stack--sm">
        <span>Model ID</span>
        <input
          data-testid="model-default-model-id"
          className="ui-input"
          value={draft.modelId}
          onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))}
          disabled={props.disabled}
        />
      </label>
      <label className="ui-stack ui-stack--sm">
        <span>Inference mode</span>
        <select
          data-testid="model-default-inference-mode"
          className="ui-input"
          value={draft.inferenceMode}
          onChange={(event) => setDraft((current) => ({ ...current, inferenceMode: event.target.value as ModelDefaultInferenceMode }))}
          disabled={props.disabled}
        >
          {INFERENCE_MODE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label className="ui-stack ui-stack--sm">
        <span>Device</span>
        <select
          className="ui-input"
          value={draft.device ?? ""}
          onChange={(event) => setDraft((current) => ({ ...current, device: event.target.value === "" ? undefined : event.target.value as "auto" | "cpu" | "cuda" }))}
          disabled={props.disabled}
        >
          <option value="">Runtime default</option>
          <option value="auto">auto</option>
          <option value="cpu">cpu</option>
          <option value="cuda">cuda</option>
        </select>
      </label>
      <label className="ui-stack ui-stack--sm">
        <span>Torch dtype</span>
        <select
          className="ui-input"
          value={draft.torchDtype ?? ""}
          onChange={(event) => setDraft((current) => ({ ...current, torchDtype: event.target.value === "" ? undefined : event.target.value as "auto" | "float16" | "bfloat16" | "float32" }))}
          disabled={props.disabled}
        >
          <option value="">Runtime default</option>
          <option value="auto">auto</option>
          <option value="float16">float16</option>
          <option value="bfloat16">bfloat16</option>
          <option value="float32">float32</option>
        </select>
      </label>
      <div>
        <button
          data-testid="model-default-save"
          className="ui-button"
          type="button"
          disabled={props.disabled || draft.modelId.trim().length === 0}
          onClick={() => void props.onSave({ ...draft, modelId: draft.modelId.trim() })}
        >
          Save model default
        </button>
      </div>
    </div>
  );
}
