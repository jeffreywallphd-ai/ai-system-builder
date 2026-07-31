import { useState } from "react";

import type {
  ApplicationSettingDefinition,
  ApplicationSettingPrimitiveValue,
  ApplicationSettingValue,
  ModelDefaultConfig,
} from "../../../../../../../modules/contracts/settings";
import { TermWithHint } from "../../../../../../../modules/ui/shared";
import { ModelDefaultSettingField } from "./ModelDefaultSettingField";
import { SecretSettingField } from "./SecretSettingField";

export interface SettingFieldProps {
  definition: ApplicationSettingDefinition;
  value?: ApplicationSettingValue;
  disabled?: boolean;
  compact?: boolean;
  onSave: (value: ApplicationSettingPrimitiveValue) => Promise<void>;
  onClear: () => Promise<void>;
  onSelectFolder?: (request?: { title?: string; defaultPath?: string }) => Promise<string | undefined>;
}

export function SettingField(props: SettingFieldProps) {
  const [draft, setDraft] = useState<string>(() => (props.value?.value === undefined ? "" : String(props.value.value)));

  const configured = Boolean(props.value?.configured);

  if (props.definition.valueKind === "secret") {
    return (
      <SecretSettingField
        label={props.definition.label}
        configured={configured}
        maskedValue={props.value?.maskedValue}
        onSave={async (input) => props.onSave(input)}
        onClear={props.onClear}
        disabled={props.disabled}
        compact={props.compact}
      />
    );
  }

  if (props.definition.valueKind === "object") {
    const objectValue = props.value?.value;
    if (props.definition.key.includes("default") && props.definition.key.includes("model")) {
      return (
        <ModelDefaultSettingField
          value={objectValue}
          disabled={props.disabled}
          onSave={async (input: ModelDefaultConfig) => props.onSave(input)}
        />
      );
    }

    return <p className="ui-text-muted">Object setting UI is not yet supported for this key.</p>;
  }

  if (props.definition.valueKind === "boolean") {
    return (
      <label>
        <input
          data-testid={`setting-${props.definition.key}-boolean`}
          type="checkbox"
          checked={Boolean(props.value?.value)}
          disabled={props.disabled}
          onChange={(event) => void props.onSave(event.target.checked)}
        />
        <TermWithHint termId="settingValue">{props.definition.label}</TermWithHint>
      </label>
    );
  }

  if (props.definition.valueKind === "select") {
    return (
      <label className="ui-stack ui-stack--sm">
        <span><TermWithHint termId="settingValue">{props.definition.label}</TermWithHint></span>
        <select data-testid={`setting-${props.definition.key}-select`} className="ui-input" value={draft} disabled={props.disabled} onChange={(event) => setDraft(event.target.value)}>
          <option value="">Select…</option>
          {(props.definition.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label ?? option.value}</option>
          ))}
        </select>
        <button data-testid={`setting-${props.definition.key}-save`} className="ui-button" type="button" disabled={props.disabled} onClick={() => void props.onSave(draft)}>Save</button>
      </label>
    );
  }

  const isNumber = props.definition.valueKind === "number";
  const isFolder = props.definition.valueKind === "folder";

  return (
    <label className="ui-stack ui-stack--sm">
      <span><TermWithHint termId="settingValue">{props.definition.label}</TermWithHint></span>
      <input
        data-testid={`setting-${props.definition.key}-input`}
        className="ui-input"
        type={isNumber ? "number" : "text"}
        value={draft}
        placeholder={props.definition.placeholder}
        disabled={props.disabled}
        onChange={(event) => setDraft(event.target.value)}
      />
      {props.definition.instructions ? <p className="ui-text-muted">{props.definition.instructions}</p> : null}
      <div className="ui-grid ui-grid--two">
        <button
          data-testid={`setting-${props.definition.key}-save`}
          className="ui-button"
          type="button"
          disabled={props.disabled}
          onClick={() => void props.onSave(isNumber ? Number(draft) : draft)}
        >
          Save
        </button>
        {isFolder && props.onSelectFolder ? (
          <button
            data-testid={`setting-${props.definition.key}-browse`}
            className="ui-button"
            type="button"
            disabled={props.disabled}
            onClick={() => void props.onSelectFolder?.({ title: props.definition.label, defaultPath: draft || undefined }).then((path) => {
              if (path) setDraft(path);
            })}
          >
            Browse
          </button>
        ) : null}
        <button data-testid={`setting-${props.definition.key}-clear`} className="ui-button ui-button--destructive" type="button" disabled={props.disabled || !configured} onClick={() => void props.onClear()}>
          Clear
        </button>
      </div>
    </label>
  );
}
