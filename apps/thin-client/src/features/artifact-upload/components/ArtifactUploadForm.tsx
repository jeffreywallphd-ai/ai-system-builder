import type { FormEvent } from "react";

export type UploadStatus = "idle" | "uploading" | "success" | "error";

export interface UploadViewState {
  status: UploadStatus;
  message?: string;
  key?: string;
  mediaType?: string;
  sizeBytes?: number;
}

export interface ArtifactUploadFormProps {
  selectedFile: File | null;
  viewState: UploadViewState;
  acceptedFileTypes: string;
  onFileChange: (event: FormEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ArtifactUploadForm({
  selectedFile,
  viewState,
  acceptedFileTypes,
  onFileChange,
  onSubmit,
}: ArtifactUploadFormProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <form className="ui-stack ui-stack--sm" onSubmit={onSubmit}>
        <label className="ui-label" htmlFor="thin-client-artifact-file-input">
          Choose artifact
        </label>
        <input
          id="thin-client-artifact-file-input"
          className="ui-file-input"
          name="thin-client-artifact-file-input"
          type="file"
          accept={acceptedFileTypes}
          multiple={false}
          onChange={onFileChange}
        />
        <button className="ui-button artifact-ingestion-mobile-button" type="submit" disabled={viewState.status === "uploading"}>
          {viewState.status === "uploading" ? "Uploading..." : "Upload"}
        </button>

        {viewState.message ? (
          <p
            className={viewState.status === "success" ? "ui-status ui-status--success" : "ui-status"}
            role={viewState.status === "error" ? "alert" : "status"}
          >
            {viewState.message}
          </p>
        ) : null}

        {viewState.status === "success" && viewState.key ? (
          <dl className="ui-stack ui-stack--xs">
            <dt>Stored key</dt>
            <dd>{viewState.key}</dd>
            <dt>Stored media type</dt>
            <dd>{viewState.mediaType ?? "unknown"}</dd>
            <dt>Stored size bytes</dt>
            <dd>{viewState.sizeBytes ?? "unknown"}</dd>
          </dl>
        ) : null}
      </form>

      {selectedFile ? (
        <p>
          Selected file: {selectedFile.name} ({selectedFile.type || "unknown"})
        </p>
      ) : null}
    </section>
  );
}
