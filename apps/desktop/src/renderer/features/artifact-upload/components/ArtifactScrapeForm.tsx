import type { WebsiteIngestionMode } from "../api/desktopArtifactUploadClient";
import { TermWithHint, TransientNotificationPublisher } from "../../../../../../../modules/ui/shared";
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
  workspaceId?: string;
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
  workspaceId,
}: ArtifactScrapeFormProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <label className="ui-stack ui-stack--sm">
        <span><TermWithHint termId="sourceUrl">Single page URL</TermWithHint></span>
        <input
          className="ui-input"
          value={websiteSingleUrl}
          onChange={(event) => setWebsiteSingleUrl(event.target.value)}
          placeholder="https://example.com/docs"
        />
      </label>
      <label className="ui-stack ui-stack--sm">
        <span><TermWithHint termId="singlePageMode">Single-page mode</TermWithHint></span>
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
      {websiteSingleViewState.status === "loading" && websiteSingleViewState.message ? <p role="status">{websiteSingleViewState.message}</p> : null}
      <TransientNotificationPublisher message={websiteSingleViewState.status === "success" || websiteSingleViewState.status === "error" ? websiteSingleViewState.message : undefined} title={websiteSingleViewState.status === "error" ? "Website ingestion needs attention" : "Website ingested"} tone={websiteSingleViewState.status === "error" ? "error" : "success"} source="Artifact Ingestion" workspaceId={workspaceId} />
      {websiteSingleViewState.result?.stagedArtifact ? (
        <dl className="ui-grid ui-grid--two">
          <dt><TermWithHint termId="singlePageMode">Requested mode</TermWithHint></dt>
          <dd>{websiteSingleMode}</dd>
          <dt><TermWithHint termId="acquisitionMechanism">Acquisition mechanism</TermWithHint></dt>
          <dd>{websiteSingleViewState.result.acquisitionMechanismUsed}</dd>
          <dt><TermWithHint termId="storedKey">Stored key</TermWithHint></dt>
          <dd>{websiteSingleViewState.result.stagedArtifact.storage.key}</dd>
          <dt><TermWithHint termId="originalName">Original name</TermWithHint></dt>
          <dd>{websiteSingleViewState.result.stagedArtifact.originalName ?? "unknown"}</dd>
        </dl>
      ) : null}

      <label className="ui-stack ui-stack--sm">
        <span><TermWithHint termId="batchUrlList">Batch URLs</TermWithHint> (one URL per line)</span>
        <textarea
          className="ui-input"
          rows={6}
          value={websiteBatchInput}
          onChange={(event) => setWebsiteBatchInput(event.target.value)}
          placeholder={"https://example.com\nhttps://example.com/docs"}
        />
      </label>
      <label className="ui-stack ui-stack--sm">
        <span><TermWithHint termId="batchMode">Batch mode</TermWithHint></span>
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
      {websiteBatchViewState.status === "loading" && websiteBatchViewState.message ? <p role="status">{websiteBatchViewState.message}</p> : null}
      <TransientNotificationPublisher message={websiteBatchViewState.status === "success" || websiteBatchViewState.status === "error" ? websiteBatchViewState.message : undefined} title={websiteBatchViewState.status === "error" ? "Website batch needs attention" : "Website batch ingested"} tone={websiteBatchViewState.status === "error" ? "error" : "success"} source="Artifact Ingestion" workspaceId={workspaceId} />
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
