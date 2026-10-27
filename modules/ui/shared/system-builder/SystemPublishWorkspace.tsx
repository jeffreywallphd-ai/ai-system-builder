import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  SystemPublicationBuildSummary,
  SystemPublicationWorkspace,
} from "../../../contracts/system-build";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { ModalDialog } from "../components/ModalDialog";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";
import type { SystemBuildClient } from "./SystemBuildReleaseWorkflow";
import { SystemPublishedLifecycleCard } from "./SystemPublishedLifecycleCard";
import type { SystemPublishedLifecycleClient } from "./SystemPublishedLifecycleClient";

interface SystemPublishWorkspaceProps {
  readonly workspaceId: string;
  readonly buildClient: SystemBuildClient;
  readonly lifecycleClient: SystemPublishedLifecycleClient;
  readonly visualStartNotice?: string;
}
interface PublicationSelection { readonly systemId: string; readonly buildId: string; }
interface PublicationConfirmation extends PublicationSelection {
  readonly systemRevisionId: string;
  readonly name: string;
  readonly versionNumber: number;
  readonly expectedLockDigest: string;
}

export function SystemPublishWorkspace(props: SystemPublishWorkspaceProps) {
  const [scope, setScope] = useState({ workspaceId: props.workspaceId, client: props.buildClient, key: 0 });
  if (scope.workspaceId !== props.workspaceId || scope.client !== props.buildClient) {
    setScope({ workspaceId: props.workspaceId, client: props.buildClient, key: scope.key + 1 });
    return null;
  }
  return <SystemPublishSession key={scope.key} {...props} />;
}

