import type { ArtifactPreviewView } from "./artifactPreviewModel";
import { SafeMarkdownPreview } from "./SafeMarkdownPreview";

export interface ArtifactPreviewPanelProps {
  readonly preview?: ArtifactPreviewView;
}

export function ArtifactPreviewPanel({ preview }: ArtifactPreviewPanelProps) {
  const activePreview =
    preview ??
    ({
      status: "idle",
      title: "Artifact preview",
      message: "Select an artifact with local bytes to see a limited preview.",
    } satisfies ArtifactPreviewView);
  const descriptor = activePreview.descriptor;

  return (
    <section
      className="artifact-preview ui-stack ui-stack--sm"
      aria-label="Artifact preview"
    >
      <header className="artifact-preview__header">
        <h4>{activePreview.title}</h4>
        {descriptor ? <small>{descriptor.fileTypeLabel}</small> : null}
      </header>
      {activePreview.message ? (
        <p className="ui-text-muted">{activePreview.message}</p>
      ) : null}
      {activePreview.status === "loading" ? (
        <p role="status">Preparing preview...</p>
      ) : null}
      {activePreview.status === "error" ? (
        <p role="alert">Preview could not be prepared.</p>
      ) : null}
      {activePreview.table ? (
        <div className="artifact-preview__viewport" tabIndex={0}>
          <table className="ui-table">
            <caption className="ui-visually-hidden">
              {activePreview.title}
            </caption>
            <thead>
              <tr>
                {activePreview.table.columns.map((column, index) => (
                  <th key={`${index}-${column}`} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activePreview.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {activePreview.text && descriptor?.kind === "markdown" ? (
        <div className="artifact-preview__viewport" tabIndex={0}>
          <SafeMarkdownPreview markdown={activePreview.text} />
        </div>
      ) : null}
      {activePreview.text && descriptor?.kind !== "markdown" ? (
        <div className="artifact-preview__viewport" tabIndex={0}>
          <pre
            className={`artifact-preview__text${descriptor?.kind === "json" || descriptor?.kind === "jsonl" ? " artifact-preview__text--json" : ""}`}
          >
            {activePreview.text}
          </pre>
        </div>
      ) : null}
      {descriptor?.kind === "image" && activePreview.mediaUrl ? (
        <div className="artifact-preview__viewport artifact-preview__viewport--media">
          <img
            className="artifact-preview__image"
            src={activePreview.mediaUrl}
            alt={descriptor.originalName ?? descriptor.storageKey}
            loading="lazy"
            decoding="async"
          />
        </div>
      ) : null}
      {descriptor?.kind === "video" && activePreview.mediaUrl ? (
        <div className="artifact-preview__viewport artifact-preview__viewport--media">
          <video
            className="artifact-preview__video"
            src={activePreview.mediaUrl}
            controls
            preload="metadata"
          />
        </div>
      ) : null}
      {descriptor?.kind === "pdf" && activePreview.mediaUrl ? (
        <div className="artifact-preview__viewport artifact-preview__viewport--document">
          <img
            className="artifact-preview__pdf-page"
            src={activePreview.mediaUrl}
            alt={`First page of ${descriptor.originalName ?? descriptor.storageKey}`}
          />
        </div>
      ) : null}
      {activePreview.truncated ? (
        <p className="ui-text-muted">
          Preview truncated to keep the browser responsive.
        </p>
      ) : null}
    </section>
  );
}
