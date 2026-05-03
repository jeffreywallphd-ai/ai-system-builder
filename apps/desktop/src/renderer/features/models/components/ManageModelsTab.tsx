import type { useModelsFeature } from "../hooks/useModelsFeature";

type ModelsState = ReturnType<typeof useModelsFeature>;

export function ManageModelsTab(props: { state: ModelsState }) {
  const s = props.state;

  return (
    <section className="ui-stack ui-stack--sm">
      <h2>Manage Models</h2>
      <p>Saved: {s.lifecycleCounts.saved} · Generated: {s.lifecycleCounts.generated} · Downloaded: {s.lifecycleCounts.downloaded}</p>
      <div className="ui-grid ui-grid--two">
        <label className="ui-stack ui-stack--sm">
          <span>Source</span>
          <select className="ui-input" value={s.manageSource} onChange={(event) => s.setManageSource(event.target.value)}>
            <option value="">All</option>
            <option value="huggingface">huggingface</option>
            <option value="local">local</option>
            <option value="generated">generated</option>
          </select>
        </label>
        <label className="ui-stack ui-stack--sm">
          <span>Lifecycle</span>
          <select className="ui-input" value={s.manageLifecycleStatus} onChange={(event) => s.setManageLifecycleStatus(event.target.value)}>
            <option value="">All</option>
            <option value="saved-reference">saved-reference</option>
            <option value="downloaded">downloaded</option>
            <option value="generated">generated</option>
            <option value="validated">validated</option>
          </select>
        </label>
        <label className="ui-stack ui-stack--sm">
          <span>Artifact form</span>
          <select className="ui-input" value={s.manageArtifactForm} onChange={(event) => s.setManageArtifactForm(event.target.value)}>
            <option value="">All</option>
            <option value="full-model">full-model</option>
            <option value="adapter">adapter</option>
            <option value="merged-model">merged-model</option>
            <option value="checkpoint">checkpoint</option>
          </select>
        </label>
        <label className="ui-stack ui-stack--sm">
          <span>Search</span>
          <input className="ui-input" value={s.manageSearch} onChange={(event) => s.setManageSearch(event.target.value)} />
        </label>
      </div>
      <button className="ui-button" type="button" onClick={() => void s.refreshModels()}>Refresh Models</button>
      {s.manageState.message ? <p role={s.manageState.status === "error" ? "alert" : "status"}>{s.manageState.message}</p> : null}

      {s.pendingDeleteModelRecordId ? (
        <section className="ui-panel ui-stack ui-stack--sm" role="dialog" aria-label="Model delete confirmation">
          <p>Type <strong>Delete</strong> to remove the model record from the registry only.</p>
          <input
            className="ui-input"
            value={s.deleteConfirmationInput}
            onChange={(event) => s.setDeleteConfirmationInput(event.target.value)}
            onInput={(event) => s.setDeleteConfirmationInput((event.target as HTMLInputElement).value)}
            placeholder="Delete"
          />
          <div className="ui-grid ui-grid--two">
            <button className="ui-button ui-button--destructive" type="button" onClick={() => void s.confirmDeleteModelRecord()} disabled={s.deleteConfirmationInput !== "Delete"}>
              Confirm Registry Delete
            </button>
            <button className="ui-button" type="button" onClick={() => s.setPendingDeleteModelRecordId(undefined)}>Cancel</button>
          </div>
        </section>
      ) : null}

      <div className="ui-grid ui-grid--two">
        <section className="ui-stack ui-stack--sm">
          {s.models.map((model) => (
            <article key={model.modelRecordId} className="ui-panel ui-stack ui-stack--sm">
              <strong>{model.displayName}</strong>
              <small>{model.modelId ?? model.localPath ?? model.modelRecordId}</small>
              <small>{model.source} · {model.lifecycleStatus} · {model.artifactForm}</small>
              <small>inference: {model.inferenceMode ?? "n/a"} · validation: {model.validationStatus ?? "unknown"} · backing artifacts: {model.backingArtifactIds?.length ?? 0}</small>
              <small>serialization: {model.serializationFormat ?? "unknown"} · report: {model.validationReportPath ?? "n/a"}</small>
              <div className="ui-grid ui-grid--two">
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
        <section className="ui-panel ui-stack ui-stack--sm">
          <h3>Model Asset Details</h3>
          {s.selectedManagedModel ? (
            <>
              <p>Record: {s.selectedManagedModel.modelRecordId}</p>
              <p>Model ID: {s.selectedManagedModel.modelId ?? "n/a"}</p>
              <p>Local path: {s.selectedManagedModel.localPath ?? "n/a"}</p>
              <p>Primary artifact: {s.selectedManagedModel.primaryArtifactId ?? "none"}</p>
              <p>Backing artifact IDs: {s.selectedManagedModel.backingArtifactIds?.join(", ") ?? "none"}</p>
              <p>Validation: {s.selectedManagedModel.validationStatus ?? "unknown"}</p>
              {s.selectedManagedModel.validationStatus === "warning" ? (
                <p role="status">Warning validation is not safely publishable by default.</p>
              ) : null}
              <p>Validation report: {s.selectedManagedModel.validationReportPath ?? "n/a"}</p>
              <label className="ui-stack ui-stack--sm">
                <span>Hugging Face repository (owner/name)</span>
                <input className="ui-input" value={s.publishRepository} onChange={(event) => s.setPublishRepository(event.target.value)} placeholder="owner/model-name" />
              </label>
              <div className="ui-grid ui-grid--two">
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
            </>
          ) : <p>Select a model asset record.</p>}
        </section>
      </div>
    </section>
  );
}
