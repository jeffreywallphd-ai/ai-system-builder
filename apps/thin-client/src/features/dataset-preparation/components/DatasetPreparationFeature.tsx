import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ApiDatasetPreparationCommand,
  ApiPreparedTrainingDatasetResult,
} from "../../../../../../modules/contracts/api";
import {
  createDefaultDatasetPreparationTaskRecipe,
  evaluateDatasetPreparationSourceReadiness,
  type DatasetQualityPreset,
  type DatasetQualityReport,
} from "../../../../../../modules/contracts/runtime";
import {
  TransientNotificationPublisher,
  DatasetVersionPanel,
  WorkflowSequence,
  WorkflowStep,
} from "../../../../../../modules/ui/shared";
import {
  createApiArtifactBrowserClient,
  type ArtifactBrowserApiClient,
  type ThinClientArtifactBrowseItem,
} from "../../artifact-browser/api/apiArtifactBrowserClient";
import {
  createApiDatasetPreparationClient,
  type ApiDatasetPreparationClient,
} from "../api/apiDatasetPreparationClient";

export interface DatasetPreparationFeatureProps {
  workspaceId: string;
  artifactClient?: ArtifactBrowserApiClient;
  preparationClient?: ApiDatasetPreparationClient;
}

type Status =
  | { kind: "idle"; message?: string }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

const waitForNextPoll = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 750));

const QUALITY_REASON_LABELS: Record<string, string> = {
  "mapping-required-fields-missing": "Required columns were not found",
  "schema-invalid": "Required values were missing or invalid",
  "exact-duplicate": "Exact duplicates",
  "fuzzy-duplicate": "Very similar examples",
  "text-too-short": "Text was too short",
  "text-too-long": "Text was too long",
  "language-not-allowed": "Language was not allowed",
  "language-uncertain": "Language could not be confirmed",
  "sensitive-personal-data": "Possible personal data",
  "secret-like-content": "Possible passwords or credentials",
  "unsafe-content": "Content marked unsafe",
  "benchmark-excluded": "Excluded benchmark content",
  "source-not-allowed": "Source was not allowed",
  "license-metadata-missing": "Missing license information",
  "consent-metadata-missing": "Missing consent information",
  "source-row-limit": "Source row limit reached",
};

function qualityStatusLabel(status: DatasetQualityReport["status"]): string {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  return "Needs attention";
}

function supportedSource(item: ThinClientArtifactBrowseItem): boolean {
  const readiness = evaluateDatasetPreparationSourceReadiness({
    fileName: item.originalName ?? item.storageKey,
    mediaType: item.mediaType,
    taskType: "llm-instruction",
  });
  return readiness.ready && readiness.capability?.kind === "structured";
}

function buildCommand(
  sourceArtifactIds: string[],
  split: { trainRatio: number; validationRatio: number; testRatio: number },
  outputFormat: "parquet" | "jsonl",
  quality: {
    preset: DatasetQualityPreset;
    requireLicenseMetadata: boolean;
    requireConsentMetadata: boolean;
  },
): ApiDatasetPreparationCommand {
  return {
    sourceArtifactIds,
    recipe: {
      task: {
        ...createDefaultDatasetPreparationTaskRecipe("llm-instruction"),
        textInputMode: "provided",
      },
      normalization: {
        targetFormat: "markdown",
        normalizationMode: "best-effort",
        unsupportedDocumentPolicy: "fail",
      },
      chunking: {
        strategy: "character",
        chunkSize: 1000,
        chunkOverlap: 200,
        preserveDocumentBoundaries: true,
      },
      generation: {
        mode: "qa",
        model: {
          provider: "transformers",
          modelId: "Qwen/Qwen2.5-7B-Instruct",
          inferenceMode: "chat",
          device: "auto",
          torchDtype: "auto",
        },
        failurePolicy: "skip",
      },
    },
    split: {
      ...split,
      shuffle: true,
    },
    output: {
      format: outputFormat,
      destinations: { local: { enabled: true } },
    },
    quality: {
      policy: {
        preset: quality.preset,
        allowedLanguages: ["en"],
        requireLicenseMetadata: quality.requireLicenseMetadata,
        requireConsentMetadata: quality.requireConsentMetadata,
      },
      reviewRequired: true,
    },
  };
}

