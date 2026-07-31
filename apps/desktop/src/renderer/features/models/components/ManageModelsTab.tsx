import type { useModelsFeature } from "../hooks/useModelsFeature";
import {
  ApplicationIcon,
  PanelHeading,
  TermWithHint,
  TransientNotificationPublisher,
} from "../../../../../../../modules/ui/shared";
import { ModalDialog } from "../../../../../../../modules/ui/shared/components/ModalDialog";

type ModelsState = ReturnType<typeof useModelsFeature>;

export function ManageModelsTab(props: { state: ModelsState }) {
  const s = props.state;
  const emptyInventoryMessage = s.manageState.status === "success"
    && s.manageState.message === "No model records found.";

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="models" tone="blue">
          Manage Models
        </PanelHeading>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
        <p>Review saved, generated, and downloaded models in this workspace.</p>
        <p>Saved: {s.lifecycleCounts.saved} | Generated: {s.lifecycleCounts.generated} | Downloaded: {s.lifecycleCounts.downloaded}</p>

        <div className="ui-workflow__field-grid">
          <label className="ui-stack ui-stack--sm">
            <span><TermWithHint termId="modelSource">Source</TermWithHint></span>
            <select className="ui-input" value={s.manageSource} onChange={(event) => s.setManageSource(event.target.value)}>
              <option value="">All</option>
              <option value="huggingface">Hugging Face</option>
              <option value="local">Local</option>
              <option value="generated">Generated</option>
            </select>
          </label>
          <label className="ui-stack ui-stack--sm">
            <span><TermWithHint termId="lifecycleStatus">Lifecycle</TermWithHint></span>
            <select className="ui-input" value={s.manageLifecycleStatus} onChange={(event) => s.setManageLifecycleStatus(event.target.value)}>
              <option value="">All</option>
              <option value="saved-reference">Saved reference</option>
              <option value="downloaded">Downloaded</option>
              <option value="generated">Generated</option>
              <option value="validated">Validated</option>
            </select>
          </label>
          <label className="ui-stack ui-stack--sm">
            <span><TermWithHint termId="artifactFamily">Artifact form</TermWithHint></span>
            <select className="ui-input" value={s.manageArtifactForm} onChange={(event) => s.setManageArtifactForm(event.target.value)}>
              <option value="">All</option>
              <option value="full-model">Full model</option>
              <option value="adapter">Adapter</option>
              <option value="merged-model">Merged model</option>
              <option value="checkpoint">Checkpoint</option>
            </select>
          </label>
          <label className="ui-stack ui-stack--sm">
            <span><TermWithHint termId="modelSearch">Search</TermWithHint></span>
            <input className="ui-input" value={s.manageSearch} onChange={(event) => s.setManageSearch(event.target.value)} />
          </label>
        </div>

        <div className="ui-workflow__actions">
          <button className="ui-button" type="button" onClick={() => void s.refreshModels()} disabled={s.manageState.status === "loading"}>
            <ApplicationIcon name="refresh" />
            <span className="ui-button__label">Refresh Models</span>
          </button>
        </div>

        {s.manageState.status === "loading" && s.manageState.message ? <p role="status">{s.manageState.message}</p> : null}
        {emptyInventoryMessage ? <p className="ui-text-muted" role="status">{s.manageState.message}</p> : null}
        <TransientNotificationPublisher message={s.manageState.status !== "loading" && !emptyInventoryMessage ? s.manageState.message : undefined} title={s.manageState.status === "error" ? "Model management needs attention" : "Models updated"} tone={s.manageState.status === "error" ? "error" : "success"} source="Models" workspaceId={s.workspaceId} />
        <TransientNotificationPublisher message={s.folderOpenState.status === "error" ? s.folderOpenState.message : undefined} title="Model folder needs attention" tone="error" source="Models" workspaceId={s.workspaceId} />

        <section className="models-feature__card-grid" aria-label="Managed models">
          {s.models.map((model) => (
            <article key={model.modelRecordId} className="ui-panel ui-stack ui-stack--sm models-feature__card">
              <strong>{model.displayName}</strong>
              <small className="models-feature__identifier">{model.modelId ?? model.modelRecordId}</small>
              <small>{model.source} | {model.lifecycleStatus} | {model.artifactForm}</small>
              <small>Inference: {model.inferenceMode ?? "n/a"} | Validation: {model.validationStatus ?? "unknown"} | Backing artifacts: {model.backingArtifactIds?.length ?? 0}</small>
              <small>Serialization: {model.serializationFormat ?? "unknown"} | Local files: {model.localFilesAvailable ? "available" : "not available"}</small>
              <div className="ui-cluster models-feature__card-actions">
                <button className="ui-button" type="button" onClick={() => s.setSelectedManagedModel(model)}>Details</button>
                <button className="ui-button ui-button--destructive" type="button" onClick={() => {
                  s.setDeleteConfirmationInput("");
                  s.setPendingDeleteModelRecordId(model.modelRecordId);
                }}>
                  Delete Record
                </button>
              </div>
            </article>
          ))}
        </section>

        {s.selectedManagedModel ? (
          <ModalDialog
            open
            title="Model details"
            closeLabel="Close model details"
            dialogClassName="models-feature__details-dialog"
            onClose={() => s.setSelectedManagedModel(undefined)}
          >
            <dl className="models-feature__details-list">
              <div><dt>Record</dt><dd>{s.selectedManagedModel.modelRecordId}</dd></div>
              <div><dt>Model ID</dt><dd>{s.selectedManagedModel.modelId ?? "n/a"}</dd></div>
              <div><dt>Local files</dt><dd>{s.selectedManagedModel.localFilesAvailable ? "Available" : "Not available"}</dd></div>
              <div><dt>Primary artifact</dt><dd>{s.selectedManagedModel.primaryArtifactId ?? "none"}</dd></div>
              <div><dt>Backing artifact IDs</dt><dd>{s.selectedManagedModel.backingArtifactIds?.join(", ") ?? "none"}</dd></div>
              <div><dt>Validation</dt><dd>{s.selectedManagedModel.validationStatus ?? "unknown"}</dd></div>
              <div><dt>Validation report</dt><dd>{s.selectedManagedModel.validationReportAvailable ? "Available" : "Not available"}</dd></div>
            </dl>
            {s.selectedManagedModel.validationStatus === "warning" ? (
              <p role="status">Warning validation is not safely publishable by default.</p>
            ) : null}
            <button
              className="ui-button"
              type="button"
              onClick={() => void s.revealManagedModelInFolder()}
              disabled={!s.selectedManagedModel.localFilesAvailable || s.folderOpenState.status === "loading"}
            >
              Open in folder
            </button>
            {!s.selectedManagedModel.localFilesAvailable ? (
              <small className="ui-text-muted">Download or generate this model locally to open its files.</small>
            ) : null}
            <label className="ui-stack ui-stack--sm">
              <span><TermWithHint termId="repository">Hugging Face repository</TermWithHint> (owner/name)</span>
              <input className="ui-input" value={s.publishRepository} onChange={(event) => s.setPublishRepository(event.target.value)} placeholder="owner/model-name" />
            </label>
            <div className="ui-cluster">
              <button className="ui-button" type="button" onClick={() => void s.validateManagedModel()}>
                Validate
              </button>
              <button
                className="ui-button"
                type="button"
                onClick={() => void s.publishManagedModel()}
                disabled={s.selectedManagedModel.validationStatus !== "valid" || s.publishRepository.trim().length === 0}
              >
                Publish
              </button>
            </div>
          </ModalDialog>
        ) : null}

        {s.pendingDeleteModelRecordId ? (
          <ModalDialog
            open
            title="Delete model record"
            closeLabel="Close delete confirmation"
            onClose={() => s.setPendingDeleteModelRecordId(undefined)}
          >
            <p>Type <strong>Delete</strong> to remove this record from the registry. Local model files will not be deleted.</p>
            <label className="ui-stack ui-stack--sm">
              <span><TermWithHint termId="deleteConfirmation">Confirmation</TermWithHint></span>
              <input
                className="ui-input"
                value={s.deleteConfirmationInput}
                onChange={(event) => s.setDeleteConfirmationInput(event.target.value)}
                placeholder="Delete"
                data-modal-initial-focus
              />
            </label>
            <div className="ui-cluster">
              <button className="ui-button ui-button--destructive" type="button" onClick={() => void s.confirmDeleteModelRecord()} disabled={s.deleteConfirmationInput !== "Delete"}>
                Delete record
              </button>
              <button className="ui-button" type="button" onClick={() => s.setPendingDeleteModelRecordId(undefined)}>Cancel</button>
            </div>
          </ModalDialog>
        ) : null}
      </div>
    </section>
  );
}
