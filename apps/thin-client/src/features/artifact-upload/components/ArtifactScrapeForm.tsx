export interface ArtifactScrapeFormProps {
  websiteSingleUrl: string;
  websiteSingleMode: "automatic" | "rendered";
  websiteBatchInput: string;
  websiteBatchMode: "automatic" | "rendered";
  websiteSingleViewState: {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    result?: {
      acquisitionMechanismUsed: "simple-http" | "rendered-browser";
      stagedArtifact?: {
        storage: { key: string };
        originalName?: string;
      };
    };
  };
  websiteBatchViewState: {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    summary?: {
      attempted: number;
      succeeded: number;
      failed: number;
    };
  };
  setWebsiteSingleUrl: (value: string) => void;
  setWebsiteSingleMode: (mode: "automatic" | "rendered") => void;
  setWebsiteBatchInput: (value: string) => void;
  setWebsiteBatchMode: (mode: "automatic" | "rendered") => void;
  ingestWebsiteSingle: () => Promise<void>;
  ingestWebsiteBatch: () => Promise<void>;
}

export function ArtifactScrapeForm({
  websiteSingleUrl,
  websiteSingleMode,
  websiteBatchInput,
  websiteBatchMode,
  websiteSingleViewState,
  websiteBatchViewState,
  setWebsiteSingleUrl,
  setWebsiteSingleMode,
  setWebsiteBatchInput,
  setWebsiteBatchMode,
  ingestWebsiteSingle,
  ingestWebsiteBatch,
}: ArtifactScrapeFormProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <label className="ui-stack ui-stack--sm">
        <span>Single page URL</span>
        <input
          className="ui-input"
          value={websiteSingleUrl}
          onChange={(event) => setWebsiteSingleUrl(event.target.value)}
          placeholder="https://example.com/docs"
        />
      </label>
      <label className="ui-stack ui-stack--sm">
        <span>Single-page mode</span>
        <select
          className="ui-input"
          value={websiteSingleMode}
          onChange={(event) => setWebsiteSingleMode(event.target.value as "automatic" | "rendered")}
        >
          <option value="automatic">automatic</option>
          <option value="rendered">rendered</option>
        </select>
      </label>
      <button className="ui-button artifact-ingestion-mobile-button" type="button" onClick={() => void ingestWebsiteSingle()} disabled={websiteSingleViewState.status === "loading"}>
        {websiteSingleViewState.status === "loading" ? "Ingesting..." : "Ingest page"}
      </button>
      {websiteSingleViewState.message ? (
        <p role={websiteSingleViewState.status === "error" ? "alert" : "status"}>{websiteSingleViewState.message}</p>
      ) : null}
      {websiteSingleViewState.result?.stagedArtifact ? (
        <dl className="ui-stack ui-stack--xs">
          <dt>Requested mode</dt>
          <dd>{websiteSingleMode}</dd>
          <dt>Acquisition mechanism</dt>
          <dd>{websiteSingleViewState.result.acquisitionMechanismUsed}</dd>
          <dt>Stored key</dt>
          <dd>{websiteSingleViewState.result.stagedArtifact.storage.key}</dd>
          <dt>Original name</dt>
          <dd>{websiteSingleViewState.result.stagedArtifact.originalName ?? "unknown"}</dd>
        </dl>
      ) : null}

      <label className="ui-stack ui-stack--sm">
        <span>Batch URLs (one URL per line)</span>
        <textarea
          className="ui-input"
          rows={5}
          value={websiteBatchInput}
          onChange={(event) => setWebsiteBatchInput(event.target.value)}
          placeholder={"https://example.com\nhttps://example.com/docs"}
        />
      </label>
      <label className="ui-stack ui-stack--sm">
        <span>Batch mode</span>
        <select
          className="ui-input"
          value={websiteBatchMode}
          onChange={(event) => setWebsiteBatchMode(event.target.value as "automatic" | "rendered")}
        >
          <option value="automatic">automatic</option>
          <option value="rendered">rendered</option>
        </select>
      </label>
      <button className="ui-button artifact-ingestion-mobile-button" type="button" onClick={() => void ingestWebsiteBatch()} disabled={websiteBatchViewState.status === "loading"}>
        {websiteBatchViewState.status === "loading" ? "Ingesting batch..." : "Ingest batch"}
      </button>
      {websiteBatchViewState.message ? (
        <p role={websiteBatchViewState.status === "error" ? "alert" : "status"}>{websiteBatchViewState.message}</p>
      ) : null}
      {websiteBatchViewState.summary ? (
        <dl className="ui-stack ui-stack--xs">
          <dt>Attempted</dt>
          <dd>{websiteBatchViewState.summary.attempted}</dd>
          <dt>Succeeded</dt>
          <dd>{websiteBatchViewState.summary.succeeded}</dd>
          <dt>Failed</dt>
          <dd>{websiteBatchViewState.summary.failed}</dd>
        </dl>
      ) : null}
    </section>
  );
}
