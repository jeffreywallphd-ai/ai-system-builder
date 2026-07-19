import { useEffect, useMemo, useState } from "react";
import type { AssetBinding, AssetInstance, AssetReference } from "../../../contracts/asset";
import type { SystemBuilderRecord, SystemBuilderResult, SystemBuilderRevision, SystemBuilderTemplateSummary } from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { ModalDialog } from "../components/ModalDialog";
import { SystemCompositionPreview } from "./SystemCompositionPreview";

export interface SystemBuilderAssetOption {
  readonly definitionId: string;
  readonly version: string;
  readonly displayName: string;
  readonly summary?: string;
  readonly category?: string;
}

export interface SystemBuilderClient {
  list(input: { workspaceId: string; includeArchived?: boolean }): Promise<SystemBuilderResult<readonly SystemBuilderRecord[]>>;
  listTemplates(): Promise<SystemBuilderResult<readonly SystemBuilderTemplateSummary[]>>;
  createFromTemplate(input: { workspaceId: string; templateId: SystemBuilderTemplateSummary["templateId"]; name?: string }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  create(input: { workspaceId: string; name: string; description?: string }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  readRevision(input: { workspaceId: string; systemId: string; revisionId?: string }): Promise<SystemBuilderResult<SystemBuilderRevision>>;
  saveRevision(input: {
    workspaceId: string;
    systemId: string;
    expectedRecordRevision: number;
    composition: SystemBuilderRevision["composition"];
    instances: readonly AssetInstance[];
    bindings: readonly AssetBinding[];
  }): Promise<SystemBuilderResult<SystemBuilderRevision>>;
  archive(input: { workspaceId: string; systemId: string; expectedRevision: number }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  restore(input: { workspaceId: string; systemId: string; expectedRevision: number }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  clone(input: { workspaceId: string; sourceSystemId: string; name: string }): Promise<SystemBuilderResult<SystemBuilderRecord>>;
  listRevisions(input: { workspaceId: string; systemId: string }): Promise<SystemBuilderResult<readonly SystemBuilderRevision[]>>;
  listAssetOptions(workspaceId: string): Promise<SystemBuilderResult<readonly SystemBuilderAssetOption[]>>;
}

export function SystemBuilderWorkspace({ workspaceId, client }: { readonly workspaceId: string; readonly client: SystemBuilderClient }) {
  const [systems, setSystems] = useState<readonly SystemBuilderRecord[]>([]);
  const [templates, setTemplates] = useState<readonly SystemBuilderTemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<SystemBuilderTemplateSummary["templateId"] | "">("");
  const [assets, setAssets] = useState<readonly SystemBuilderAssetOption[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<string>();
  const [revision, setRevision] = useState<SystemBuilderRevision>();
  const [instances, setInstances] = useState<readonly AssetInstance[]>([]);
  const [bindings, setBindings] = useState<readonly AssetBinding[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
  const [name, setName] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [configurationText, setConfigurationText] = useState("{}");
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [sourcePort, setSourcePort] = useState("");
  const [targetPort, setTargetPort] = useState("");
  const [revisions, setRevisions] = useState<readonly SystemBuilderRevision[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);

  const selectedSystem = systems.find((system) => String(system.systemId) === selectedSystemId);
  const selectedInstance = instances.find((instance) => String(instance.instanceId) === selectedInstanceId);
  const filteredAssets = useMemo(
    () => assets.filter((asset) => `${asset.displayName} ${asset.definitionId} ${asset.category ?? ""}`.toLowerCase().includes(assetSearch.trim().toLowerCase())),
    [assets, assetSearch],
  );

  useEffect(() => {
    let active = true;
    setError(undefined);
    setRevision(undefined);
    setSelectedSystemId(undefined);
    setDirty(false);
    void Promise.all([client.list({ workspaceId, includeArchived: true }), client.listAssetOptions(workspaceId), client.listTemplates()]).then(([systemResult, assetResult, templateResult]) => {
      if (!active) return;
      if (systemResult.ok) {
        setSystems(systemResult.value);
        setSelectedSystemId(String(systemResult.value.find((item) => item.status !== "archived")?.systemId ?? systemResult.value[0]?.systemId ?? "") || undefined);
      } else setError(systemResult.error.message);
      if (assetResult.ok) setAssets(assetResult.value);
      else setError(assetResult.error.message);
      if (templateResult.ok) {
        setTemplates(templateResult.value);
        setSelectedTemplateId((current) => current || templateResult.value[0]?.templateId || "");
      }
      else setError(templateResult.error.message);
    });
    return () => { active = false; };
  }, [client, workspaceId]);

  useEffect(() => {
    if (!selectedSystemId) {
      setRevision(undefined);
      setInstances([]);
      setBindings([]);
      return;
    }
    let active = true;
    void Promise.all([
      client.readRevision({ workspaceId, systemId: selectedSystemId }),
      client.listRevisions({ workspaceId, systemId: selectedSystemId }),
    ]).then(([revisionResult, historyResult]) => {
      if (!active) return;
      if (revisionResult.ok) {
        setRevision(revisionResult.value);
        setInstances(revisionResult.value.instances);
        setBindings(revisionResult.value.bindings);
        setSelectedInstanceId(String(revisionResult.value.instances[0]?.instanceId ?? "") || undefined);
        setDirty(false);
      } else setError(revisionResult.error.message);
      if (historyResult.ok) setRevisions(historyResult.value);
    });
    return () => { active = false; };
  }, [client, selectedSystemId, workspaceId]);

  useEffect(() => {
    setConfigurationText(JSON.stringify(selectedInstance?.selectedConfiguration ?? {}, null, 2));
  }, [selectedInstance]);

  async function createSystem() {
    if (!name.trim()) { setError("Enter a system name."); return; }
    setBusy(true); setError(undefined); setNotice(undefined);
    const result = await client.create({ workspaceId, name });
    if (result.ok) {
      setSystems((current) => [result.value, ...current]);
      setSelectedSystemId(String(result.value.systemId));
      setName(""); setDirty(false);
      setNotice("System created. Add assets to compose its first revision.");
    } else setError(result.error.message);
    setBusy(false);
  }

  async function createReferenceSystem() {
    const template = templates.find((item) => item.templateId === selectedTemplateId);
    if (!template) { setError("No supported reference-system template is available."); return; }
    setBusy(true); setError(undefined); setNotice(undefined);
    const result = await client.createFromTemplate({ workspaceId, templateId: template.templateId, ...(name.trim() ? { name: name.trim() } : {}) });
    if (result.ok) {
      setSystems((current) => [result.value, ...current]);
      setSelectedSystemId(String(result.value.systemId));
      setName(""); setDirty(false);
      setNotice(`${template.displayName} created and validated from canonical assets.`);
    } else setError(result.error.message);
    setBusy(false);
  }

  function addAsset(asset: SystemBuilderAssetOption) {
    if (!revision) return;
    const instanceId = `instance.${safeId(asset.definitionId)}.${uniqueId()}`;
    const instance: AssetInstance = {
      instanceId,
      definitionRef: { kind: "asset-definition-version", id: asset.definitionId, version: asset.version } as AssetReference,
      displayName: asset.displayName,
      lifecycleStatus: "draft",
      selectedConfiguration: {},
      parentCompositionRef: { kind: "asset-composition", id: revision.composition.compositionId } as AssetReference,
      provenance: { sourceKind: "human-authored", createdBy: "current-user" },
    };
    setInstances((current) => [...current, instance]);
    setSelectedInstanceId(instanceId);
    setDirty(true); setNotice(undefined);
  }

  function removeSelected() {
    if (!selectedInstanceId) return;
    setInstances((current) => current.filter((item) => String(item.instanceId) !== selectedInstanceId));
    setBindings((current) => current.filter((binding) => String(binding.sourceRef.id) !== selectedInstanceId && String(binding.targetRef.id) !== selectedInstanceId));
    setSelectedInstanceId(undefined);
    setDirty(true); setNotice(undefined);
  }

  function moveSelected(offset: -1 | 1) {
    if (!selectedInstanceId) return;
    setInstances((current) => {
      const from = current.findIndex((item) => String(item.instanceId) === selectedInstanceId);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    setDirty(true); setNotice(undefined);
  }

  function discardDraft() {
    if (!revision) return;
    setInstances(revision.instances);
    setBindings(revision.bindings);
    setSelectedInstanceId(String(revision.instances[0]?.instanceId ?? "") || undefined);
    setDirty(false); setError(undefined); setNotice("Unsaved changes discarded.");
  }

  function applyConfiguration() {
    if (!selectedInstanceId) return;
    try {
      const parsed = JSON.parse(configurationText) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
      setInstances((current) => current.map((item) => String(item.instanceId) === selectedInstanceId
        ? { ...item, selectedConfiguration: parsed as AssetInstance["selectedConfiguration"] }
        : item));
      setDirty(true); setNotice("Configuration applied locally. Save the revision to persist it."); setError(undefined);
    } catch { setError("Configuration must be a JSON object."); }
  }

  function connectInstances() {
    if (!sourceId || !targetId || sourceId === targetId) { setError("Choose two different instances to connect."); return; }
    const binding: AssetBinding = {
      bindingId: `binding.${uniqueId()}`,
      bindingKind: "output",
      sourceRef: { kind: "asset-instance", id: sourceId } as AssetReference,
      targetRef: { kind: "asset-instance", id: targetId } as AssetReference,
      ...(sourcePort ? { sourcePortRef: { kind: "asset-definition", id: sourcePort } as AssetReference } : {}),
      ...(targetPort ? { targetPortRef: { kind: "asset-definition", id: targetPort } as AssetReference } : {}),
      lifecycleStatus: "draft",
      provenance: { sourceKind: "human-authored" },
    };
    setBindings((current) => [...current, binding]);
    setSourcePort(""); setTargetPort(""); setDirty(true);
    setNotice("Connection added locally. Save to validate the ports."); setError(undefined);
  }

  function removeBinding(bindingId: string) {
    setBindings((current) => current.filter((binding) => String(binding.bindingId) !== bindingId));
    setDirty(true); setNotice(undefined);
  }

  async function save() {
    if (!revision || !selectedSystem) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    const instanceRefs = instances.map((item) => ({ kind: "asset-instance", id: item.instanceId } as AssetReference));
    const bindingRefs = bindings.map((item) => ({ kind: "asset-binding", id: item.bindingId } as AssetReference));
    const composition = { ...revision.composition, lifecycleStatus: "draft" as const, instanceRefs, rootInstanceRefs: instanceRefs.slice(0, 1), bindingRefs };
    const result = await client.saveRevision({
      workspaceId,
      systemId: String(selectedSystem.systemId),
      expectedRecordRevision: selectedSystem.revision,
      composition,
      instances,
      bindings,
    });
    if (result.ok) {
      setRevision(result.value); setRevisions((current) => [result.value, ...current]); setDirty(false);
      const invalid = result.value.validationIssues.filter((issue) => issue.severity === "error").length;
      setSystems((current) => current.map((item) => String(item.systemId) === selectedSystemId
        ? { ...item, revision: item.revision + 1, currentRevisionId: result.value.revisionId, composition, status: invalid ? "blocked" : instances.length ? "validated" : "draft" }
        : item));
      setNotice(invalid ? `Revision saved with ${invalid} blocking validation issue${invalid === 1 ? "" : "s"}.` : "Revision saved and validated.");
    } else setError(result.error.message);
    setBusy(false);
  }

  async function changeArchiveState() {
    if (!selectedSystem) return;
    setBusy(true); setError(undefined);
    const input = { workspaceId, systemId: String(selectedSystem.systemId), expectedRevision: selectedSystem.revision };
    const result = selectedSystem.status === "archived" ? await client.restore(input) : await client.archive(input);
    if (result.ok) {
      setSystems((current) => current.map((item) => String(item.systemId) === selectedSystemId ? result.value : item));
      setNotice(result.value.status === "archived" ? "System archived." : "System restored.");
    } else setError(result.error.message);
    setBusy(false);
  }

  async function cloneSystem() {
    if (!selectedSystem) return;
    const cloneName = `${selectedSystem.name} copy`;
    setBusy(true); setError(undefined);
    const result = await client.clone({ workspaceId, sourceSystemId: String(selectedSystem.systemId), name: cloneName });
    if (result.ok) {
      setSystems((current) => [result.value, ...current]);
      setSelectedSystemId(String(result.value.systemId));
      setDirty(false); setNotice(`Created ${cloneName}.`);
    } else setError(result.error.message);
    setBusy(false);
  }

  return (
    <>
    <section className="ui-panel ui-panel--sectioned system-builder" aria-labelledby="system-builder-workspace-title">
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--blue">
          <span className="ui-panel-heading__icon" aria-hidden="true"><ApplicationIcon name="systems" /></span>
          <div><h2 id="system-builder-workspace-title" className="ui-panel__title">System composition</h2><p className="ui-text-muted">Compose exact asset versions, configure instances, connect typed ports, and save immutable revisions.</p></div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--md">
        {error ? <p className="ui-status ui-status--error" role="alert">{error}</p> : null}
        {notice ? <p className="ui-status ui-status--success" role="status">{notice}</p> : null}
        <div className="system-builder__toolbar">
          <label>System<select value={selectedSystemId ?? ""} onChange={(event) => {
            if (dirty) { setError("Save or discard unsaved changes before switching systems."); return; }
            setSelectedSystemId(event.currentTarget.value || undefined);
          }}><option value="">Choose a system</option>{systems.map((system) => <option key={String(system.systemId)} value={String(system.systemId)}>{system.name}{system.status === "archived" ? " (archived)" : ""}</option>)}</select></label>
          <label>New system name<input value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Customer portal" /></label>
          <button type="button" onClick={() => void createSystem()} disabled={busy}><ApplicationIcon name="add" /><span>Create system</span></button>
          {selectedSystem ? <>
            <button type="button" className="ui-button--secondary" onClick={() => void cloneSystem()} disabled={busy || dirty}><ApplicationIcon name="copy" /><span>Clone</span></button>
            <button type="button" className="ui-button--secondary" onClick={() => void changeArchiveState()} disabled={busy || dirty}><ApplicationIcon name={selectedSystem.status === "archived" ? "refresh" : "archive"} /><span>{selectedSystem.status === "archived" ? "Restore" : "Archive"}</span></button>
          </> : null}
          <label>Reference template<select aria-label="Reference template" value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.currentTarget.value as SystemBuilderTemplateSummary["templateId"] | "")}><option value="">Choose a template</option>{templates.map((template) => <option key={template.templateId} value={template.templateId}>{template.displayName}</option>)}</select></label>
          <button type="button" className="ui-button--secondary" onClick={() => void createReferenceSystem()} disabled={busy || !selectedTemplateId}><ApplicationIcon name="systems" /><span>Create reference system</span></button>
          <button
            type="button"
            className="ui-button--secondary"
            onClick={() => setPreviewOpen(true)}
            disabled={busy || !selectedSystem || !revision || instances.length === 0}
            aria-haspopup="dialog"
          >
            <ApplicationIcon name="play" /><span>Preview UI</span>
          </button>
        </div>
        {!selectedSystem || !revision ? (
          <EmptyState title="Create or choose a system" description="Systems keep configuration and connections in immutable workspace-scoped revisions." icon="systems" />
        ) : <>
          <div className="system-builder__status">
            <span className={`ui-badge ui-badge--${selectedSystem.status === "blocked" ? "danger" : "info"}`}>{selectedSystem.status}</span>
            {dirty ? <span className="ui-badge ui-badge--warning">Unsaved changes</span> : null}
            <span>Revision {revision.revisionNumber}</span><span>{instances.length} assets</span><span>{bindings.length} connections</span>
          </div>
          <div className="system-builder__workspace">
            <aside className="system-builder__pane" aria-label="Asset catalog">
              <h3>1. Asset catalog</h3><p className="ui-text-muted">Add system-default, imported, or authored assets.</p>
              <label className="ui-sr-only" htmlFor="system-asset-search">Search assets</label>
              <input id="system-asset-search" value={assetSearch} onChange={(event) => setAssetSearch(event.currentTarget.value)} placeholder="Search assets" />
              <ul className="system-builder__asset-list">{filteredAssets.map((asset) => <li key={`${asset.definitionId}@${asset.version}`}><button type="button" className="system-builder__asset" onClick={() => addAsset(asset)}><strong>{asset.displayName}</strong><span>{asset.category ?? asset.definitionId}</span><small>v{asset.version}</small></button></li>)}</ul>
            </aside>
            <section className="system-builder__pane system-builder__canvas" aria-label="System hierarchy">
              <h3>2. Composition</h3><p className="ui-text-muted">Select an instance to configure it. Order determines the initial root.</p>
              {instances.length ? <ol className="system-builder__instance-list">{instances.map((instance, index) => <li key={String(instance.instanceId)}><button type="button" aria-pressed={String(instance.instanceId) === selectedInstanceId} onClick={() => setSelectedInstanceId(String(instance.instanceId))}><span className="system-builder__node-index">{index + 1}</span><span><strong>{instance.displayName ?? instance.definitionRef.id}</strong><small>{instance.definitionRef.id}@{instance.definitionRef.version}</small></span></button></li>)}</ol> : <EmptyState compact title="No assets in this system" description="Choose an asset from the catalog to start composing." icon="assets" />}
              {instances.length > 1 ? <div className="system-builder__connections">
                <h4>Connect typed ports</h4>
                <div className="ui-workflow__field-grid">
                  <label>Source<select value={sourceId} onChange={(event) => setSourceId(event.currentTarget.value)}><option value="">Choose source</option>{instances.map((item) => <option key={String(item.instanceId)} value={String(item.instanceId)}>{item.displayName}</option>)}</select></label>
                  <label>Source port<input value={sourcePort} onChange={(event) => setSourcePort(event.currentTarget.value)} placeholder="output" /></label>
                  <label>Target<select value={targetId} onChange={(event) => setTargetId(event.currentTarget.value)}><option value="">Choose target</option>{instances.map((item) => <option key={String(item.instanceId)} value={String(item.instanceId)}>{item.displayName}</option>)}</select></label>
                  <label>Target port<input value={targetPort} onChange={(event) => setTargetPort(event.currentTarget.value)} placeholder="input" /></label>
                </div>
                <button type="button" className="ui-button--secondary" onClick={connectInstances}><ApplicationIcon name="link" /><span>Add connection</span></button>
                <ul>{bindings.map((item) => <li key={String(item.bindingId)}><span>{item.sourceRef.id}:{item.sourcePortRef?.id ?? "default"} → {item.targetRef.id}:{item.targetPortRef?.id ?? "default"}</span><button type="button" className="ui-button--tertiary" onClick={() => removeBinding(String(item.bindingId))} aria-label={`Remove connection ${item.bindingId}`}><ApplicationIcon name="delete" /></button></li>)}</ul>
              </div> : null}
            </section>
            <aside className="system-builder__pane" aria-label="Instance inspector">
              <h3>3. Inspector</h3>
              {selectedInstance ? <div className="ui-stack ui-stack--sm">
                <dl><dt>Asset</dt><dd>{selectedInstance.definitionRef.id}</dd><dt>Version</dt><dd>{selectedInstance.definitionRef.version}</dd><dt>Instance ID</dt><dd>{selectedInstance.instanceId}</dd></dl>
                <div className="ui-inline-actions"><button type="button" className="ui-button--secondary" onClick={() => moveSelected(-1)} disabled={instances[0]?.instanceId === selectedInstance.instanceId}>Move up</button><button type="button" className="ui-button--secondary" onClick={() => moveSelected(1)} disabled={instances[instances.length - 1]?.instanceId === selectedInstance.instanceId}>Move down</button></div>
                <label>Configuration (JSON)<textarea className="system-builder__configuration" spellCheck={false} value={configurationText} onChange={(event) => setConfigurationText(event.currentTarget.value)} /></label>
                <button type="button" className="ui-button--secondary" onClick={applyConfiguration}><ApplicationIcon name="save" /><span>Apply configuration</span></button>
                <button type="button" className="ui-button--danger" onClick={removeSelected}><ApplicationIcon name="delete" /><span>Remove instance</span></button>
              </div> : <p className="ui-text-muted">Select an instance to inspect and configure it.</p>}
            </aside>
          </div>
          {revision.validationIssues.length ? <section className="system-builder__diagnostics" aria-labelledby="system-builder-diagnostics-title">
            <h3 id="system-builder-diagnostics-title">Validation diagnostics</h3>
            <ul>{revision.validationIssues.map((issue, index) => <li key={`${issue.category}-${index}`} className={`ui-status ui-status--${issue.severity === "error" ? "error" : "warning"}`}><strong>{issue.severity === "error" ? "Blocking" : "Review"}</strong><span>{issue.message}</span>{issue.path?.length ? <code>{issue.path.join(".")}</code> : null}</li>)}</ul>
          </section> : null}
          <footer className="system-builder__footer">
            <div><strong>Revision history</strong><span>{revisions.map((item) => `r${item.revisionNumber}`).join(" · ")}</span></div>
            <div className="ui-inline-actions">{dirty ? <button type="button" className="ui-button--secondary" onClick={discardDraft} disabled={busy}>Discard changes</button> : null}<button type="button" onClick={() => void save()} disabled={busy || !dirty || selectedSystem.status === "archived"}><ApplicationIcon name="save" /><span>Save and validate revision</span></button></div>
          </footer>
        </>}
      </div>
    </section>
      <ModalDialog
        open={previewOpen && Boolean(selectedSystem && revision)}
        title={`${selectedSystem?.name ?? "System"} UI preview`}
        onClose={() => setPreviewOpen(false)}
        closeLabel="Close system UI preview"
        dialogClassName="system-composition-preview-dialog"
      >
        {selectedSystem ? (
          <SystemCompositionPreview
            systemName={selectedSystem.name}
            instances={instances}
            includesUnsavedChanges={dirty}
          />
        ) : null}
      </ModalDialog>
    </>
  );
}

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48);
const uniqueId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/-/g, "");
