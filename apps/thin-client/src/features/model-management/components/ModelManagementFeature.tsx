import { Fragment } from "react";
import { TermWithHint, TransientNotificationPublisher } from "../../../../../../modules/ui/shared";
import type { ModelBrowseItem, ModelInventoryRecord } from "../../../../../../modules/contracts/model";
import type { ModelManagementApiClient } from "../api/apiModelManagementClient";
import { useModelManagementFeature } from "../hooks/useModelManagementFeature";

function downloadStateLabel(record: ModelInventoryRecord): string {
  if (record.lifecycleStatus === "downloaded" || record.lifecycleStatus === "validated") return "Downloaded";
  if (record.lifecycleStatus === "saved-reference" || record.lifecycleStatus === "remote-reference") return "Reference saved";
  if (record.lifecycleStatus === "invalid") return "Download unavailable/error";
  return "Not downloaded";
}

export function ModelManagementFeature({ client, workspaceId }: { client?: ModelManagementApiClient; workspaceId?: string; workspaceName?: string }) {
  const vm = useModelManagementFeature(client, workspaceId);
  const emptyBrowseMessage = vm.status === "No model results found.";
  return <section className="ui-panel ui-panel--elevated ui-stack ui-stack--sm"><header className="ui-grid ui-grid--two"><h2>Models</h2><button className="ui-button" onClick={() => void vm.refreshInventory()} disabled={vm.inventoryLoading}>{vm.inventoryLoading ? "Refreshing..." : "Refresh"}</button></header>
    <TransientNotificationPublisher message={vm.error} title="Models need attention" tone="error" source="Models" workspaceId={workspaceId} />
    <TransientNotificationPublisher message={!emptyBrowseMessage ? vm.status : undefined} title="Models updated" tone="success" source="Models" workspaceId={workspaceId} />

    <section className="ui-stack ui-stack--sm"><h3>Browse models</h3>
      <label className="ui-stack ui-stack--xs"><span className="ui-label"><TermWithHint termId="modelSearch">Search</TermWithHint></span><input className="ui-input" value={vm.query} placeholder="Search models" onChange={(e) => vm.setQuery(e.target.value)} /></label>
      <label className="ui-stack ui-stack--xs"><span className="ui-label"><TermWithHint termId="provider">Provider</TermWithHint></span><select className="ui-input" value={vm.provider} onChange={(e) => vm.setProvider(e.target.value as "huggingface")}><option value="huggingface">Hugging Face</option></select></label>
      <div className="ui-grid ui-grid--two"><button className="ui-button" onClick={() => void vm.browse()} disabled={vm.browsing}>Browse models</button><button className="ui-button" onClick={vm.clear} disabled={vm.loading}>Clear</button></div>
      {vm.query.trim().length === 0 ? <p className="ui-text-muted">Enter a search term to browse models.</p> : null}
    </section>

    <section className="ui-stack ui-stack--sm"><h3>Browse results</h3>{emptyBrowseMessage ? <p className="ui-text-muted" role="status">{vm.status}</p> : null}<ul className="ui-stack ui-stack--sm">{vm.browseResults.map((m: ModelBrowseItem) => <li key={m.modelId} className="ui-panel ui-stack ui-stack--sm">
      <header className="ui-grid ui-grid--two"><strong>{m.displayName}</strong><span>{m.modelId}</span></header>
      <dl className="ui-grid ui-grid--two"><dt><TermWithHint termId="provider">Provider</TermWithHint></dt><dd>{m.provider}</dd><dt><TermWithHint termId="taskTags">Tasks</TermWithHint></dt><dd>{m.taskTags?.join(", ") || "n/a"}</dd><dt><TermWithHint termId="inference">Inference</TermWithHint></dt><dd>{m.inferenceMode || "n/a"}</dd></dl>
      <div className="ui-grid ui-grid--two"><button className="ui-button" onClick={() => void vm.viewDetails(m.modelId)} disabled={vm.loading}>Details</button><button className="ui-button" onClick={() => void vm.saveReference(m)} disabled={vm.loading}>Save reference</button><button className="ui-button" onClick={() => void vm.download(m)} disabled={vm.downloadingModelId === m.modelId}>{vm.downloadingModelId === m.modelId ? "Downloading..." : "Download"}</button></div>
    </li>)}</ul></section>

    <section className="ui-stack ui-stack--sm"><h3>Server model inventory</h3>
      <ul className="ui-stack ui-stack--sm">{vm.inventory.map((m) => <li key={m.modelRecordId} className="ui-panel ui-stack ui-stack--sm">
        <header className="ui-grid ui-grid--two"><strong>{m.displayName}</strong><span>{downloadStateLabel(m)}</span></header>
        <dl className="ui-grid ui-grid--two"><dt><TermWithHint termId="provider">Provider</TermWithHint></dt><dd>{m.provider}</dd><dt><TermWithHint termId="lifecycleStatus">Status</TermWithHint></dt><dd>{m.lifecycleStatus}</dd><dt><TermWithHint termId="modelId">Model ID</TermWithHint></dt><dd>{m.modelId || "n/a"}</dd><dt><TermWithHint termId="taskTags">Tasks</TermWithHint></dt><dd>{m.taskTags?.join(", ") || "n/a"}</dd></dl>
        <div className="ui-grid ui-grid--two"><button className="ui-button" onClick={() => void vm.viewDetails(m.modelId ?? "")} disabled={!m.modelId || vm.loading}>Details</button><button className="ui-button" onClick={() => void vm.deleteRecord(m.modelRecordId)} disabled={vm.deletingModelRecordId === m.modelRecordId}>{vm.deletingModelRecordId === m.modelRecordId ? "Deleting..." : "Delete record"}</button></div>
      </li>)}</ul>
    </section>

    <details className="ui-panel"><summary>Diagnostics</summary><ul className="ui-stack ui-stack--xs">{vm.diagnostics.map((d,idx)=><li key={idx}><strong>{d.operation}</strong> {d.phase} - {d.message} <span className="ui-text-muted">{d.timestamp}</span>{d.metadata?.endpoint? <div className="ui-text-muted">endpoint: {String(d.metadata.endpoint)}</div>:null}{d.metadata?.status? <div className="ui-text-muted">status: {String(d.metadata.status)}</div>:null}{d.metadata?.elapsedMs? <div className="ui-text-muted">elapsedMs: {String(d.metadata.elapsedMs)}</div>:null}</li>)}</ul></details>{vm.details ? <details><summary>Model details</summary><dl className="ui-grid ui-grid--two">{Object.entries(vm.details).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></Fragment>)}</dl></details> : null}
  </section>;
}
