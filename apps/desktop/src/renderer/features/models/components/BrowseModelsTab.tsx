import type { useModelsFeature } from "../hooks/useModelsFeature";

type ModelsState = ReturnType<typeof useModelsFeature>;

export function BrowseModelsTab(props: { state: ModelsState }) {
  const s = props.state;
  return (
    <section className="ui-stack ui-stack--sm">
      <h2>Browse Models</h2>
      <div className="ui-grid ui-grid--two">
        <label className="ui-stack ui-stack--sm">
          <span>Query</span>
          <input className="ui-input" value={s.browseQuery} onChange={(event) => s.setBrowseQuery(event.target.value)} />
        </label>
        <label className="ui-stack ui-stack--sm">
          <span>Task tag</span>
          <input className="ui-input" value={s.browseTaskTag} onChange={(event) => s.setBrowseTaskTag(event.target.value)} placeholder="text-generation" />
        </label>
        <label className="ui-stack ui-stack--sm">
          <span>Limit</span>
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
      {s.saveState.message ? <p role={s.saveState.status === "error" ? "alert" : "status"}>{s.saveState.message}</p> : null}
      {s.downloadState.message ? <p role={s.downloadState.status === "error" ? "alert" : "status"}>{s.downloadState.message}</p> : null}
    </section>
  );
}
