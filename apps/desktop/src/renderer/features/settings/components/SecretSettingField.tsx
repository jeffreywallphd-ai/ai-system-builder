import { useLayoutEffect, useRef, useState } from "react";

import { TermWithHint } from "../../../../../../../modules/ui/shared";

export interface SecretSettingFieldProps {
  label: string;
  configured: boolean;
  maskedValue?: string;
  disabled?: boolean;
  onSave: (value: string) => Promise<boolean>;
  onClear: () => Promise<boolean>;
  compact?: boolean;
}

export function SecretSettingField(props: SecretSettingFieldProps) {
  const [draft, setDraft] = useState("");
  const draftRevision = useRef(0);
  useLayoutEffect(() => () => { draftRevision.current++; }, []);
  const clearSubmittedDraft = (revision: number) => {
    if (draftRevision.current === revision) { draftRevision.current++; setDraft(""); }
  };

  return (
    <div className={`settings-secret ${props.compact ? "settings-secret--compact" : ""}`.trim()}>
      <p className={`settings-secret__state ${props.configured ? "settings-secret__state--configured" : "settings-secret__state--missing"}`}>
        {props.label}: {props.configured ? (props.maskedValue ?? "Configured") : "Not configured"}
      </p>
      <div className="settings-secret__controls">
        <label className="ui-stack ui-stack--sm">
          <span><TermWithHint termId="settingValue">{props.label}</TermWithHint></span>
          <input
            data-testid="secret-input"
            className="ui-input"
            type="password"
            value={draft}
            onChange={(event) => { draftRevision.current++; setDraft(event.target.value); }}
            placeholder="Enter new secret"
            disabled={props.disabled}
          />
        </label>
        <button
          data-testid="secret-save"
          className="ui-button"
          type="button"
          disabled={props.disabled || draft.trim().length === 0}
          onClick={() => {
            const revision = draftRevision.current;
            void props.onSave(draft).then(saved => { if (saved) clearSubmittedDraft(revision); });
          }}
        >
          Save secret
        </button>
        <button
          data-testid="secret-clear"
          className="ui-button ui-button--destructive"
          type="button"
          disabled={props.disabled || !props.configured}
          onClick={() => {
            const revision = draftRevision.current;
            void props.onClear().then(cleared => { if (cleared) clearSubmittedDraft(revision); });
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