export function DatasetPreparationFeature({
  workspaceId,
  artifactClient,
  preparationClient,
}: DatasetPreparationFeatureProps) {
  const browser = useMemo(
    () => artifactClient ?? createApiArtifactBrowserClient(),
    [artifactClient],
  );
  const preparation = useMemo(
    () => preparationClient ?? createApiDatasetPreparationClient(),
    [preparationClient],
  );
  const versionService = useMemo(() => ({
    list: async (targetWorkspaceId: string, datasetId?: string) => preparation.listVersions ? (await preparation.listVersions({ workspaceId: targetWorkspaceId, datasetId })).versions : [],
    compare: async (targetWorkspaceId: string, fromVersionId: string, toVersionId: string) => { if (!preparation.compareVersions) throw new Error("Dataset version comparison is unavailable."); return (await preparation.compareVersions({ workspaceId: targetWorkspaceId, fromVersionId, toVersionId })).comparison; },
    reproduce: async (targetWorkspaceId: string, versionId: string) => { if (!preparation.readReproduction) throw new Error("Saved dataset setup is unavailable."); return (await preparation.readReproduction({ workspaceId: targetWorkspaceId, versionId })).reproduction; },
    publish: async (input: { workspaceId: string; versionId: string; repositoryId: string; visibility: "private" | "public"; createRepository?: boolean; publicAccessConfirmed?: true }) => { if (!preparation.publishVersion) throw new Error("Dataset publishing is unavailable."); return (await preparation.publishVersion(input)).publication; },
  }), [preparation]);
  const mounted = useRef(true);
  const [artifacts, setArtifacts] = useState<ThinClientArtifactBrowseItem[]>(
    [],
  );
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [activeRequestId, setActiveRequestId] = useState<string>();
  const [result, setResult] = useState<ApiPreparedTrainingDatasetResult>();
  const [qualityReview, setQualityReview] = useState<{
    requestId: string;
    report: DatasetQualityReport;
  }>();
  const [reviewActionInFlight, setReviewActionInFlight] = useState(false);
  const [qualityPreset, setQualityPreset] =
    useState<DatasetQualityPreset>("recommended");
  const [requireLicenseMetadata, setRequireLicenseMetadata] = useState(false);
  const [requireConsentMetadata, setRequireConsentMetadata] = useState(false);
  const [trainRatio, setTrainRatio] = useState("0.8");
  const [validationRatio, setValidationRatio] = useState("0.1");
  const [testRatio, setTestRatio] = useState("0.1");
  const [outputFormat, setOutputFormat] = useState<"parquet" | "jsonl">(
    "parquet",
  );
  const reuseVersionSetup = (reproduction: import("../../../../../../modules/contracts/dataset").DatasetVersionReproduction) => {
    const snapshot = reproduction.recipeSnapshot as any;
    const split = snapshot.split ?? {};
    const output = snapshot.output ?? {};
    const policy = snapshot.effectiveQualityPolicy ?? {};
    setSelectedArtifactIds([...reproduction.sourceArtifactIds]);
    if (typeof split.trainRatio === "number") setTrainRatio(String(split.trainRatio));
    if (typeof split.validationRatio === "number") setValidationRatio(String(split.validationRatio));
    if (typeof split.testRatio === "number") setTestRatio(String(split.testRatio));
    if (["parquet", "jsonl"].includes(output.format)) setOutputFormat(output.format);
    if (["recommended", "strict", "minimal"].includes(policy.preset)) setQualityPreset(policy.preset);
    if (typeof policy.requireLicenseMetadata === "boolean") setRequireLicenseMetadata(policy.requireLicenseMetadata);
    if (typeof policy.requireConsentMetadata === "boolean") setRequireConsentMetadata(policy.requireConsentMetadata);
    setStatus({ kind: "idle" });
  };

  useEffect(() => {
    mounted.current = true;
    void browser
      .browseArtifacts({ workspaceId })
      .then((items) => {
        if (mounted.current) {
          setArtifacts(items.filter(supportedSource));
        }
      })
      .catch(() => {
        if (mounted.current) {
          setStatus({
            kind: "error",
            message: "Source files could not be loaded. Try again.",
          });
        }
      });
    return () => {
      mounted.current = false;
    };
  }, [browser, workspaceId]);

  const poll = async (requestId: string) => {
    while (mounted.current) {
      const task = await preparation.read({ workspaceId, requestId });
      if (!mounted.current) return;
      if (task.status === "queued" || task.status === "running") {
        const progress =
          typeof task.progress?.processed === "number" &&
          typeof task.progress.total === "number"
            ? " (" + task.progress.processed + "/" + task.progress.total + ")"
            : "";
        setStatus({
          kind: "loading",
          message:
            (task.progress?.message ?? "Preparing dataset...") + progress,
        });
        await waitForNextPoll();
        continue;
      }
      setActiveRequestId(undefined);
      if (task.status === "review-required") {
        if (!task.result.qualityReport || !task.result.review) {
          setStatus({
            kind: "error",
            message:
              "Check results could not be verified. Run preparation again.",
          });
          return;
        }
        setQualityReview({
          requestId,
          report: task.result.qualityReport,
        });
        setStatus({ kind: "idle" });
        return;
      }
      if (task.status === "succeeded") {
        setResult(task.result);
        setStatus({ kind: "success", message: "Training dataset is ready." });
        return;
      }
      if (task.status === "cancelled") {
        setStatus({ kind: "idle", message: "Dataset preparation stopped." });
        return;
      }
      setStatus({
        kind: "error",
        message:
          task.status === "failed"
            ? task.error.message
            : "Dataset preparation could not be found. Start it again.",
      });
      return;
    }
  };

  const start = async () => {
    const parsed = [trainRatio, validationRatio, testRatio].map(Number);
    if (
      parsed.some((value) => !Number.isFinite(value) || value < 0) ||
      Math.abs(parsed[0] + parsed[1] + parsed[2] - 1) > 0.000001
    ) {
      setStatus({
        kind: "error",
        message: "Training, validation, and test shares must add up to 1.",
      });
      return;
    }
    setResult(undefined);
    setQualityReview(undefined);
    setStatus({ kind: "loading", message: "Starting dataset preparation..." });
    try {
      const started = await preparation.start({
        workspaceId,
        command: buildCommand(
          selectedArtifactIds,
          {
            trainRatio: parsed[0],
            validationRatio: parsed[1],
            testRatio: parsed[2],
          },
          outputFormat,
          {
            preset: qualityPreset,
            requireLicenseMetadata,
            requireConsentMetadata,
          },
        ),
      });
      setActiveRequestId(started.requestId);
      await poll(started.requestId);
    } catch (error) {
      if (mounted.current) {
        setActiveRequestId(undefined);
        setStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Dataset preparation could not be started.",
        });
      }
    }
  };

  const cancel = async () => {
    if (!activeRequestId) return;
    try {
      await preparation.cancel({ workspaceId, requestId: activeRequestId });
      setActiveRequestId(undefined);
      setStatus({ kind: "idle", message: "Dataset preparation stopped." });
    } catch {
      setStatus({
        kind: "error",
        message: "Dataset preparation could not be stopped. Try again.",
      });
    }
  };

  const approveReview = async () => {
    if (!qualityReview || reviewActionInFlight) return;
    setReviewActionInFlight(true);
    try {
      const approved = await preparation.approve({
        workspaceId,
        requestId: qualityReview.requestId,
        reportFingerprint: qualityReview.report.reportFingerprint,
      });
      setResult(approved.result);
      setQualityReview(undefined);
      setStatus({ kind: "success", message: "Training dataset is ready." });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The reviewed dataset could not be saved.",
      });
    } finally {
      setReviewActionInFlight(false);
    }
  };

  const discardReview = async () => {
    if (!qualityReview || reviewActionInFlight) return;
    setReviewActionInFlight(true);
    try {
      await preparation.cancel({
        workspaceId,
        requestId: qualityReview.requestId,
      });
      setQualityReview(undefined);
      setStatus({ kind: "idle" });
    } catch {
      setStatus({
        kind: "error",
        message: "The review could not be discarded. Try again.",
      });
    } finally {
      setReviewActionInFlight(false);
    }
  };

  const toggleArtifact = (artifactId: string) => {
    setSelectedArtifactIds((current) =>
      current.includes(artifactId)
        ? current.filter((candidate) => candidate !== artifactId)
        : [...current, artifactId],
    );
  };

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
        <WorkflowSequence ariaLabel="Dataset preparation workflow">
          <WorkflowStep
            title="Add data"
            description="Choose table-based source files that already contain the examples you want to train with."
          >
            {artifacts.length === 0 ? (
              <p className="ui-text-muted">
                Add a CSV, JSON, JSON Lines, or Parquet file in Artifact
                Ingestion first.
              </p>
            ) : (
              <div className="ui-stack ui-stack--sm">
                {artifacts.map((artifact) => (
                  <label key={artifact.artifactId}>
                    <input
                      type="checkbox"
                      checked={selectedArtifactIds.includes(
                        artifact.artifactId,
                      )}
                      disabled={status.kind === "loading"}
                      onChange={() => toggleArtifact(artifact.artifactId)}
                    />{" "}
                    {artifact.originalName ?? artifact.storageKey}
                  </label>
                ))}
              </div>
            )}
          </WorkflowStep>
          <WorkflowStep
            title="Check data"
            description="Confirm that the selected files are ready for this preparation path."
          >
            <strong>
              {selectedArtifactIds.length > 0
                ? "Ready to prepare"
                : "Choose at least one source file"}
            </strong>
            <p className="ui-text-muted">
              {selectedArtifactIds.length > 0
                ? String(selectedArtifactIds.length) +
                  " supported source file" +
                  (selectedArtifactIds.length === 1 ? " is" : "s are") +
                  " selected."
                : "Only supported table files are shown here."}
            </p>
            <label className="ui-stack ui-stack--sm">
              <span>Data checks</span>
              <select
                className="ui-input"
                value={qualityPreset}
                disabled={status.kind === "loading"}
                onChange={(event) =>
                  setQualityPreset(event.target.value as DatasetQualityPreset)
                }
              >
                <option value="recommended">Recommended</option>
                <option value="strict">Strict</option>
              </select>
              <small className="ui-text-muted">
                {qualityPreset === "strict"
                  ? "Applies tighter checks before any dataset is saved."
                  : "Checks structure, duplicates, personal data, credentials, and split safety."}
              </small>
            </label>
            <details>
              <summary>Advanced data rules</summary>
              <div className="ui-stack ui-stack--sm">
                <label>
                  <input
                    type="checkbox"
                    checked={requireLicenseMetadata}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setRequireLicenseMetadata(event.target.checked)
                    }
                  />{" "}
                  Require license information for every row
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={requireConsentMetadata}
                    disabled={status.kind === "loading"}
                    onChange={(event) =>
                      setRequireConsentMetadata(event.target.checked)
                    }
                  />{" "}
                  Require consent information for every row
                </label>
              </div>
            </details>
          </WorkflowStep>
          <WorkflowStep
            title="Prepare dataset"
            description="The recommended setup keeps related and duplicate rows together while creating separate training, validation, and test files."
          >
            <p className="ui-text-muted">
              Recommended: use the text already in your files and split rows
              80/10/10.
            </p>
            <details>
              <summary>Advanced settings</summary>
              <div className="ui-grid ui-grid--two">
                <label>
                  Training share
                  <input
                    className="ui-input"
                    value={trainRatio}
                    onChange={(event) => setTrainRatio(event.target.value)}
                  />
                </label>
                <label>
                  Validation share
                  <input
                    className="ui-input"
                    value={validationRatio}
                    onChange={(event) => setValidationRatio(event.target.value)}
                  />
                </label>
                <label>
                  Test share
                  <input
                    className="ui-input"
                    value={testRatio}
                    onChange={(event) => setTestRatio(event.target.value)}
                  />
                </label>
                <label>
                  Saved file format
                  <select
                    className="ui-input"
                    value={outputFormat}
                    onChange={(event) =>
                      setOutputFormat(event.target.value as "parquet" | "jsonl")
                    }
                  >
                    <option value="parquet">Parquet</option>
                    <option value="jsonl">JSON Lines</option>
                  </select>
                </label>
              </div>
            </details>
          </WorkflowStep>
          <WorkflowStep
            title="Review and create"
            description="Create a local instruction-tuning dataset from the selected files."
          >
            {qualityReview ? (
              <section
                className="ui-stack ui-stack--sm"
                aria-labelledby="thin-dataset-quality-review-title"
              >
                <h3 id="thin-dataset-quality-review-title">Check results</h3>
                <strong role="status">
                  {qualityStatusLabel(qualityReview.report.status)}
                </strong>
                <dl className="ui-grid ui-grid--two">
                  <dt>Rows checked</dt>
                  <dd>{qualityReview.report.counts.inputRows}</dd>
                  <dt>Rows ready</dt>
                  <dd>{qualityReview.report.counts.acceptedRows}</dd>
                  <dt>Rows set aside</dt>
                  <dd>{qualityReview.report.counts.quarantinedRows}</dd>
                </dl>
                {Object.keys(qualityReview.report.reasonCounts).length > 0 ? (
                  <ul>
                    {Object.entries(qualityReview.report.reasonCounts).map(
                      ([reason, count]) => (
                        <li key={reason}>
                          {QUALITY_REASON_LABELS[reason] ?? "Other data issue"}:{" "}
                          {count}
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p className="ui-text-muted">
                    No rows were set aside by the selected checks.
                  </p>
                )}
                {qualityReview.report.samples.length > 0 ? (
                  <details>
                    <summary>Advanced details</summary>
                    <p className="ui-text-muted">
                      These short examples are limited and cleaned to avoid
                      showing source values.
                    </p>
                    <ul>
                      {qualityReview.report.samples.map((sample) => (
                        <li
                          key={`${sample.sourceArtifactId}:${sample.sourceRowIndex}:${sample.reasonCodes.join(",")}`}
                        >
                          {sample.summary}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <button
                  className="ui-button"
                  type="button"
                  disabled={
                    reviewActionInFlight ||
                    !qualityReview.report.approvalAllowed
                  }
                  onClick={() => void approveReview()}
                >
                  {reviewActionInFlight
                    ? "Saving..."
                    : "Approve and save dataset"}
                </button>
                <button
                  className="ui-button"
                  type="button"
                  disabled={reviewActionInFlight}
                  onClick={() => void discardReview()}
                >
                  Discard review
                </button>
                {!qualityReview.report.approvalAllowed ? (
                  <p role="alert">
                    This dataset cannot be saved. Adjust the source data or
                    rules, then run the checks again.
                  </p>
                ) : null}
              </section>
            ) : null}
            <button
              className="ui-button"
              type="button"
              disabled={
                selectedArtifactIds.length === 0 ||
                status.kind === "loading" ||
                qualityReview !== undefined
              }
              onClick={() => void start()}
            >
              {status.kind === "loading"
                ? "Preparing..."
                : "Run checks and prepare"}
            </button>
            {activeRequestId ? (
              <button
                className="ui-button"
                type="button"
                onClick={() => void cancel()}
              >
                Stop preparation
              </button>
            ) : null}
          </WorkflowStep>
        </WorkflowSequence>

        {status.message && status.kind !== "success" ? (
          <p role={status.kind === "error" ? "alert" : "status"}>
            {status.message}
          </p>
        ) : null}
        <TransientNotificationPublisher
          message={status.kind === "success" ? status.message : undefined}
          title="Dataset preparation"
          tone="success"
          source="Dataset Preparation"
          workspaceId={workspaceId}
        />
        {result ? (
          <div className="ui-stack ui-stack--sm">
            <h3>Dataset ready</h3>
            <dl className="ui-grid ui-grid--two">
              <dt>Total rows</dt>
              <dd>{result.summary.datasetRowCount}</dd>
              <dt>Training rows</dt>
              <dd>{result.summary.trainRowCount}</dd>
              <dt>Validation rows</dt>
              <dd>{result.summary.validationRowCount ?? 0}</dd>
              <dt>Test rows</dt>
              <dd>{result.summary.testRowCount}</dd>
              <dt>Saved as</dt>
              <dd>
                {result.outputs.local?.dataset?.storage.key ??
                  "External destination"}
              </dd>
            </dl>
            {result.warnings?.length ? (
              <>
                <h4>Needs attention</h4>
                <ul>
                  {result.warnings.map((warning) => (
                    <li key={warning.code + warning.message}>
                      {warning.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
        {preparation.listVersions ? (
          <DatasetVersionPanel
            workspaceId={workspaceId}
            currentVersionId={result?.datasetVersion?.versionId}
            datasetId={result?.datasetVersion?.datasetId}
            service={versionService}
            onReuse={reuseVersionSetup}
          />
        ) : null}
      </div>
    </section>
  );
}
