import { useEffect, useId, useState } from "react";

import type { ModelDefaultConfig, ModelDefaultInferenceMode } from "../../../contracts/settings";
import { GlossaryHint } from "../glossary";

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
  const id = useId();
  const [draft, setDraft] = useState<ModelDefaultConfig>(toInitialDraft(props.value));
  useEffect(() => { setDraft(toInitialDraft(props.value)); }, [props.value]);

  return (
    <div className="settings-model-default ui-grid ui-grid--two">
      <div className="ui-stack ui-stack--sm">
        <span className="ui-glossary-term"><label htmlFor={`${id}-0`}> Provider</label><GlossaryHint termId="provider" /></span>
        <select id={`${id}-0`}
          className="ui-input"
          value={draft.provider}
          disabled
          onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value as "transformers" }))}
        >
          <option value="transformers">transformers</option>
        </select>
      </div>
      <div className="ui-stack ui-stack--sm">
        <span className="ui-glossary-term"><label htmlFor={`${id}-1`}> Model ID</label><GlossaryHint termId="modelId" /></span>
        <input id={`${id}-1`}
          data-testid="model-default-model-id"
          className="ui-input"
          value={draft.modelId}
          onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))}
          disabled={props.disabled}
        />
      </div>
      <div className="ui-stack ui-stack--sm">
        <span className="ui-glossary-term"><label htmlFor={`${id}-2`}> Inference mode</label><GlossaryHint termId="inference" /></span>
        <select id={`${id}-2`}
          data-testid="model-default-inference-mode"
          className="ui-input"
          value={draft.inferenceMode}
          onChange={(event) => setDraft((current) => ({ ...current, inferenceMode: event.target.value as ModelDefaultInferenceMode }))}
          disabled={props.disabled}
        >
          {INFERENCE_MODE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
      <div className="ui-stack ui-stack--sm">
        <span className="ui-glossary-term"><label htmlFor={`${id}-3`}> Device</label><GlossaryHint termId="runtime" /></span>
        <select id={`${id}-3`}
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
      </div>
      <div className="ui-stack ui-stack--sm">
        <span className="ui-glossary-term"><label htmlFor={`${id}-4`}> Torch dtype</label><GlossaryHint termId="settingValue" /></span>
        <select id={`${id}-4`}
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
      </div>
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
