import { SettingsPanel } from "../features/settings";

export function SettingsPage() {
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Settings</h1>
      <p className="ui-text-muted">Manage global desktop defaults used by feature workflows.</p>
      <SettingsPanel title="Hugging Face" category="huggingface" />
      <SettingsPanel title="Models" category="models" />
      <SettingsPanel title="Runtime" category="runtime" />
      <SettingsPanel title="Dataset Preparation" category="datasetPreparation" />
      <SettingsPanel title="Publishing" category="publishing" />
    </section>
  );
}
