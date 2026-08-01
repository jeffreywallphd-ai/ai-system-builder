import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import {
  deriveArtifactBackingState,
  deriveArtifactListStatusLabels,
  derivePublishedBackingDisplayRows,
  derivePublishedBackingVerificationPresentation,
  ApplicationIcon,
  ArtifactPreviewPanel,
  createLoadingArtifactPreview,
  createParquetArtifactPreview,
  createUnavailableArtifactPreview,
  describeArtifactPreview,
  PanelHeading,
  TermWithHint,
  TransientNotificationPublisher,
  TypeBadge,
  type ArtifactPreviewView,
  type PublishedBackingView,
} from "../../../../../../modules/ui/shared";
import type { ArtifactBrowserApiClient } from "../api/apiArtifactBrowserClient";
import { useArtifactBrowserFeature } from "../hooks/useArtifactBrowserFeature";
import { ModalDialog } from "../../../../../../modules/ui/shared/components/ModalDialog";
import type { ContextConversionReadiness } from "../../../../../../modules/contracts/context-management";

export interface ArtifactBrowserFeatureProps {
  client?: ArtifactBrowserApiClient;
  workspaceId?: string;
  workspaceName?: string;
  readParquetPreview?: (input: {
    workspaceId: string;
    artifactKey: string;
  }) => Promise<{
    totalRows: number;
    rows: readonly { values: Readonly<Record<string, unknown>> }[];
  }>;
  initialSelectedStorageKey?: string;
  onInitialSelectionHandled?: () => void;
  readContextConversionReadiness?: (
    artifactId: string,
  ) => Promise<ContextConversionReadiness>;
  onConvertToRag?: (artifactId: string) => void;
}

function PublishedBackingPanel(props: {
  publishedBacking: PublishedBackingView;
  loading: boolean;
  onRecheck: () => void;
}) {
  const verification = derivePublishedBackingVerificationPresentation(
    props.publishedBacking,
  );
  const rows = derivePublishedBackingDisplayRows(props.publishedBacking);

  return (
    <section className="ui-stack ui-stack--sm">
      <h3>Published Backing</h3>
      <dl className="ui-grid ui-grid--two">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </Fragment>
        ))}
        <dt>
          <TermWithHint termId="verification">Verification</TermWithHint>
        </dt>
        <dd>{verification.statusLabel}</dd>
        <dt>Checked</dt>
        <dd>{verification.lastCheckedLabel}</dd>
      </dl>
      <button
        className="ui-button"
        type="button"
        onClick={props.onRecheck}
        disabled={props.loading}
      >
        Re-check published backing
      </button>
    </section>
  );
}

