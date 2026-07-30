import { Fragment, useCallback, useMemo, useState } from "react";

import {
  deriveArtifactBackingState,
  deriveArtifactListStatusLabels,
  derivePublishedBackingDisplayRows,
  derivePublishedBackingVerificationPresentation,
  ApplicationIcon,
  ArtifactPreviewPanel,
  PanelHeading,
  TermWithHint,
  TransientNotificationPublisher,
  TypeBadge,
  type PublishedBackingView,
} from "../../../../../../../modules/ui/shared";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { ARTIFACT_BROWSER_FAMILY_OPTIONS } from "../artifactFamilyOptions";
import { useArtifactBrowserFeature } from "../hooks/useArtifactBrowserFeature";
import { SettingsPanel, useApplicationSettings } from "../../settings";
import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { copyArtifactMediaBytesToArrayBuffer } from "../helpers/artifactMediaBytes";

export interface ArtifactBrowserFeatureProps {
  client?: DesktopArtifactBrowserClient;
  workspaceId?: string;
  workspaceName?: string;
}

const HUGGING_FACE_SETTINGS_KEYS = ["huggingface.token", "huggingface.defaultNamespace"] as const;

function PublishedBackingPanel(
  props: {
    publishedBacking: PublishedBackingView;
    loading: boolean;
    onRecheck: () => void;
  },
) {
  const verification = derivePublishedBackingVerificationPresentation(props.publishedBacking);
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
        <dt><TermWithHint termId="verification">Verification</TermWithHint></dt>
        <dd>{verification.statusLabel}</dd>
        <dt>Checked</dt>
        <dd>{verification.lastCheckedLabel}</dd>
      </dl>
      <button className="ui-button" type="button" onClick={props.onRecheck} disabled={props.loading}>
        Re-check published backing
      </button>
    </section>
  );
}

