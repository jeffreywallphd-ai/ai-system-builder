import type { FormEvent } from "react";

import { ApplicationIcon, TermWithHint, TransientNotificationPublisher, TypeBadge } from "../../../../../../modules/ui/shared";
import { formatUploadedFileSize } from "../hooks/formatUploadedFileSize";

export type UploadStatus = "idle" | "uploading" | "success" | "partial" | "error" | "canceled";

export interface UploadFileResult {
  fileName: string;
  status: "success" | "error";
  message: string;
  key?: string;
  mediaType?: string;
  sizeBytes?: number;
}

export interface UploadViewState {
  status: UploadStatus;
  message?: string;
  key?: string;
  mediaType?: string;
  sizeBytes?: number;
  results?: readonly UploadFileResult[];
}

export interface ArtifactUploadFormProps {
  selectedFiles: readonly File[];
  viewState: UploadViewState;
  acceptedFileTypes: string;
  onFileChange: (event: FormEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancelUpload: () => void;
  workspaceId?: string;
}

export function ArtifactUploadForm({
  selectedFiles,
  viewState,
  acceptedFileTypes,
  onFileChange,
  onSubmit,
  onCancelUpload,
  workspaceId,
}: ArtifactUploadFormProps) {
  const uploadResults = viewState.results ?? (
    viewState.status === "success" && viewState.key
      ? [{
        fileName: "Selected artifact",
        status: "success" as const,
        message: viewState.message ?? "Stored artifact.",
        key: viewState.key,
        mediaType: viewState.mediaType,
        sizeBytes: viewState.sizeBytes,
      }]
      : []
  );
  return (
    <section className="ui-stack ui-stack--sm">
      <form className="ui-stack ui-stack--sm" onSubmit={onSubmit}>
        <label className="ui-label" htmlFor="thin-client-artifact-file-input">
          <TermWithHint termId="fileUpload">Choose artifact</TermWithHint>
        </label>
        <input
          id="thin-client-artifact-file-input"
          className="ui-file-input"
          name="thin-client-artifact-file-input"
          type="file"
          accept={acceptedFileTypes}
          multiple
          disabled={viewState.status === "uploading"}
          onChange={onFileChange}
        />
        <button className="ui-button artifact-ingestion-mobile-button" type="submit" disabled={viewState.status === "uploading"}>
          <ApplicationIcon name="upload" />
          <span className="ui-button__label">{viewState.status === "uploading" ? "Uploading..." : "Upload files"}</span>
        </button>
        <button
          className="ui-button artifact-ingestion-mobile-button"
          type="button"
          disabled={viewState.status !== "uploading" && selectedFiles.length === 0}
          onClick={onCancelUpload}
        >
          <ApplicationIcon name="close" />
          <span className="ui-button__label">Cancel upload</span>
        </button>
        <p className="ui-text-muted">Upload starts automatically after file selection. Use Upload files to retry if needed.</p>

        {viewState.status === "uploading" && viewState.message ? <p role="status">{viewState.message}</p> : null}
        <TransientNotificationPublisher
          message={viewState.status !== "idle" && viewState.status !== "uploading" ? viewState.message : undefined}
          title={viewState.status === "error" || viewState.status === "partial" ? "Artifact upload needs attention" : "Artifact upload completed"}
          tone={viewState.status === "error" ? "error" : viewState.status === "partial" ? "warning" : "success"}
          source="Artifact Upload"
          workspaceId={workspaceId}
        />

        {uploadResults.length > 0 ? (
          <section className="ui-stack ui-stack--sm" aria-label="Upload results">
            <h3>Upload results</h3>
            <ul className="ui-stack ui-stack--sm">
              {uploadResults.map((result) => (
                <li className="ui-panel ui-stack ui-stack--sm" key={`${result.fileName}-${result.key ?? result.message}`}>
                  <div className="ui-type-label"><TypeBadge value={result.mediaType ?? result.fileName} /><strong>{result.fileName}</strong></div>
                  <p>{result.status === "success" ? "Stored successfully." : `Failed: ${result.message}`}</p>
                  {result.status === "success" ? (
                    <dl className="ui-stack ui-stack--xs">
                      <dt><TermWithHint termId="storedKey">Stored key</TermWithHint></dt>
                      <dd>{result.key}</dd>
                      <dt><TermWithHint termId="mediaType">Stored media type</TermWithHint></dt>
                      <dd>{result.mediaType ?? "unknown"}</dd>
                      <dt><TermWithHint termId="storedSize">Stored size</TermWithHint></dt>
                      <dd>{formatUploadedFileSize(result.sizeBytes)}</dd>
                    </dl>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </form>

      {selectedFiles.length > 0 ? (
        <section className="ui-stack ui-stack--sm" aria-label="Selected files">
          <p>{selectedFiles.length === 1 ? "Selected file:" : `Selected files (${selectedFiles.length}):`}</p>
          <ul>
            {selectedFiles.map((file) => (
              <li className="ui-type-row" key={`${file.name}-${file.size}-${file.lastModified}`}><TypeBadge value={file.type || file.name} /><span>{file.name} ({file.type || "unknown"})</span></li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