export function ArtifactBrowserFeature({
  client,
  workspaceId,
  readParquetPreview,
  initialSelectedStorageKey,
  onInitialSelectionHandled,
  readContextConversionReadiness,
  onConvertToRag,
}: ArtifactBrowserFeatureProps) {
  const [parquetPreview, setParquetPreview] = useState<ArtifactPreviewView>();
  const [contextConversion, setContextConversion] = useState<{
    status: "idle" | "loading" | "ready" | "blocked";
    readiness?: ContextConversionReadiness;
  }>({ status: "idle" });
  const previewRequestId = useRef(0);
  const initialSelectionHandledRef = useRef<string | undefined>(undefined);
  const {
    items,
    selectedStorageKey,
    pendingDeleteStorageKey,
    deleteConfirmationInput,
    selectedArtifactKeys,
    bulkDeleteConfirmationInput,
    detail,
    content,
    artifactPreview,
    canSelectPreviousImage,
    canSelectNextImage,
    publishState,
    registerState,
    localizeState,
    sourceVerifyState,
    publishedBacking,
    localizedArtifact,
    registerForm,
    viewState,
    selectArtifact,
    refreshArtifacts,
    selectPreviousImage,
    selectNextImage,
    requestDeleteRegisteredArtifact,
    confirmPendingDelete,
    cancelPendingDelete,
    setDeleteConfirmationInput,
    toggleSelectedArtifactKey,
    clearSelectedArtifactKeys,
    toggleAllArtifactKeys,
    areAllArtifactKeysSelected,
    setBulkDeleteConfirmationInput,
    deleteSelectedArtifacts,
    registerArtifactFromHuggingFace,
    registerHuggingFaceNamespace,
    browseHuggingFaceDatasetParquetFiles,
    closeHuggingFaceDatasetParquetFiles,
    huggingFaceNamespaceDatasets,
    getHuggingFaceDatasetParquetFiles,
    getHuggingFaceDatasetFilesState,
    expandedHuggingFaceDataset,
    localizeArtifactFromRepo,
    recheckPublishedBacking,
    recheckSourceBacking,
    setRegisterRepository,
    setRegisterNamespace,
    setRegisterPathInRepo,
    setRegisterRevision,
    setRegisterMediaType,
    toggleRegisterForm,
  } = useArtifactBrowserFeature(client, workspaceId);
  const transientViewState = Boolean(
    viewState.message &&
    (/^Deleted\b/.test(viewState.message) ||
      (viewState.status === "error" &&
        !/^(Failed to load|Unable to load|Select a workspace|Type Delete)/i.test(
          viewState.message,
        ))),
  );

  const backingState = deriveArtifactBackingState(detail, content);

  const selectArtifactWithPreview = useCallback(
    async (item: (typeof items)[number]) => {
      const requestId = ++previewRequestId.current;
      const source = {
        storageKey: item.storageKey,
        originalName: item.originalName,
        mediaType: item.mediaType,
        artifactFamily: item.artifactFamily,
      };
      const isParquet = describeArtifactPreview(source).kind === "parquet";
      setParquetPreview(
        isParquet ? createLoadingArtifactPreview(source) : undefined,
      );
      await selectArtifact(item.storageKey);
      if (requestId !== previewRequestId.current || !isParquet) return;
      if (!workspaceId || !readParquetPreview) {
        setParquetPreview(
          createUnavailableArtifactPreview(
            source,
            "Parquet preview is unavailable in this session.",
          ),
        );
        return;
      }
      try {
        const page = await readParquetPreview({
          workspaceId,
          artifactKey: item.storageKey,
        });
        if (requestId !== previewRequestId.current) return;
        setParquetPreview(
          createParquetArtifactPreview(
            source,
            page.rows.map((row) => row.values),
            page.totalRows,
          ),
        );
      } catch {
        if (requestId !== previewRequestId.current) return;
        setParquetPreview(
          createUnavailableArtifactPreview(
            source,
            "The first rows of this Parquet file could not be read.",
          ),
        );
      }
    },
    [readParquetPreview, selectArtifact, workspaceId],
  );

  useEffect(() => {
    if (!initialSelectedStorageKey) {
      initialSelectionHandledRef.current = undefined;
      return;
    }
    if (initialSelectionHandledRef.current === initialSelectedStorageKey) {
      return;
    }
    const item = items.find(
      (candidate) => candidate.storageKey === initialSelectedStorageKey,
    );
    if (!item) return;
    initialSelectionHandledRef.current = initialSelectedStorageKey;
    void selectArtifactWithPreview(item).finally(() => {
      onInitialSelectionHandled?.();
    });
  }, [
    initialSelectedStorageKey,
    items,
    onInitialSelectionHandled,
    selectArtifactWithPreview,
  ]);

  useEffect(() => {
    if (!detail || !readContextConversionReadiness) {
      setContextConversion({ status: "idle" });
      return;
    }
    let current = true;
    setContextConversion({ status: "loading" });
    void readContextConversionReadiness(detail.locator.storageKey)
      .then((next) => {
        if (current) {
          setContextConversion({
            status: next.ready ? "ready" : "blocked",
            readiness: next,
          });
        }
      })
      .catch(() => {
        if (current) {
          setContextConversion({
            status: "blocked",
            readiness: {
              artifactId: detail.locator.storageKey,
              ready: false,
              locallyReadable: false,
              textFields: [],
              alreadyChunked: false,
              message: "Conversion readiness could not be checked.",
              action: "Refresh the artifact and try again.",
            },
          });
        }
      });
    return () => {
      current = false;
    };
  }, [detail, readContextConversionReadiness]);

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="browse" tone="violet">
          Artifact Browser
        </PanelHeading>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
        <div className="artifact-browser__toolbar">
          <button
            className="ui-button"
            type="button"
            onClick={() => void refreshArtifacts()}
          >
            <ApplicationIcon name="refresh" />
            <span className="ui-button__label">Refresh</span>
          </button>
        </div>
        {viewState.message && !transientViewState ? (
          <p role={viewState.status === "error" ? "alert" : "status"}>
            {viewState.message}
          </p>
        ) : null}
        <TransientNotificationPublisher
          message={transientViewState ? viewState.message : undefined}
          title={
            viewState.status === "error"
              ? "Artifact action needs attention"
              : "Artifacts updated"
          }
          tone={viewState.status === "error" ? "error" : "success"}
          source="Artifact Browser"
          workspaceId={workspaceId}
        />
        <ModalDialog
          open={Boolean(pendingDeleteStorageKey)}
          title="Delete artifact"
          closeLabel="Close delete confirmation"
          onClose={cancelPendingDelete}
        >
          <p>
            Type <strong>Delete</strong> to remove this artifact and local
            backing data.
          </p>
          <p className="ui-text-muted">Artifact: {pendingDeleteStorageKey}</p>
          <label className="ui-stack ui-stack--sm">
            <span>
              <TermWithHint termId="deleteConfirmation">
                Confirmation
              </TermWithHint>
            </span>
            <input
              className="ui-input"
              value={deleteConfirmationInput}
              onChange={(event) =>
                setDeleteConfirmationInput(event.target.value)
              }
              placeholder="Delete"
            />
          </label>
          <div className="ui-grid ui-grid--two">
            <button
              className="ui-button ui-button--destructive"
              type="button"
              onClick={() => void confirmPendingDelete()}
              disabled={deleteConfirmationInput !== "Delete"}
            >
              Confirm delete
            </button>
            <button
              className="ui-button"
              type="button"
              onClick={cancelPendingDelete}
            >
              Cancel
            </button>
          </div>
        </ModalDialog>

        <button
          className="ui-button"
          type="button"
          onClick={toggleRegisterForm}
          disabled={registerState.status === "loading"}
        >
          Register from Hugging Face
        </button>
        {registerForm.showRegisterForm ? (
          <section className="ui-stack ui-stack--sm">
            <p role="note">
              Private or gated Hugging Face repositories may require a
              host/server token.
            </p>
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="namespace">Namespace</TermWithHint>{" "}
                (user/org)
              </span>
              <input
                className="ui-input"
                value={registerForm.namespace}
                onChange={(event) => setRegisterNamespace(event.target.value)}
                placeholder="OpenFinAL"
                required
              />
            </label>
            <button
              className="ui-button"
              type="button"
              disabled={
                registerState.status === "loading" ||
                registerForm.namespace.trim().length === 0
              }
              onClick={() => void registerHuggingFaceNamespace()}
            >
              Register namespace
            </button>
            <h4>Namespace datasets</h4>
            {huggingFaceNamespaceDatasets.length === 0 ? (
              <p className="ui-text-muted">No datasets loaded yet.</p>
            ) : (
              <ul className="ui-stack ui-stack--sm">
                {huggingFaceNamespaceDatasets.map((dataset) => (
                  <li
                    key={dataset.repository}
                    className="ui-panel ui-stack ui-stack--sm"
                  >
                    <header className="ui-grid ui-grid--two">
                      <strong>{dataset.repository}</strong>
                      <button
                        className="ui-button"
                        type="button"
                        disabled={registerState.status === "loading"}
                        onClick={() =>
                          void browseHuggingFaceDatasetParquetFiles(
                            dataset.repository,
                          )
                        }
                      >
                        View Files
                      </button>
                    </header>
                    {expandedHuggingFaceDataset === dataset.repository ? (
                      <section className="ui-stack ui-stack--sm">
                        <div className="ui-grid ui-grid--two">
                          <h5>Dataset files</h5>
                          <button
                            className="ui-button"
                            type="button"
                            onClick={closeHuggingFaceDatasetParquetFiles}
                          >
                            Close
                          </button>
                        </div>
                        {getHuggingFaceDatasetFilesState(dataset.repository)
                          .status === "loading" ? (
                          <p role="status">Loading dataset files...</p>
                        ) : null}
                        {getHuggingFaceDatasetFilesState(dataset.repository)
                          .status === "error" ? (
                          <p role="alert">
                            {getHuggingFaceDatasetFilesState(dataset.repository)
                              .message ?? "Failed to load dataset files."}
                          </p>
                        ) : null}
                        {getHuggingFaceDatasetParquetFiles(dataset.repository)
                          .length === 0 &&
                        getHuggingFaceDatasetFilesState(dataset.repository)
                          .status !== "loading" &&
                        getHuggingFaceDatasetFilesState(dataset.repository)
                          .status !== "error" ? (
                          <p className="ui-text-muted">
                            No files found for this dataset.
                          </p>
                        ) : null}
                        {getHuggingFaceDatasetParquetFiles(dataset.repository)
                          .length > 0 ? (
                          <ul className="ui-stack ui-stack--sm">
                            {getHuggingFaceDatasetParquetFiles(
                              dataset.repository,
                            ).map((file) => (
                              <li key={`${file.repository}:${file.path}`}>
                                <span>{file.path}</span>
                                <button
                                  className="ui-button"
                                  type="button"
                                  disabled={registerState.status === "loading"}
                                  onClick={() => {
                                    void registerArtifactFromHuggingFace({
                                      repository: file.repository,
                                      pathInRepo: file.path,
                                      revision: file.revision,
                                    });
                                  }}
                                >
                                  Register
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </section>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="repository">Repository</TermWithHint>
              </span>
              <input
                className="ui-input"
                value={registerForm.repository}
                onChange={(event) => setRegisterRepository(event.target.value)}
                required
              />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="pathInRepository">
                  Path in repo
                </TermWithHint>
              </span>
              <input
                className="ui-input"
                value={registerForm.pathInRepo}
                onChange={(event) => setRegisterPathInRepo(event.target.value)}
                required
              />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="revision">Revision</TermWithHint>{" "}
                (optional)
              </span>
              <input
                className="ui-input"
                value={registerForm.revision}
                onChange={(event) => setRegisterRevision(event.target.value)}
              />
            </label>
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="mediaType">Media type</TermWithHint>{" "}
                (optional)
              </span>
              <input
                className="ui-input"
                value={registerForm.mediaType}
                onChange={(event) => setRegisterMediaType(event.target.value)}
              />
            </label>
            <button
              className="ui-button"
              type="button"
              disabled={
                registerState.status === "loading" ||
                registerForm.repository.trim().length === 0 ||
                registerForm.pathInRepo.trim().length === 0
              }
              onClick={() => void registerArtifactFromHuggingFace()}
            >
              {registerState.status === "loading"
                ? "Registering..."
                : "Register"}
            </button>
            <TransientNotificationPublisher
              message={
                registerState.status !== "loading"
                  ? registerState.message
                  : undefined
              }
              title={
                registerState.status === "error"
                  ? "Artifact registration needs attention"
                  : "Artifact registered"
              }
              tone={registerState.status === "error" ? "error" : "success"}
              source="Artifact Browser"
              workspaceId={workspaceId}
            />
          </section>
        ) : null}

        <ul className="ui-stack ui-stack--sm">
          <li className="ui-stack ui-stack--sm">
            <label>
              <input
                type="checkbox"
                checked={areAllArtifactKeysSelected}
                onChange={toggleAllArtifactKeys}
                disabled={items.length === 0}
              />
              {areAllArtifactKeysSelected
                ? " Deselect all artifacts"
                : " Select all artifacts"}
            </label>
          </li>
          <li className="ui-grid ui-grid--two">
            <label className="ui-stack ui-stack--sm">
              <span>
                <TermWithHint termId="deleteConfirmation">
                  Bulk delete confirmation
                </TermWithHint>
              </span>
              <input
                className="ui-input"
                value={bulkDeleteConfirmationInput}
                onChange={(event) =>
                  setBulkDeleteConfirmationInput(event.target.value)
                }
                placeholder="Delete All"
              />
            </label>
            <div className="ui-stack ui-stack--sm">
              <button
                className="ui-button ui-button--destructive"
                type="button"
                onClick={() => void deleteSelectedArtifacts()}
                disabled={
                  selectedArtifactKeys.length === 0 ||
                  bulkDeleteConfirmationInput !== "Delete All"
                }
              >
                Delete Selected ({selectedArtifactKeys.length})
              </button>
              <button
                className="ui-button"
                type="button"
                onClick={clearSelectedArtifactKeys}
                disabled={selectedArtifactKeys.length === 0}
              >
                Clear selection
              </button>
            </div>
          </li>
          {items.map((item) => (
            <li key={item.storageKey}>
              <div className="ui-type-row">
                <input
                  type="checkbox"
                  checked={selectedArtifactKeys.includes(item.storageKey)}
                  onChange={() => toggleSelectedArtifactKey(item.storageKey)}
                />
                <TypeBadge
                  value={item.mediaType ?? item.originalName ?? item.storageKey}
                />
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => void selectArtifactWithPreview(item)}
                  disabled={
                    viewState.status === "loading" &&
                    selectedStorageKey === item.storageKey
                  }
                >
                  <ApplicationIcon name="browse" />
                  <span className="ui-button__label">
                    {item.originalName ?? item.storageKey}
                  </span>
                </button>
              </div>
              {item.metadata?.backingState ? (
                <small>
                  {deriveArtifactListStatusLabels(
                    item.metadata.backingState,
                  ).join(" - ")}
                </small>
              ) : null}
            </li>
          ))}
        </ul>

        {detail ? (
          <dl className="ui-grid ui-grid--two">
            <dt>
              <TermWithHint termId="storedKey">Selected key</TermWithHint>
            </dt>
            <dd>{detail.locator.storageKey}</dd>
            <dt>
              <TermWithHint termId="mediaType">Media type</TermWithHint>
            </dt>
            <dd className="ui-type-label">
              <TypeBadge
                value={
                  detail.mediaType ??
                  detail.originalName ??
                  detail.locator.storageKey
                }
              />
              <span>{detail.mediaType ?? "unknown"}</span>
            </dd>
            <dt>
              <TermWithHint termId="artifactFamily">
                Artifact family
              </TermWithHint>
            </dt>
            <dd>{detail.artifactFamily}</dd>
            <dt>
              <TermWithHint termId="source">Source</TermWithHint>
            </dt>
            <dd>{detail.sourceKind ?? "unknown"}</dd>
            <dt>
              <TermWithHint termId="storedSize">Size bytes</TermWithHint>
            </dt>
            <dd>{detail.sizeBytes ?? "unknown"}</dd>
            <dt>
              <TermWithHint termId="createdAt">Created at</TermWithHint>
            </dt>
            <dd>{detail.createdAt ?? "unknown"}</dd>
          </dl>
        ) : (
          <p className="ui-text-muted">
            Select a data artifact to inspect metadata and preview availability.
          </p>
        )}

        {content ? (
          <dl className="ui-grid ui-grid--two">
            <dt>
              <TermWithHint termId="availability">Availability</TermWithHint>
            </dt>
            <dd>{content.availability}</dd>
            <dt>
              <TermWithHint termId="retrieval">Retrieval</TermWithHint>
            </dt>
            <dd>{content.retrieval}</dd>
            <dt>
              <TermWithHint termId="localBytes">Local bytes</TermWithHint>
            </dt>
            <dd>
              {content.availability === "available" ? "present" : "missing"}
            </dd>
          </dl>
        ) : null}

        {detail ? (
          <section className="ui-stack ui-stack--sm">
            {readContextConversionReadiness && onConvertToRag ? (
              <>
                <button
                  className="ui-button"
                  type="button"
                  disabled={contextConversion.status !== "ready"}
                  onClick={() => onConvertToRag(detail.locator.storageKey)}
                >
                  {contextConversion.status === "loading"
                    ? "Checking RAG readiness..."
                    : "Convert to RAG database"}
                </button>
                {contextConversion.readiness ? (
                  <p role="status">
                    {contextConversion.readiness.ready
                      ? contextConversion.readiness.alreadyChunked
                        ? `${contextConversion.readiness.chunkCount ?? 0} persisted chunks are ready to reuse.`
                        : "This artifact is ready for text extraction and chunking."
                      : [
                          contextConversion.readiness.message,
                          contextConversion.readiness.action,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                  </p>
                ) : null}
              </>
            ) : null}
            <button
              className="ui-button ui-button--destructive"
              type="button"
              onClick={() =>
                requestDeleteRegisteredArtifact(detail.locator.storageKey)
              }
            >
              Delete artifact
            </button>
            <h3>Local Object State</h3>
            <dl className="ui-grid ui-grid--two">
              <dt>
                <TermWithHint termId="localObject">
                  Local object availability
                </TermWithHint>
              </dt>
              <dd>
                {backingState.hasLocalObjectAvailable
                  ? "available"
                  : "not available"}
              </dd>
              <dt>
                <TermWithHint termId="localization">
                  Localization state
                </TermWithHint>
              </dt>
              <dd>
                {backingState.isLocalized
                  ? "localized"
                  : backingState.isRemoteOnly
                    ? "not localized"
                    : "n/a"}
              </dd>
            </dl>
            <ArtifactPreviewPanel preview={parquetPreview ?? artifactPreview} />
            {artifactPreview.descriptor?.kind === "image" ? (
              <div className="ui-grid ui-grid--two">
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => void selectPreviousImage()}
                  disabled={!canSelectPreviousImage}
                >
                  Previous
                </button>
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => void selectNextImage()}
                  disabled={!canSelectNextImage}
                >
                  Next
                </button>
              </div>
            ) : null}
            {backingState.isRemoteOnly ? (
              <p role="status">
                Remote-only artifact. Local preview is unavailable until
                localization.
              </p>
            ) : null}
          </section>
        ) : null}

        {detail?.metadata?.importedSourceBacking ? (
          <section className="ui-stack ui-stack--sm">
            <h3>Imported Source Backing</h3>
            <dl className="ui-grid ui-grid--two">
              <dt>
                <TermWithHint termId="provider">Provider</TermWithHint>
              </dt>
              <dd>{detail.metadata.importedSourceBacking.target.provider}</dd>
              <dt>
                <TermWithHint termId="repository">Repo</TermWithHint>
              </dt>
              <dd>{detail.metadata.importedSourceBacking.target.repository}</dd>
              <dt>
                <TermWithHint termId="pathInRepository">Path</TermWithHint>
              </dt>
              <dd>{detail.metadata.importedSourceBacking.target.path}</dd>
              <dt>
                <TermWithHint termId="revision">Revision</TermWithHint>
              </dt>
              <dd>
                {detail.metadata.importedSourceBacking.target.revision ??
                  "main"}
              </dd>
              <dt>
                <TermWithHint termId="sourceVerified">
                  Source verified
                </TermWithHint>
              </dt>
              <dd>
                {detail.metadata.importedSourceBacking.verification.exists
                  ? "yes"
                  : "no"}
              </dd>
              <dt>
                <TermWithHint termId="sourceChecked">
                  Source checked
                </TermWithHint>
              </dt>
              <dd>
                {detail.metadata.importedSourceBacking.verification
                  .verifiedAt ?? "never"}
              </dd>
            </dl>
            <button
              className="ui-button"
              type="button"
              onClick={() => void recheckSourceBacking()}
              disabled={sourceVerifyState.status === "loading"}
            >
              {sourceVerifyState.status === "loading"
                ? "Checking source..."
                : "Re-check source backing"}
            </button>
            {backingState.hasImportedSourceBacking &&
            !backingState.hasLocalObjectAvailable ? (
              <button
                className="ui-button"
                type="button"
                onClick={() => void localizeArtifactFromRepo()}
                disabled={localizeState.status === "loading"}
              >
                {localizeState.status === "loading"
                  ? "Localizing..."
                  : "Localize artifact"}
              </button>
            ) : null}
            <TransientNotificationPublisher
              message={
                sourceVerifyState.status !== "loading"
                  ? sourceVerifyState.message
                  : undefined
              }
              title={
                sourceVerifyState.status === "error"
                  ? "Source verification needs attention"
                  : "Source verification completed"
              }
              tone={sourceVerifyState.status === "error" ? "error" : "success"}
              source="Artifact Browser"
              workspaceId={workspaceId}
            />
            <TransientNotificationPublisher
              message={
                localizeState.status !== "loading"
                  ? localizeState.message
                  : undefined
              }
              title={
                localizeState.status === "error"
                  ? "Artifact localization needs attention"
                  : "Artifact localized"
              }
              tone={localizeState.status === "error" ? "error" : "success"}
              source="Artifact Browser"
              workspaceId={workspaceId}
            />
            {localizedArtifact ? (
              <p role="status">
                Localized bytes key: {localizedArtifact.localObject.key}
              </p>
            ) : null}
          </section>
        ) : null}

        {publishedBacking ? (
          <PublishedBackingPanel
            publishedBacking={publishedBacking}
            loading={publishState.status === "loading"}
            onRecheck={() => void recheckPublishedBacking()}
          />
        ) : null}
      </div>
    </section>
  );
}