export function ArtifactBrowserFeature({ client, workspaceId }: ArtifactBrowserFeatureProps) {
  const settings = useApplicationSettings({ keys: useMemo(() => ["huggingface.defaultNamespace"], []) });
  const [downloadState, setDownloadState] = useState<{ status: "idle" | "error"; message?: string }>({
    status: "idle",
  });
  const [showHuggingFaceDefaults, setShowHuggingFaceDefaults] = useState(false);
  const [isDetailPopupOpen, setDetailPopupOpen] = useState(false);
  const {
    uploadedItems,
    generatedItems,
    otherItems,
    unregisteredItems,
    selectedStorageKey,
    detail,
    content,
    artifactPreview,
    publishState,
    localizeState,
    sourceVerifyState,
    publishedBacking,
    localizedArtifact,
    publishForm,
    viewState,
    selectArtifact,
    refreshArtifacts,
    registerUnregisteredArtifact,
    requestDeleteUnregisteredArtifact,
    requestDeleteRegisteredArtifact,
    pendingDeleteConfirmation,
    deleteConfirmationInput,
    setDeleteConfirmationInput,
    confirmPendingDelete,
    cancelPendingDelete,
    selectedArtifactFamily,
    setSelectedArtifactFamily,
    selectedStorageFilter,
    setSelectedStorageFilter,
    publishArtifactToHuggingFace,
    localizeArtifactFromRepo,
    recheckPublishedBacking,
    recheckSourceBacking,
    setRepository,
    setPathInRepo,
    setRevision,
    setMediaType,
    setCreateRepositoryIfMissing,
    setRepositoryVisibility,
    togglePublishForm,
    readArtifactMedia,
  } = useArtifactBrowserFeature(client, workspaceId);
  const transientViewState = Boolean(viewState.message && (
    /^(Deleted|Registered)\b/.test(viewState.message)
    || (viewState.status === "error" && !/^(Failed to load|Unable to load|Delete cancelled)/i.test(viewState.message))
  ));
  const backingState = deriveArtifactBackingState(detail, content);
  const defaultNamespace = settings.valuesByKey.get("huggingface.defaultNamespace")?.value;

  const resolvePublishRepository = useCallback((): string => {
    const repositoryValue = publishForm.repository.trim();
    if (!repositoryValue) {
      return "";
    }

    if (repositoryValue.includes("/")) {
      return repositoryValue;
    }

    if (typeof defaultNamespace === "string" && defaultNamespace.trim().length > 0) {
      return `${defaultNamespace.trim()}/${repositoryValue}`;
    }

    return repositoryValue;
  }, [defaultNamespace, publishForm.repository]);

  const resolvePublishPath = useCallback((): string => {
    const pathPrefix = publishForm.pathInRepo.trim().replace(/^\/+|\/+$/g, "");
    const artifactFileName = detail?.originalName?.trim() || detail?.locator.storageKey.split("/").pop() || "artifact";

    if (pathPrefix.length === 0) {
      return artifactFileName;
    }

    return `${pathPrefix}/${artifactFileName}`;
  }, [detail, publishForm.pathInRepo]);

  const publishRepositoryPreview = resolvePublishRepository();
  const publishPathPreview = resolvePublishPath();

  const openArtifactDetails = useCallback(async (storageKey: string) => {
    await selectArtifact(storageKey);
    setDetailPopupOpen(true);
  }, [selectArtifact]);

  const closeDetailPopup = useCallback(() => {
    setDetailPopupOpen(false);
  }, []);

  const onDownloadSelectedArtifact = useCallback(async () => {
    if (!detail) {
      return;
    }

    if (content?.availability !== "available") {
      setDownloadState({ status: "error", message: "Artifact bytes are unavailable for download." });
      return;
    }

    try {
      const media = await readArtifactMedia(detail.locator.storageKey);

      const blob = new Blob([copyArtifactMediaBytesToArrayBuffer(media.bytes)], {
        type: media.mediaType ?? detail.mediaType ?? "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = detail.originalName?.trim() || detail.locator.storageKey.split("/").pop() || "artifact";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloadState({ status: "idle" });
    } catch (error) {
      setDownloadState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to download artifact.",
      });
    }
  }, [content?.availability, detail, readArtifactMedia]);

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="browse" tone="violet">Artifact Browser</PanelHeading>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
      {viewState.message && !transientViewState ? <p role={viewState.status === "error" ? "alert" : "status"}>{viewState.message}</p> : null}
      <TransientNotificationPublisher message={transientViewState ? viewState.message : undefined} title={viewState.status === "error" ? "Artifact action needs attention" : "Artifacts updated"} tone={viewState.status === "error" ? "error" : "success"} source="Artifact Browser" workspaceId={workspaceId} />
      <section className="ui-stack ui-stack--sm">
        <label className="ui-stack ui-stack--sm">
          <span><TermWithHint termId="artifactFamily">Artifact family</TermWithHint></span>
          <select
            className="ui-input"
            value={selectedArtifactFamily}
            onChange={(event) => setSelectedArtifactFamily(event.target.value as typeof selectedArtifactFamily)}
          >
            <option value="all">All</option>
            {ARTIFACT_BROWSER_FAMILY_OPTIONS.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-stack ui-stack--sm">
          <span><TermWithHint termId="filterSource">Filter by source</TermWithHint></span>
          <select
            className="ui-input"
            value={selectedStorageFilter}
            onChange={(event) => setSelectedStorageFilter(event.target.value as typeof selectedStorageFilter)}
          >
            <option value="all">All Artifacts</option>
            <option value="uploaded">Uploaded Artifacts</option>
            <option value="generated">Generated Artifacts</option>
          </select>
        </label>
      </section>
      <div className="artifact-browser__toolbar">
        <button className="ui-button" type="button" onClick={() => void refreshArtifacts()}>
          <ApplicationIcon name="refresh" />
          <span className="ui-button__label">Refresh</span>
        </button>
      </div>
      {pendingDeleteConfirmation ? (
        <div className={`ui-modal-overlay${isDetailPopupOpen ? " ui-modal-overlay--stacked" : ""}`} role="presentation">
          <section className="ui-panel ui-modal-dialog ui-stack ui-stack--sm" role="dialog" aria-label="Delete confirmation" aria-modal="true">
            <header className="ui-modal-header">
              <h3>Delete artifact</h3>
              <button className="ui-modal-close" type="button" aria-label="Close delete confirmation" onClick={cancelPendingDelete}>x</button>
            </header>
            <div className="ui-modal-body ui-stack ui-stack--sm">
              <p>Type <strong>Delete</strong> to confirm this destructive action.</p>
              <p className="ui-text-muted">Artifact: {pendingDeleteConfirmation.storageKey}</p>
              <label className="ui-stack ui-stack--sm">
                <span><TermWithHint termId="deleteConfirmation">Confirmation</TermWithHint></span>
                <input
                  className="ui-input"
                  value={deleteConfirmationInput}
                  onChange={(event) => setDeleteConfirmationInput(event.target.value)}
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
                <button className="ui-button" type="button" onClick={cancelPendingDelete}>Cancel</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      <div className="ui-stack ui-stack--sm">
        <div className="ui-stack ui-stack--sm">
          <h3>Uploaded Artifacts</h3>
          <section className="artifact-browser__uploaded-grid" aria-label="Uploaded artifacts">
            {uploadedItems.length === 0 ? (
              <p className="ui-text-muted artifact-browser__empty-note">There are currently no uploaded artifacts in the workspace.</p>
            ) : null}
            {uploadedItems.map((item) => (
              <article className="artifact-browser__artifact-card ui-stack ui-stack--sm" key={item.storageKey}>
                <div className="ui-stack ui-stack--sm">
                  <div className="ui-type-label"><TypeBadge value={item.mediaType ?? item.originalName ?? item.storageKey} /><h4 className="artifact-browser__artifact-card-title">{item.originalName ?? item.storageKey}</h4></div>
                  <p className="artifact-browser__artifact-card-key">{item.storageKey}</p>
                </div>
                <p className="artifact-browser__artifact-card-status">
                  Status: {item.metadata?.backingState ? deriveArtifactListStatusLabels(item.metadata.backingState).join(" | ") : "local"}
                </p>
                <button className="ui-button" type="button" onClick={() => void openArtifactDetails(item.storageKey)} disabled={viewState.status === "loading" && selectedStorageKey === item.storageKey}>
                  <ApplicationIcon name="browse" />
                  <span className="ui-button__label">View Details</span>
                </button>                
              </article>
            ))}
          </section>
          <h3>Generated Artifacts</h3>
          <section className="ui-stack ui-stack--sm artifact-browser__list-section">
            {generatedItems.length === 0 ? (
              <p className="ui-text-muted">There are currently no generated artifacts in the workspace.</p>
            ) : null}
            {generatedItems.map((item) => (
              <section key={item.storageKey}>
                <p className="ui-type-label"><TypeBadge value={item.mediaType ?? item.originalName ?? item.storageKey} /><span>{item.originalName ?? item.storageKey}</span></p>
                <p>Status: {item.metadata?.backingState ? (
                  <small>{deriveArtifactListStatusLabels(item.metadata.backingState).join(" · ")}</small>
                ) : null}
                </p>
                <button className="ui-button" type="button" onClick={() => void openArtifactDetails(item.storageKey)} disabled={viewState.status === "loading" && selectedStorageKey === item.storageKey}>
                  <ApplicationIcon name="browse" />
                  <span className="ui-button__label">View Details</span>
                </button>
              </section>
            ))}
          </section>
          <h3>Other Registered Artifacts</h3>
          <section className="artifact-browser__uploaded-grid" aria-label="Other registered artifacts">
            {otherItems.length === 0 ? (
              <p className="ui-text-muted artifact-browser__empty-note">There are currently no other registered artifacts in the workspace.</p>
            ) : null}
            {otherItems.map((item) => (
              <article className="artifact-browser__artifact-card ui-stack ui-stack--sm" key={item.storageKey}>
                <div className="ui-stack ui-stack--sm">
                  <div className="ui-type-label"><TypeBadge value={item.mediaType ?? item.originalName ?? item.storageKey} /><h4 className="artifact-browser__artifact-card-title">{item.originalName ?? item.storageKey}</h4></div>
                  <p className="artifact-browser__artifact-card-key">{item.storageKey}</p>
                </div>
                <p className="artifact-browser__artifact-card-status">
                  Status: {item.metadata?.backingState ? deriveArtifactListStatusLabels(item.metadata.backingState).join(" | ") : "registered"}
                </p>
                <button className="ui-button" type="button" onClick={() => void openArtifactDetails(item.storageKey)} disabled={viewState.status === "loading" && selectedStorageKey === item.storageKey}>
                  <ApplicationIcon name="browse" />
                  <span className="ui-button__label">View Details</span>
                </button>
              </article>
            ))}
          </section>
          <section className="ui-stack ui-stack--sm artifact-browser__list-section">
            <h3>Unregistered Artifacts</h3>
            <ul className="ui-stack ui-stack--sm">
              {unregisteredItems.length === 0 ? (
                <li className="ui-text-muted">There are currently no unregistered artifacts in the workspace.</li>
              ) : null}
              {unregisteredItems.map((item) => (
                <li key={item.storageKey}>
                  <p className="ui-type-label"><TypeBadge value={item.mediaType ?? item.relativePath} /><span>{item.relativePath}</span></p>
                  <small>{item.mediaType ?? "unknown media type"} · {item.storageKey.split(".").pop() ?? "unknown"}</small>
                  <div className="ui-grid ui-grid--two">
                    <button
                      className="ui-button"
                      type="button"
                      onClick={() => void registerUnregisteredArtifact(item.storageKey)}
                    >
                      Register
                    </button>
                    <button
                      className="ui-button ui-button--destructive"
                      type="button"
                      onClick={() => requestDeleteUnregisteredArtifact(item.storageKey)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {isDetailPopupOpen ? (
          <div className="ui-modal-overlay" role="presentation">
            <section className="ui-panel ui-modal-dialog artifact-browser__detail-dialog ui-stack ui-stack--sm" role="dialog" aria-label="Detail and preview" aria-modal="true">
              <header className="ui-modal-header">
                <h3>Detail & preview</h3>
                <button className="ui-modal-close" type="button" aria-label="Close detail and preview" onClick={closeDetailPopup}>x</button>
              </header>
              <div className="ui-modal-body ui-stack ui-stack--sm">
          {detail ? (
            <dl className="ui-grid ui-grid--two">
              <dt><TermWithHint termId="storedKey">Selected key</TermWithHint></dt>
              <dd>{detail.locator.storageKey}</dd>
              <dt><TermWithHint termId="mediaType">Media type</TermWithHint></dt>
              <dd className="ui-type-label"><TypeBadge value={detail.mediaType ?? detail.originalName ?? detail.locator.storageKey} /><span>{detail.mediaType ?? "unknown"}</span></dd>
              <dt><TermWithHint termId="artifactFamily">Artifact family</TermWithHint></dt>
              <dd>{detail.artifactFamily}</dd>
              <dt><TermWithHint termId="source">Source</TermWithHint></dt>
              <dd>{detail.sourceKind ?? "unknown"}</dd>
              <dt><TermWithHint termId="storedSize">Size bytes</TermWithHint></dt>
              <dd>{detail.sizeBytes ?? "unknown"}</dd>
              <dt><TermWithHint termId="createdAt">Created at</TermWithHint></dt>
              <dd>{detail.createdAt ?? "unknown"}</dd>
            </dl>
          ) : (<p className="ui-text-muted">Select an artifact to inspect metadata and preview availability.</p>)}

          {detail?.metadata?.websiteCapture ? (
            <section className="ui-stack ui-stack--sm">
              <h3>Website capture metadata</h3>
              <dl className="ui-grid ui-grid--two">
                <dt><TermWithHint termId="sourceUrl">Source URL</TermWithHint></dt>
                <dd>{detail.metadata.websiteCapture.sourceUrl}</dd>
                <dt>Resolved URL</dt>
                <dd>{detail.metadata.websiteCapture.resolvedUrl}</dd>
                <dt><TermWithHint termId="singlePageMode">Requested mode</TermWithHint></dt>
                <dd>{detail.metadata.websiteCapture.requestedMode}</dd>
                <dt><TermWithHint termId="acquisitionMechanism">Acquisition mechanism</TermWithHint></dt>
                <dd>{detail.metadata.websiteCapture.acquisitionMechanismUsed}</dd>
                <dt>Retrieved at</dt>
                <dd>{detail.metadata.websiteCapture.retrievedAt}</dd>
                <dt>HTTP status</dt>
                <dd>{detail.metadata.websiteCapture.httpStatus ?? "unknown"}</dd>
                <dt><TermWithHint termId="contentType">Content-Type</TermWithHint></dt>
                <dd>{detail.metadata.websiteCapture.contentTypeHeader ?? "unknown"}</dd>
              </dl>
            </section>
          ) : null}

          {content ? (
            <dl className="ui-grid ui-grid--two">
              <dt><TermWithHint termId="availability">Availability</TermWithHint></dt>
              <dd>{content.availability}</dd>
              <dt><TermWithHint termId="retrieval">Retrieval</TermWithHint></dt>
              <dd>{content.retrieval}</dd>
              <dt><TermWithHint termId="localBytes">Local bytes</TermWithHint></dt>
              <dd>{content.availability === "available" ? "present" : "missing"}</dd>
            </dl>
          ) : null}

          {detail ? (
            <section className="ui-stack ui-stack--sm">
              <button
                className="ui-button"
                type="button"
                onClick={() => void onDownloadSelectedArtifact()}
                disabled={content?.availability !== "available"}
              >
                Download artifact
              </button>
              <button className="ui-button ui-button--destructive" type="button" onClick={() => requestDeleteRegisteredArtifact(detail.locator.storageKey)}>Delete registered artifact</button>
              <TransientNotificationPublisher message={downloadState.message} title="Artifact download needs attention" tone="error" source="Artifact Browser" workspaceId={workspaceId} />
              <h3>Local Object State</h3>
              <dl className="ui-grid ui-grid--two">
                <dt><TermWithHint termId="localObject">Local object availability</TermWithHint></dt>
                <dd>{backingState.hasLocalObjectAvailable ? "available" : "not available"}</dd>
                <dt><TermWithHint termId="localization">Localization state</TermWithHint></dt>
                <dd>{backingState.isLocalized ? "localized" : backingState.isRemoteOnly ? "not localized" : "n/a"}</dd>
              </dl>
              <ArtifactPreviewPanel preview={artifactPreview} />
              {backingState.isRemoteOnly ? (
                <p role="status">Remote-only artifact. Local preview is unavailable until localization.</p>
              ) : null}
            </section>
          ) : null}

          {detail?.metadata?.importedSourceBacking ? (
            <section className="ui-stack ui-stack--sm">
              <h3>Imported Source Backing</h3>
              <dl className="ui-grid ui-grid--two">
                <dt><TermWithHint termId="provider">Provider</TermWithHint></dt>
                <dd>{detail.metadata.importedSourceBacking.target.provider}</dd>
                <dt><TermWithHint termId="repository">Repo</TermWithHint></dt>
                <dd>{detail.metadata.importedSourceBacking.target.repository}</dd>
                <dt><TermWithHint termId="pathInRepository">Path</TermWithHint></dt>
                <dd>{detail.metadata.importedSourceBacking.target.path}</dd>
                <dt><TermWithHint termId="revision">Revision</TermWithHint></dt>
                <dd>{detail.metadata.importedSourceBacking.target.revision ?? "main"}</dd>
                <dt><TermWithHint termId="sourceVerified">Source verified</TermWithHint></dt>
                <dd>{detail.metadata.importedSourceBacking.verification.exists ? "yes" : "no"}</dd>
                <dt><TermWithHint termId="sourceChecked">Source checked</TermWithHint></dt>
                <dd>{detail.metadata.importedSourceBacking.verification.verifiedAt ?? "never"}</dd>
              </dl>
              <button
                className="ui-button"
                type="button"
                onClick={() => void recheckSourceBacking()}
                disabled={sourceVerifyState.status === "loading"}
              >
                {sourceVerifyState.status === "loading" ? "Checking source..." : "Re-check source backing"}
              </button>
              {backingState.hasImportedSourceBacking && !backingState.hasLocalObjectAvailable ? (
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => void localizeArtifactFromRepo()}
                  disabled={localizeState.status === "loading"}
                >
                  {localizeState.status === "loading" ? "Localizing..." : "Localize artifact"}
                </button>
              ) : null}
              <TransientNotificationPublisher message={sourceVerifyState.status !== "loading" ? sourceVerifyState.message : undefined} title={sourceVerifyState.status === "error" ? "Source verification needs attention" : "Source verification completed"} tone={sourceVerifyState.status === "error" ? "error" : "success"} source="Artifact Browser" workspaceId={workspaceId} />
              <TransientNotificationPublisher message={localizeState.status !== "loading" ? localizeState.message : undefined} title={localizeState.status === "error" ? "Artifact localization needs attention" : "Artifact localized"} tone={localizeState.status === "error" ? "error" : "success"} source="Artifact Browser" workspaceId={workspaceId} />
              {localizedArtifact ? (
                <p role="status">Localized bytes key: {localizedArtifact.localObject.key}</p>
              ) : null}
            </section>
          ) : null}

          {detail ? (
            <section className="ui-stack ui-stack--sm">
              <CollapsiblePanel
                title="Hugging Face defaults"
                isExpanded={showHuggingFaceDefaults}
                onToggle={() => setShowHuggingFaceDefaults((current) => !current)}
              >
                <SettingsPanel
                  compact
                  title="Hugging Face defaults"
                  keys={HUGGING_FACE_SETTINGS_KEYS.slice()}
                />
              </CollapsiblePanel>
              {backingState.hasLocalObjectAvailable ? (
                <>
                  <button className="ui-button" type="button" disabled={publishState.status === "loading"} onClick={togglePublishForm}>Publish to Hugging Face</button>
                  {publishForm.showPublishForm ? (
                    <>
                      <p role="note">Private or gated Hugging Face repositories may require a desktop-host token.</p>
                      <div className="ui-grid ui-grid--two">
                        <label className="ui-stack ui-stack--sm">
                          <span><TermWithHint termId="repository">Dataset repository name</TermWithHint></span>
                          <input
                            className="ui-input"
                            value={publishForm.repository}
                            onChange={(event) => setRepository(event.target.value)}
                            placeholder={typeof defaultNamespace === "string" && defaultNamespace.trim().length > 0 ? "your-dataset-repo" : "owner/repository"}
                            required
                          />
                          {typeof defaultNamespace === "string" && defaultNamespace.trim().length > 0 ? (
                            <small className="ui-text-muted">
                              Namespace: {defaultNamespace.trim()} (publishes to {publishRepositoryPreview || `${defaultNamespace.trim()}/your-dataset-repo`}).
                            </small>
                          ) : (
                            <small className="ui-text-muted">Format: owner/repository.</small>
                          )}
                        </label>
                        <label className="ui-stack ui-stack--sm"><span><TermWithHint termId="revision">Revision</TermWithHint> (optional)</span><input className="ui-input" value={publishForm.revision} onChange={(event) => setRevision(event.target.value)} /></label>
                        <label className="ui-stack ui-stack--sm">
                          <span><TermWithHint termId="pathPrefix">Path prefix</TermWithHint> (optional)</span>
                          <input className="ui-input" value={publishForm.pathInRepo} onChange={(event) => setPathInRepo(event.target.value)} />
                          <small className="ui-text-muted">Publishes artifact to: {publishPathPreview}</small>
                        </label>
                      </div>
                      <label className="ui-stack ui-stack--sm"><span><TermWithHint termId="mediaType">Media type</TermWithHint> (optional)</span><input className="ui-input" value={publishForm.mediaType} onChange={(event) => setMediaType(event.target.value)} /></label>
                      <label className="ui-checkbox-row">
                        <input
                          type="checkbox"
                          checked={publishForm.createRepositoryIfMissing}
                          onChange={(event) => setCreateRepositoryIfMissing(event.target.checked)}
                        />
                        <span>Create the repository if it does not exist</span>
                      </label>
                      {publishForm.createRepositoryIfMissing ? (
                        <label className="ui-stack ui-stack--sm">
                          <span>New repository visibility</span>
                          <select
                            className="ui-select"
                            value={publishForm.repositoryVisibility}
                            onChange={(event) => setRepositoryVisibility(event.target.value as "private" | "public")}
                          >
                            <option value="private">Private (recommended)</option>
                            <option value="public">Public</option>
                          </select>
                          <small className="ui-text-muted">This choice is used only if the target repository must be created.</small>
                        </label>
                      ) : null}
                      <button
                        className="ui-button"
                        type="button"
                        disabled={publishState.status === "loading" || resolvePublishRepository().length === 0}
                        onClick={() => void publishArtifactToHuggingFace({
                          repository: resolvePublishRepository(),
                          path: resolvePublishPath(),
                          revision: publishForm.revision,
                          mediaType: publishForm.mediaType,
                          repositoryCreation: publishForm.createRepositoryIfMissing
                            ? { approved: true, visibility: publishForm.repositoryVisibility }
                            : undefined,
                        })}
                      >
                        {publishState.status === "loading" ? "Publishing..." : "Publish"}
                      </button>
                    </>
                  ) : null}
                </>
              ) : (
                <p role="status">Publish is available after local bytes are present.</p>
              )}
              <TransientNotificationPublisher message={publishState.status !== "loading" ? publishState.message : undefined} title={publishState.status === "error" ? "Artifact publishing needs attention" : "Artifact published"} tone={publishState.status === "error" ? "error" : "success"} source="Artifact Browser" workspaceId={workspaceId} />
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
          </div>
        ) : null}
      </div>
      </div>
    </section>
  );
}
