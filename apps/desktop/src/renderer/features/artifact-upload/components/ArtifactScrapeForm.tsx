import type { WebsiteIngestionMode } from "../api/desktopArtifactUploadClient";
import type {
  DesktopWebsitePageIngestionResult,
  DesktopWebsitePagesBatchSummary,
} from "../../../lib/desktopApi";

interface WebsiteSingleViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  result?: DesktopWebsitePageIngestionResult;
}

interface WebsiteBatchViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  summary?: DesktopWebsitePagesBatchSummary;
}

export interface ArtifactScrapeFormProps {
  websiteSingleUrl: string;
  websiteSingleMode: WebsiteIngestionMode;
  websiteBatchInput: string;
  websiteBatchMode: WebsiteIngestionMode;
  websiteSingleViewState: WebsiteSingleViewState;
  websiteBatchViewState: WebsiteBatchViewState;
  setWebsiteSingleUrl: (value: string) => void;
  setWebsiteSingleMode: (mode: WebsiteIngestionMode) => void;
  setWebsiteBatchInput: (value: string) => void;
  setWebsiteBatchMode: (mode: WebsiteIngestionMode) => void;
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
          onChange={(event) => setWebsiteSingleMode(event.target.value as WebsiteIngestionMode)}
        >
          <option value="automatic">automatic</option>
          <option value="rendered">rendered</option>
        </select>
      </label>
      <button className="ui-button" type="button" onClick={() => void ingestWebsiteSingle()} disabled={websiteSingleViewState.status === "loading"}>
        {websiteSingleViewState.status === "loading" ? "Ingesting..." : "Ingest page"}
      </button>
      {websiteSingleViewState.message ? (
        <p role={websiteSingleViewState.status === "error" ? "alert" : "status"}>{websiteSingleViewState.message}</p>
      ) : null}
      {websiteSingleViewState.result?.stagedArtifact ? (
        <dl className="ui-grid ui-grid--two">
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
          rows={6}
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
          onChange={(event) => setWebsiteBatchMode(event.target.value as WebsiteIngestionMode)}
        >
          <option value="automatic">automatic</option>
          <option value="rendered">rendered</option>
        </select>
      </label>
      <button className="ui-button" type="button" onClick={() => void ingestWebsiteBatch()} disabled={websiteBatchViewState.status === "loading"}>
        {websiteBatchViewState.status === "loading" ? "Ingesting batch..." : "Ingest batch"}
      </button>
      {websiteBatchViewState.message ? (
        <p role={websiteBatchViewState.status === "error" ? "alert" : "status"}>{websiteBatchViewState.message}</p>
      ) : null}
      {websiteBatchViewState.summary ? (
        <dl className="ui-grid ui-grid--two">
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
