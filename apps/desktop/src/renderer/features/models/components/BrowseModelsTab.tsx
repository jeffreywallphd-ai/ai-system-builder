import type { useModelsFeature } from "../hooks/useModelsFeature";
import { TermWithHint, TransientNotificationPublisher } from "../../../../../../../modules/ui/shared";

type ModelsState = ReturnType<typeof useModelsFeature>;

export function BrowseModelsTab(props: { state: ModelsState }) {
  const s = props.state;
  return (
    <section className="ui-stack ui-stack--sm">
      <h2>Browse Models</h2>
      <div className="ui-grid ui-grid--two">
        <label className="ui-stack ui-stack--sm">
          <span><TermWithHint termId="modelSearch">Query</TermWithHint></span>
          <input className="ui-input" value={s.browseQuery} onChange={(event) => s.setBrowseQuery(event.target.value)} />
        </label>
        <label className="ui-stack ui-stack--sm">
          <span><TermWithHint termId="modelTaskTag">Task tag</TermWithHint></span>
          <input className="ui-input" value={s.browseTaskTag} onChange={(event) => s.setBrowseTaskTag(event.target.value)} placeholder="text-generation" />
        </label>
        <label className="ui-stack ui-stack--sm">
          <span><TermWithHint termId="modelSearchLimit">Limit</TermWithHint></span>
          <input className="ui-input" value={s.browseLimit} onChange={(event) => s.setBrowseLimit(event.target.value)} />
        </label>
      </div>
      <button className="ui-button" type="button" onClick={() => void s.searchModels()}>Search Models</button>
      {s.browseState.message ? <p role={s.browseState.status === "error" ? "alert" : "status"}>{s.browseState.message}</p> : null}

      <section className="ui-grid ui-grid--two">
        {s.browseItems.map((item) => (
          <article key={item.modelId} className="ui-panel ui-stack ui-stack--sm">
            <strong>{item.displayName}</strong>
            <p>{item.modelId}</p>
            {item.description ? <p>{item.description}</p> : null}
            <small>{item.taskTags?.join(", ") ?? "no task tags"}</small>
            <small>downloads: {item.downloads ?? "n/a"} | likes: {item.likes ?? "n/a"} | license: {item.license ?? "n/a"}</small>
            <small>inference: {item.inferenceMode ?? "unknown"} | gated: {item.gated ? "yes" : "no"} | private: {item.private ? "yes" : "no"}</small>
            <button className="ui-button" type="button" onClick={() => void s.saveModelReference(item)}>Save</button>
            <button className="ui-button" type="button" onClick={() => void s.downloadModel(item)}>Download</button>
          </article>
        ))}
      </section>
      <TransientNotificationPublisher message={s.saveState.message} title={s.saveState.status === "error" ? "Model save needs attention" : "Model reference saved"} tone={s.saveState.status === "error" ? "error" : "success"} source="Models" workspaceId={s.workspaceId} />
      <TransientNotificationPublisher message={s.downloadState.status === "error" ? s.downloadState.message : undefined} title="Model download needs attention" tone="error" source="Models" workspaceId={s.workspaceId} />
    </section>
  );
}
