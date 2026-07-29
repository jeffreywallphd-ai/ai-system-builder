import { useEffect, useMemo, useState } from "react";
import type {
  SystemPublicationBuildSummary,
  SystemPublicationWorkspace,
} from "../../../contracts/system-build";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { ModalDialog } from "../components/ModalDialog";
import type { SystemBuildClient } from "./SystemBuildReleaseWorkflow";
import { SystemPublishedLifecycleCard } from "./SystemPublishedLifecycleCard";
import type { SystemPublishedLifecycleClient } from "./SystemPublishedLifecycleClient";

export function SystemPublishWorkspace({
  workspaceId,
  buildClient,
  lifecycleClient,
  visualStartNotice,
}: {
  readonly workspaceId: string;
  readonly buildClient: SystemBuildClient;
  readonly lifecycleClient: SystemPublishedLifecycleClient;
  readonly visualStartNotice?: string;
}) {
  const [workspace, setWorkspace] = useState<SystemPublicationWorkspace>();
  const [systemId, setSystemId] = useState("");
  const [buildId, setBuildId] = useState("");
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function refresh(preferredSystemId?: string) {
    setLoading(true);
    setError(undefined);
    const result = await buildClient.publicationWorkspace({ workspaceId });
    if (result.ok) {
      setWorkspace(result.value);
      setSystemId(
        (current) =>
          preferredSystemId ??
          current ??
          String(result.value.systems[0]?.systemId ?? ""),
      );
      if (!systemId && !preferredSystemId) {
        setSystemId(String(result.value.systems[0]?.systemId ?? ""));
      }
    } else setError(result.error.message);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, [buildClient, workspaceId]);

  const selectedSystem = workspace?.systems.find(
    (system) => String(system.systemId) === systemId,
  );
  const selectedBuild = selectedSystem?.builds.find(
    (build) => String(build.buildId) === buildId,
  );
  const defaultBuildId = useMemo(
    () =>
      String(
        selectedSystem?.builds.find(
          (build) => build.publicationStatus === "ready",
        )?.buildId ??
          selectedSystem?.builds[0]?.buildId ??
          "",
      ),
    [selectedSystem],
  );

  useEffect(() => {
    setBuildId(defaultBuildId);
  }, [defaultBuildId, systemId]);

  async function publish() {
    if (
      !selectedSystem ||
      !selectedBuild ||
      selectedBuild.publicationStatus !== "ready" ||
      !selectedBuild.expectedLockDigest
    )
      return;
    setPublishing(true);
    setError(undefined);
    setNotice(undefined);
    const result = await buildClient.approve({
      workspaceId,
      buildId: String(selectedBuild.buildId),
      expectedLockDigest: selectedBuild.expectedLockDigest,
    });
    if (result.ok) {
      setConfirmOpen(false);
      setNotice(
        `${selectedSystem.name}, build ${selectedBuild.versionNumber}, was published.`,
      );
      await refresh(String(selectedSystem.systemId));
    } else setError(result.error.message);
    setPublishing(false);
  }

  return (
    <section
      className="ui-panel ui-panel--sectioned system-build"
      aria-labelledby="system-publish-title"
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--blue">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="systems" />
          </span>
          <div>
            <h2 id="system-publish-title" className="ui-panel__title">
              Publish
            </h2>
            <p className="ui-text-muted">
              Choose a completed build and publish it as a protected,
              unchangeable version.
            </p>
          </div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--md">
        {error ? (
          <p className="ui-status ui-status--error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="ui-status ui-status--success" role="status">
            {notice}
          </p>
        ) : null}
        {loading ? <p role="status">Loading systems and builds...</p> : null}
        {!loading && !workspace?.systems.length ? (
          <EmptyState
            compact
            title="No systems to publish"
            description="Create and save a system in Compose, then use Build & test."
            icon="systems"
          />
        ) : null}
        {workspace?.systems.length ? (
          <>
            <div className="ui-workflow__field-grid">
              <label>
                System
                <select
                  value={systemId}
                  onChange={(event) => setSystemId(event.currentTarget.value)}
                  disabled={publishing}
                >
                  {workspace.systems.map((system) => (
                    <option
                      key={String(system.systemId)}
                      value={String(system.systemId)}
                    >
                      {system.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Build version
                <select
                  value={buildId}
                  onChange={(event) => setBuildId(event.currentTarget.value)}
                  disabled={publishing || !selectedSystem?.builds.length}
                >
                  {!selectedSystem?.builds.length ? (
                    <option value="">No builds yet</option>
                  ) : null}
                  {selectedSystem?.builds.map((build) => (
                    <option
                      key={String(build.buildId)}
                      value={String(build.buildId)}
                    >
                      {buildLabel(build)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedBuild ? (
              <PublicationBuildSummary build={selectedBuild} />
            ) : (
              <EmptyState
                compact
                title="No builds yet"
                description="Open this system in Compose and use Build & test first."
                icon="systems"
              />
            )}
            <div className="ui-workflow__actions">
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={
                  publishing || selectedBuild?.publicationStatus !== "ready"
                }
              >
                <ApplicationIcon name="security" />
                <span>Publish build</span>
              </button>
              <button
                type="button"
                className="ui-button ui-button--outline"
                onClick={() => void refresh(systemId)}
                disabled={publishing || loading}
              >
                Refresh
              </button>
            </div>
            {selectedSystem?.builds.some(
              (build) => build.publicationStatus === "published",
            ) ? (
              <section
                className="ui-stack ui-stack--sm"
                aria-labelledby="published-versions-title"
              >
                <div>
                  <h3 id="published-versions-title">Published builds</h3>
                  <p className="ui-text-muted">
                    Install, run, stop, deactivate, or uninstall each exact
                    published build. Visual systems open automatically after
                    they start.
                  </p>
                </div>
                <div className="system-published-lifecycle-grid">
                  {selectedSystem.builds
                    .filter((build) => build.publicationStatus === "published")
                    .map((build) => (
                      <SystemPublishedLifecycleCard
                        key={`${String(build.buildId)}:${String(build.releaseId ?? "")}`}
                        workspaceId={workspaceId}
                        build={build}
                        client={lifecycleClient}
                        visualStartNotice={visualStartNotice}
                      />
                    ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
      <ModalDialog
        open={confirmOpen}
        title="Publish this build?"
        onClose={() => setConfirmOpen(false)}
        closeDisabled={publishing}
        descriptionId="publish-confirmation-description"
        stacked
      >
        <p id="publish-confirmation-description">
          Publish <strong>{selectedSystem?.name}</strong>, build{" "}
          <strong>{selectedBuild?.versionNumber}</strong>? Published versions
          cannot be changed.
        </p>
        <p className="ui-text-muted">
          Publishing verifies the build again. It does not install, activate, or
          run the system.
        </p>
        <div className="ui-workflow__actions">
          <button
            type="button"
            onClick={() => void publish()}
            disabled={publishing}
            data-modal-initial-focus
          >
            {publishing ? "Publishing..." : "Publish"}
          </button>
          <button
            type="button"
            className="ui-button ui-button--outline"
            onClick={() => setConfirmOpen(false)}
            disabled={publishing}
          >
            Cancel
          </button>
        </div>
      </ModalDialog>
    </section>
  );
}

function PublicationBuildSummary({
  build,
}: {
  readonly build: SystemPublicationBuildSummary;
}) {
  return (
    <section
      className="ui-workflow__subpanel ui-stack ui-stack--sm"
      aria-labelledby="selected-build-title"
    >
      <div className="system-build__status-line">
        <h3 id="selected-build-title">Build {build.versionNumber}</h3>
        <span
          className={`ui-badge ui-badge--${build.publicationStatus === "ready" ? "info" : build.publicationStatus === "published" ? "success" : "warning"}`}
        >
          {build.statusMessage}
        </span>
      </div>
      <p>
        {build.publicationStatus === "ready"
          ? "This build passed its checks and is ready to publish."
          : build.statusMessage}
      </p>
      <details>
        <summary>Technical details</summary>
        <dl className="system-build__summary">
          <div>
            <dt>Build reference</dt>
            <dd>{build.buildId}</dd>
          </div>
          <div>
            <dt>Saved version reference</dt>
            <dd>{build.systemRevisionId}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(build.createdAt)}</dd>
          </div>
          <div>
            <dt>Outputs</dt>
            <dd>{build.outputCount}</dd>
          </div>
          <div>
            <dt>Evidence items</dt>
            <dd>{build.evidenceCount}</dd>
          </div>
          <div>
            <dt>Messages</dt>
            <dd>{build.diagnosticCount}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

function buildLabel(build: SystemPublicationBuildSummary): string {
  return `Build ${build.versionNumber} - ${formatDate(build.createdAt)} - ${build.statusMessage}`;
}

function formatDate(value?: string): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}
