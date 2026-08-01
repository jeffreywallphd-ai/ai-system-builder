import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PageDashboardHeader,
  TermWithHint,
  TransientNotificationPublisher,
} from "../../../../modules/ui/shared";
import type {
  ApplicationSettingDefinition,
  ApplicationSettingPrimitiveValue,
  ApplicationSettingValue,
} from "../../../../modules/contracts/settings";
import { createApiApplicationSettingsClient } from "../features/settings/api/apiApplicationSettingsClient";
import { ThinClientPageDashboard } from "../features/page-dashboard/ThinClientPageDashboard";

export function SettingsPage() {
  const client = useMemo(() => createApiApplicationSettingsClient(), []);
  const [definitions, setDefinitions] = useState<ApplicationSettingDefinition[]>([]);
  const [valuesByKey, setValuesByKey] = useState<Map<string, ApplicationSettingValue>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [statusMessage, setStatusMessage] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMessage(undefined);
    try {
      const [definitionResult, valueResult] = await Promise.all([
        client.listDefinitions(),
        client.readSettings(),
      ]);
      const nextValuesByKey = new Map(valueResult.values.map((value) => [value.key, value]));
      setDefinitions(definitionResult.definitions);
      setValuesByKey(nextValuesByKey);
      setDrafts(new Map(definitionResult.definitions.map((definition) => {
        const value = nextValuesByKey.get(definition.key)?.value;
        return [definition.key, value === undefined ? "" : String(value)];
      })));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (definition: ApplicationSettingDefinition) => {
    setSaving(true);
    setStatusMessage(undefined);
    setErrorMessage(undefined);
    try {
      const draft = drafts.get(definition.key) ?? "";
      const value: ApplicationSettingPrimitiveValue = definition.valueKind === "number" ? Number(draft) : draft;
      await client.updateSetting({ key: definition.key, value });
      await refresh();
      setStatusMessage("Setting saved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save setting.");
    } finally {
      setSaving(false);
    }
  };

  const clear = async (definition: ApplicationSettingDefinition) => {
    setSaving(true);
    setStatusMessage(undefined);
    setErrorMessage(undefined);
    try {
      await client.clearSetting({ key: definition.key });
      await refresh();
      setStatusMessage("Setting cleared.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to clear setting.");
    } finally {
      setSaving(false);
    }
  };

  const restartServer = async () => {
    setRestarting(true);
    setStatusMessage(undefined);
    setErrorMessage(undefined);
    try {
      await client.restartServer();
      setStatusMessage("Server restart requested.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to restart server.");
    } finally {
      setRestarting(false);
    }
  };

  return (
    <section className="ui-panel ui-stack ui-stack--md settings-page">
      <PageDashboardHeader
        title="Settings"
        description="Manage global defaults and server settings."
        dashboard={<ThinClientPageDashboard kind="settings" />}
      />
      {loading ? <p className="ui-text-muted">Loading settings...</p> : null}
      <TransientNotificationPublisher message={statusMessage} title="Settings updated" tone="success" source="Settings" />
      <TransientNotificationPublisher message={errorMessage} title="Settings need attention" tone="error" source="Settings" />
      <div className="ui-stack ui-stack--md">
        <section className="settings-field ui-stack ui-stack--sm">
          <header className="ui-stack ui-stack--sm">
            <h3>Server</h3>
            <p className="ui-text-muted">Restart the server process after changing settings that are applied at startup.</p>
          </header>
          <button className="ui-button" type="button" disabled={restarting} onClick={() => void restartServer()}>
            {restarting ? "Restarting..." : "Restart server"}
          </button>
        </section>
        {definitions.map((definition) => {
          const configured = valuesByKey.get(definition.key)?.configured;
          return (
            <section key={definition.key} className="settings-field ui-stack ui-stack--sm">
              <header className="ui-stack ui-stack--sm">
                <p className="ui-label"><TermWithHint termId="settingValue">{definition.label}</TermWithHint></p>
                {definition.description ? <p className="ui-text-muted">{definition.description}</p> : null}
              </header>
              {definition.valueKind === "select" ? (
                <select
                  className="ui-input"
                  value={drafts.get(definition.key) ?? ""}
                  disabled={loading || saving}
                  onChange={(event) => setDrafts((current) => new Map(current).set(definition.key, event.target.value))}
                >
                  <option value="">Select...</option>
                  {(definition.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label ?? option.value}</option>)}
                </select>
              ) : (
                <input
                  className="ui-input"
                  type={definition.valueKind === "number" ? "number" : "text"}
                  value={drafts.get(definition.key) ?? ""}
                  placeholder={definition.placeholder}
                  disabled={loading || saving}
                  onChange={(event) => setDrafts((current) => new Map(current).set(definition.key, event.target.value))}
                />
              )}
              {definition.instructions ? <p className="ui-text-muted">{definition.instructions}</p> : null}
              <div className="ui-grid ui-grid--two">
                <button className="ui-button" type="button" disabled={loading || saving} onClick={() => void save(definition)}>Save</button>
                <button className="ui-button ui-button--destructive" type="button" disabled={loading || saving || !configured} onClick={() => void clear(definition)}>Clear</button>
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