function SystemPublishSession({
  workspaceId,
  buildClient,
  lifecycleClient,
  visualStartNotice,
}: SystemPublishWorkspaceProps) {
  const [workspace, setWorkspace] = useState<SystemPublicationWorkspace>();
  const [selection, setSelection] = useState<PublicationSelection>({ systemId: "", buildId: "" });
  const { systemId, buildId } = selection;
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [confirmation, setConfirmation] = useState<PublicationConfirmation>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mounted = useRef(false);
  const readOwner = useRef<object | undefined>(undefined);
  const publicationOwner = useRef<object | undefined>(undefined);
  const confirmationOwner = useRef<PublicationConfirmation | undefined>(undefined);
  const currentWorkspace = useRef<SystemPublicationWorkspace | undefined>(undefined);
  const selectionIntent = useRef(selection);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readOwner.current = undefined;
      publicationOwner.current = undefined;
      confirmationOwner.current = undefined;
      currentWorkspace.current = undefined;
    };
  }, []);
  useLayoutEffect(() => { selectionIntent.current = selection; }, [selection]);

  async function refresh(preferredSystemId?: string, afterPublication = false) {
    if (!mounted.current || readOwner.current || confirmationOwner.current || (publicationOwner.current && !afterPublication)) return;
    const owner = {};
    readOwner.current = owner;
    const current = () => mounted.current && readOwner.current === owner;
    setLoading(true);
    setError(undefined);
    try {
      const result = await Promise.resolve().then(() => current() ? buildClient.publicationWorkspace({ workspaceId }) : undefined);
      if (!current() || !result) return;
      if (result.ok) {
        currentWorkspace.current = result.value;
        setWorkspace(result.value);
        setSelection(previous => choosePublication(result.value, preferredSystemId ?? previous.systemId, previous.buildId));
      } else {
        currentWorkspace.current = undefined;
        setWorkspace(undefined);
        setSelection({ systemId: "", buildId: "" });
        setError(result.error.message);
      }
    } catch {
      if (current()) {
        currentWorkspace.current = undefined;
        setWorkspace(undefined);
        setSelection({ systemId: "", buildId: "" });
        setError(afterPublication
          ? "The build was published. Could not reload builds. Select Refresh."
          : "Could not load builds. Select Refresh to try again.");
      }
    } finally {
      if (current()) { readOwner.current = undefined; setLoading(false); }
    }
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
  function selectSystem(next: string) {
    if (!mounted.current || readOwner.current || publicationOwner.current || confirmationOwner.current || !workspace || currentWorkspace.current !== workspace) return;
    const value = choosePublication(workspace, next);
    selectionIntent.current = value;
    setSelection(value);
  }
  function selectBuild(next: string) {
    if (!mounted.current || readOwner.current || publicationOwner.current || confirmationOwner.current || !selectedSystem?.builds.some(build => String(build.buildId) === next)) return;
    const value = { systemId, buildId: next };
    selectionIntent.current = value;
    setSelection(value);
  }
  function openConfirmation() {
    if (!mounted.current || readOwner.current || publicationOwner.current || confirmationOwner.current || selectionIntent.current !== selection || currentWorkspace.current !== workspace ||
      !selectedSystem || !selectedBuild || selectedBuild.publicationStatus !== "ready" || !selectedBuild.expectedLockDigest) return;
    const exact = { systemId: String(selectedSystem.systemId), systemRevisionId: String(selectedBuild.systemRevisionId), buildId: String(selectedBuild.buildId), name: selectedSystem.name,
      versionNumber: selectedBuild.versionNumber, expectedLockDigest: selectedBuild.expectedLockDigest };
    confirmationOwner.current = exact;
    setConfirmation(exact);
  }
  function closeConfirmation() {
    if (!mounted.current || publicationOwner.current) return;
    confirmationOwner.current = undefined;
    setConfirmation(undefined);
  }

  async function publish() {
    const exact = confirmationOwner.current;
    if (!mounted.current || readOwner.current || publicationOwner.current || !exact || exact !== confirmation) return;
    const owner = {};
    publicationOwner.current = owner;
    const current = () => mounted.current && publicationOwner.current === owner;
    setPublishing(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await buildClient.approve({ workspaceId, buildId: exact.buildId, expectedLockDigest: exact.expectedLockDigest });
      if (!current()) return;
      if (!result.ok) { setError(result.error.message); return; }
      if (String(result.value.targetWorkspaceId) !== workspaceId || String(result.value.sourceBuildId) !== exact.buildId ||
        String(result.value.systemId) !== exact.systemId || String(result.value.systemRevisionId) !== exact.systemRevisionId || result.value.lockDigest !== exact.expectedLockDigest) {
        setError("The publication result did not match this build. Close this confirmation and select Refresh.");
        return;
      }
      confirmationOwner.current = undefined;
      setConfirmation(undefined);
      setNotice(`${exact.name}, build ${exact.versionNumber}, was published.`);
      await refresh(exact.systemId, true);
    } catch {
      if (current()) setError("Could not publish this build. Review the selection and try again.");
    } finally {
      if (current()) { publicationOwner.current = undefined; setPublishing(false); }
    }
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
        <TransientNotificationPublisher message={error} title="Publishing needs attention" tone="error" source="System Publishing" workspaceId={workspaceId} />
        <TransientNotificationPublisher message={notice} title="Publishing updated" tone="success" source="System Publishing" workspaceId={workspaceId} />
        {loading ? <p role="status">Loading systems and builds...</p> : null}
        <div className="ui-workflow__actions">
          <button type="button" className="ui-button ui-button--outline" onClick={() => void refresh(selectionIntent.current.systemId)} disabled={publishing || loading || Boolean(confirmation)}>Refresh</button>
        </div>
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
                  onChange={(event) => selectSystem(event.currentTarget.value)}
                  disabled={publishing || loading || Boolean(confirmation)}
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
                  onChange={(event) => selectBuild(event.currentTarget.value)}
                  disabled={publishing || loading || Boolean(confirmation) || !selectedSystem?.builds.length}
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
                onClick={openConfirmation}
                disabled={
                  publishing || loading || Boolean(confirmation) || selectedBuild?.publicationStatus !== "ready" || !selectedBuild.expectedLockDigest
                }
              >
                <ApplicationIcon name="security" />
                <span>Publish build</span>
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
        open={Boolean(confirmation)}
        title="Publish this build?"
        onClose={closeConfirmation}
        closeDisabled={publishing}
        descriptionId="publish-confirmation-description"
        stacked
      >
        <p id="publish-confirmation-description">
          Publish <strong>{confirmation?.name}</strong>, build{" "}
          <strong>{confirmation?.versionNumber}</strong>? Published versions
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
            onClick={closeConfirmation}
            disabled={publishing}
          >
            Cancel
          </button>
        </div>
      </ModalDialog>
    </section>
  );
}

function choosePublication(workspace: SystemPublicationWorkspace, systemId = "", buildId = ""): PublicationSelection {
  const system = workspace.systems.find(item => String(item.systemId) === systemId) ?? workspace.systems[0];
  const build = system?.builds.find(item => String(item.buildId) === buildId) ?? system?.builds.find(item => item.publicationStatus === "ready") ?? system?.builds[0];
  return { systemId: String(system?.systemId ?? ""), buildId: String(build?.buildId ?? "") };
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
