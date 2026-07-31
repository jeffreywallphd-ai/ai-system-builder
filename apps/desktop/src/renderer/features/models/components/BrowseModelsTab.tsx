import type { FormEvent } from "react";

import type { useModelsFeature } from "../hooks/useModelsFeature";
import {
  ApplicationIcon,
  PanelHeading,
  TermWithHint,
  TransientNotificationPublisher,
} from "../../../../../../../modules/ui/shared";

type ModelsState = ReturnType<typeof useModelsFeature>;

const MODEL_TASK_OPTIONS = [
  ["text-generation", "Text generation"],
  ["text2text-generation", "Text-to-text generation"],
  ["question-answering", "Question answering"],
  ["summarization", "Summarization"],
  ["text-classification", "Text classification"],
  ["token-classification", "Token classification"],
  ["feature-extraction", "Embeddings / feature extraction"],
  ["automatic-speech-recognition", "Speech recognition"],
  ["text-to-image", "Text to image"],
  ["image-classification", "Image classification"],
  ["object-detection", "Object detection"],
  ["image-to-text", "Image to text"],
] as const;

export function BrowseModelsTab(props: { state: ModelsState }) {
  const s = props.state;
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void s.searchModels();
  };

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="browse" tone="violet">
          Find Models
        </PanelHeading>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
        <p>Search Hugging Face for a model, then save its reference or download it for local use.</p>
        <form className="ui-stack ui-stack--sm" onSubmit={submitSearch}>
          <div className="ui-workflow__field-grid">
            <label className="ui-stack ui-stack--sm">
              <span><TermWithHint termId="modelSearch">Query</TermWithHint></span>
              <input
                className="ui-input"
                value={s.browseQuery}
                onChange={(event) => s.setBrowseQuery(event.target.value)}
                placeholder="Model name or organization"
              />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span><TermWithHint termId="modelTaskTag">Task</TermWithHint></span>
              <select
                className="ui-input"
                value={s.browseTaskTag}
                onChange={(event) => s.setBrowseTaskTag(event.target.value)}
              >
                <option value="">Any task</option>
                {MODEL_TASK_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
                <option value="other">Other...</option>
              </select>
            </label>
            {s.browseTaskTag === "other" ? (
              <label className="ui-stack ui-stack--sm">
                <span>Other task tag</span>
                <input
                  className="ui-input"
                  value={s.browseOtherTaskTag}
                  onChange={(event) => s.setBrowseOtherTaskTag(event.target.value)}
                  placeholder="Enter a Hugging Face task tag"
                  required
                />
              </label>
            ) : null}
            <label className="ui-stack ui-stack--sm">
              <span><TermWithHint termId="modelSearchLimit">Results per page</TermWithHint></span>
              <select
                className="ui-input"
                value={s.browseLimit}
                onChange={(event) => s.setBrowseLimit(event.target.value)}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </label>
          </div>
          <div className="ui-workflow__actions">
            <button className="ui-button" type="submit" disabled={s.browseState.status === "loading"}>
              <ApplicationIcon name="browse" />
              <span className="ui-button__label">Search Models</span>
            </button>
          </div>
        </form>

        {s.browseState.message ? (
          <p role={s.browseState.status === "error" ? "alert" : "status"}>{s.browseState.message}</p>
        ) : null}

        <section className="models-feature__card-grid" aria-label="Model search results">
          {s.browseItems.map((item) => (
            <article key={item.modelId} className="ui-panel ui-stack ui-stack--sm models-feature__card">
              <strong>{item.displayName}</strong>
              <p className="models-feature__identifier">{item.modelId}</p>
              {item.description ? <p>{item.description}</p> : null}
              <small>{item.taskTags?.join(", ") ?? "No task tags provided"}</small>
              <small>Downloads: {item.downloads ?? "n/a"} | Likes: {item.likes ?? "n/a"} | License: {item.license ?? "n/a"}</small>
              <small>Inference: {item.inferenceMode ?? "unknown"} | Gated: {item.gated ? "yes" : "no"} | Private: {item.private ? "yes" : "no"}</small>
              <div className="ui-cluster models-feature__card-actions">
                <button className="ui-button" type="button" onClick={() => void s.saveModelReference(item)}>Save</button>
                <button className="ui-button" type="button" onClick={() => void s.downloadModel(item)}>Download</button>
              </div>
            </article>
          ))}
        </section>

        {s.browseItems.length > 0 ? (
          <nav className="models-feature__pagination" aria-label="Model search result pages">
            <button
              className="ui-button"
              type="button"
              onClick={() => void s.searchPreviousPage()}
              disabled={s.browsePageIndex === 0 || s.browseState.status === "loading"}
            >
              Previous
            </button>
            <span aria-live="polite">Page {s.browsePageIndex + 1}</span>
            <button
              className="ui-button"
              type="button"
              onClick={() => void s.searchNextPage()}
              disabled={!s.browseNextCursor || s.browseState.status === "loading"}
            >
              Next
            </button>
          </nav>
        ) : null}

        <TransientNotificationPublisher message={s.saveState.message} title={s.saveState.status === "error" ? "Model save needs attention" : "Model reference saved"} tone={s.saveState.status === "error" ? "error" : "success"} source="Models" workspaceId={s.workspaceId} />
        <TransientNotificationPublisher message={s.downloadState.status === "error" ? s.downloadState.message : undefined} title="Model download needs attention" tone="error" source="Models" workspaceId={s.workspaceId} />
      </div>
    </section>
  );
}
