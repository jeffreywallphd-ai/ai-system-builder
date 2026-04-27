import type {
  ApplicationSettingCategory,
  ApplicationSettingKey,
} from "../../../../../../../modules/contracts/settings";
import { useApplicationSettings } from "../hooks/useApplicationSettings";
import { SettingField } from "./SettingField";
import { SettingsStatusMessage } from "./SettingsStatusMessage";

export interface SettingsPanelProps {
  keys?: ApplicationSettingKey[];
  category?: ApplicationSettingCategory;
  title?: string;
  description?: string;
  compact?: boolean;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const settings = useApplicationSettings({ keys: props.keys, category: props.category });

  return (
    <section className={`ui-panel ui-stack ${props.compact ? "settings-panel--compact ui-stack--sm" : "ui-stack--sm"}`.trim()}>
      {props.title ? <h3 className="ui-panel__title">{props.title}</h3> : null}
      {props.description ? <p>{props.description}</p> : null}
      <SettingsStatusMessage
        loading={settings.loading}
        saving={settings.saving}
        successMessage={settings.successMessage}
        errorMessage={settings.errorMessage}
      />
      {settings.definitions.map((definition) => (
        <section key={definition.key} className="settings-panel__field ui-stack ui-stack--sm">
          <header className="ui-stack ui-stack--sm">
            <h4>{definition.label}</h4>
            {definition.description ? <p className="ui-text-muted">{definition.description}</p> : null}
            <p className="ui-text-muted">Key: {definition.key}</p>
          </header>
          <SettingField
            definition={definition}
            value={settings.valuesByKey.get(definition.key)}
            disabled={settings.loading || settings.saving}
            compact={props.compact}
            onSave={async (value) => settings.updateSetting(definition.key, value)}
            onClear={async () => settings.clearSetting(definition.key)}
          />
        </section>
      ))}
    </section>
  );
}
