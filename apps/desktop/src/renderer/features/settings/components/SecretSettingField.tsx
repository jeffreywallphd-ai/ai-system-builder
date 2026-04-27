import { useState } from "react";

export interface SecretSettingFieldProps {
  label: string;
  configured: boolean;
  maskedValue?: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<void>;
  onClear: () => Promise<void>;
  compact?: boolean;
}

export function SecretSettingField(props: SecretSettingFieldProps) {
  const [draft, setDraft] = useState("");

  return (
    <div className={`settings-secret ${props.compact ? "settings-secret--compact" : ""}`.trim()}>
      <p className={`settings-secret__state ${props.configured ? "settings-secret__state--configured" : "settings-secret__state--missing"}`}>
        {props.label}: {props.configured ? (props.maskedValue ?? "Configured") : "Not configured"}
      </p>
      <div className="settings-secret__controls">
        <input
          data-testid="secret-input"
          className="ui-input"
          type="password"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Enter new secret"
          disabled={props.disabled}
        />
        <button
          data-testid="secret-save"
          className="ui-button"
          type="button"
          disabled={props.disabled || draft.trim().length === 0}
          onClick={() => void props.onSave(draft).then(() => setDraft(""))}
        >
          Save secret
        </button>
        <button
          data-testid="secret-clear"
          className="ui-button ui-button--destructive"
          type="button"
          disabled={props.disabled || !props.configured}
          onClick={() => void props.onClear()}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
