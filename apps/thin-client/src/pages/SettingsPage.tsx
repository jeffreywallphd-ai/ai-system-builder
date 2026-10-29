import {useMemo} from "react";
import {PageDashboardHeader,TransientNotificationPublisher} from "../../../../modules/ui/shared";
import {SettingField} from "../../../../modules/ui/shared/settings";
import {createApiApplicationSettingsClient} from "../features/settings/api/apiApplicationSettingsClient";
import {useThinClientSettings} from "../features/settings/hooks/useThinClientSettings";
import {ThinClientPageDashboard} from "../features/page-dashboard/ThinClientPageDashboard";

export function SettingsPage() {
  const client=useMemo(()=>createApiApplicationSettingsClient(),[]),settings=useThinClientSettings(client);
  const busy=settings.busy!==undefined,disabled=settings.loading||busy||!settings.ready;
  return <section className="ui-panel ui-stack ui-stack--md settings-page">
    <PageDashboardHeader title="Settings" description="Manage global defaults and server settings." dashboard={<ThinClientPageDashboard kind="settings"/>}/>
    <button className="ui-button" type="button" disabled={settings.loading||busy} onClick={()=>void settings.refresh()}>Refresh settings</button>
    {settings.loading?<p role="status" className="ui-text-muted">Loading settings...</p>:null}
    {busy?<p role="status" className="ui-text-muted">{settings.busy==="restart"?"Requesting server restart...":"Saving settings..."}</p>:null}
    {!settings.loading&&!busy&&!settings.ready?<p className="ui-text-muted">Refresh settings before making another change.</p>:null}
    <TransientNotificationPublisher message={settings.successMessage} title="Settings updated" tone="success" source="Settings"/>
    <TransientNotificationPublisher message={settings.errorMessage} title="Settings need attention" tone="error" source="Settings"/>
    <div className="ui-stack ui-stack--md">
      <section className="settings-field ui-stack ui-stack--sm" aria-label="Server">
        <header className="ui-stack ui-stack--sm"><h3>Server</h3><p className="ui-text-muted">Restart the server process after changing settings that are applied at startup.</p></header>
        <button className="ui-button" type="button" disabled={disabled} onClick={()=>void settings.restartServer()}>{settings.busy==="restart"?"Restarting...":"Restart server"}</button>
      </section>
      {settings.definitions.map(definition=><section key={definition.key} className="settings-field ui-stack ui-stack--sm" aria-label={definition.label}>
        {definition.description?<p className="ui-text-muted">{definition.description}</p>:null}
        <SettingField definition={definition} value={settings.valuesByKey.get(definition.key)} disabled={disabled}
          onSave={value=>settings.updateSetting(definition.key,value)} onClear={()=>settings.clearSetting(definition.key)}/>
      </section>)}
    </div>
  </section>;
}
