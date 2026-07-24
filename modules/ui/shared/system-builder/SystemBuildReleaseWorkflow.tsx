import { useEffect, useMemo, useState } from "react";
import type {
  SystemBuildRecord,
  SystemBuildResult,
  SystemRelease,
  SystemReleaseComparison,
} from "../../../contracts/system-build";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { WorkflowSequence, WorkflowStep } from "../components/WorkflowSequence";
import type { SystemBuilderClient } from "./SystemBuilderWorkspace";

export interface SystemBuildClient {
  request(input: {
    workspaceId: string;
    buildId: string;
    systemId: string;
    systemRevisionId: string;
    deploymentProfile:
      "local-desktop" | "campus-server" | "cloud-server" | "thin-client";
    availableCapabilities: readonly string[];
    permittedTrustLevels: readonly (
      "system-trusted" | "organization-approved" | "workspace-approved"
    )[];
    hostApiVersion: string;
    runtimeAbiVersion?: string;
    toolchainProfile: string;
  }): Promise<SystemBuildResult<SystemBuildRecord>>;
  cancel(input: {
    workspaceId: string;
    buildId: string;
  }): Promise<SystemBuildResult<SystemBuildRecord>>;
  listBuilds(input: {
    workspaceId: string;
    systemId?: string;
  }): Promise<SystemBuildResult<readonly SystemBuildRecord[]>>;
  approve(input: {
    workspaceId: string;
    buildId: string;
    expectedLockDigest: string;
  }): Promise<SystemBuildResult<SystemRelease>>;
  listReleases(input: {
    workspaceId: string;
    systemId?: string;
  }): Promise<SystemBuildResult<readonly SystemRelease[]>>;
  compare(input: {
    workspaceId: string;
    leftReleaseId: string;
    rightReleaseId: string;
  }): Promise<SystemBuildResult<SystemReleaseComparison>>;
}

export interface SystemBuildReleaseWorkflowProps {
  readonly workspaceId: string;
  readonly systemBuilderClient: Pick<
    SystemBuilderClient,
    "list" | "listRevisions"
  >;
  readonly buildClient: SystemBuildClient;
  readonly defaultDeploymentProfile?:
    "local-desktop" | "campus-server" | "cloud-server" | "thin-client";
}

const TRUST_LEVELS = [
  "system-trusted",
  "organization-approved",
  "workspace-approved",
] as const;

export function SystemBuildReleaseWorkflow({
  workspaceId,
  systemBuilderClient,
  buildClient,
  defaultDeploymentProfile = "local-desktop",
}: SystemBuildReleaseWorkflowProps) {
  const [systems, setSystems] = useState<readonly SystemBuilderRecord[]>([]);
  const [revisions, setRevisions] = useState<readonly SystemBuilderRevision[]>(
    [],
  );
  const [builds, setBuilds] = useState<readonly SystemBuildRecord[]>([]);
  const [releases, setReleases] = useState<readonly SystemRelease[]>([]);
  const [systemId, setSystemId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [deploymentProfile, setDeploymentProfile] = useState(
    defaultDeploymentProfile,
  );
  const [capabilitiesText, setCapabilitiesText] = useState("");
  const [hostApiVersion, setHostApiVersion] = useState("1.0.0");
  const [runtimeAbiVersion, setRuntimeAbiVersion] = useState("");
  const [toolchainProfile, setToolchainProfile] = useState(
    "ai-system-builder/1.0.0",
  );
  const [selectedBuildId, setSelectedBuildId] = useState("");
  const [leftReleaseId, setLeftReleaseId] = useState("");
  const [rightReleaseId, setRightReleaseId] = useState("");
  const [comparison, setComparison] = useState<SystemReleaseComparison>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const selectedRevision = revisions.find(
    (revision) => String(revision.revisionId) === revisionId,
  );
  const selectedBuild = builds.find(
    (build) => String(build.buildId) === selectedBuildId,
  );
  const selectedSystem = systems.find(
    (system) => String(system.systemId) === systemId,
  );
  const blockingIssues =
    selectedRevision?.validationIssues.filter(
      (issue) => issue.severity === "error",
    ) ?? [];
  const buildReady =
    Boolean(selectedRevision) &&
    blockingIssues.length === 0 &&
    selectedRevision!.instances.length > 0;
  const sortedBuilds = useMemo(
    () =>
      [...builds].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    [builds],
  );

  useEffect(() => {
    let active = true;
    setError(undefined);
    setSystemId("");
    setRevisionId("");
    setBuilds([]);
    setReleases([]);
    void systemBuilderClient.list({ workspaceId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const available = result.value.filter(
        (system) => system.status !== "archived",
      );
      setSystems(available);
      setSystemId(String(available[0]?.systemId ?? ""));
    });
    return () => {
      active = false;
    };
  }, [systemBuilderClient, workspaceId]);

  useEffect(() => {
    if (!systemId) {
      setRevisions([]);
      setRevisionId("");
      setBuilds([]);
      setReleases([]);
      return;
    }
    let active = true;
    setError(undefined);
    setComparison(undefined);
    void Promise.all([
      systemBuilderClient.listRevisions({ workspaceId, systemId }),
      buildClient.listBuilds({ workspaceId, systemId }),
      buildClient.listReleases({ workspaceId, systemId }),
    ]).then(([revisionResult, buildResult, releaseResult]) => {
      if (!active) return;
      if (revisionResult.ok) {
        const ordered = [...revisionResult.value].sort(
          (left, right) => right.revisionNumber - left.revisionNumber,
        );
        setRevisions(ordered);
        setRevisionId(String(ordered[0]?.revisionId ?? ""));
      } else setError(revisionResult.error.message);
      if (buildResult.ok) {
        setBuilds(buildResult.value);
        setSelectedBuildId(
          String(
            buildResult.value.find((build) => build.status === "succeeded")
              ?.buildId ??
              buildResult.value[0]?.buildId ??
              "",
          ),
        );
      } else setError(buildResult.error.message);
      if (releaseResult.ok) {
        setReleases(releaseResult.value);
        setLeftReleaseId(String(releaseResult.value[0]?.releaseId ?? ""));
        setRightReleaseId(String(releaseResult.value[1]?.releaseId ?? ""));
      } else setError(releaseResult.error.message);
    });
    return () => {
      active = false;
    };
  }, [buildClient, systemBuilderClient, systemId, workspaceId]);

  async function requestBuild() {
    if (!selectedRevision || !selectedSystem) {
      setError("Choose an exact system revision before building.");
      return;
    }
    if (!buildReady) {
      setError(
        blockingIssues.length
          ? "Resolve the revision's blocking validation issues before building."
          : "Add at least one asset before building.",
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setComparison(undefined);
    const buildId = createBuildId();
    const result = await buildClient.request({
      workspaceId,
      buildId,
      systemId: String(selectedSystem.systemId),
      systemRevisionId: String(selectedRevision.revisionId),
      deploymentProfile,
      availableCapabilities: parseList(capabilitiesText),
      permittedTrustLevels: TRUST_LEVELS,
      hostApiVersion: hostApiVersion.trim(),
      ...(runtimeAbiVersion.trim()
        ? { runtimeAbiVersion: runtimeAbiVersion.trim() }
        : {}),
      toolchainProfile: toolchainProfile.trim(),
    });
    if (result.ok) {
      setBuilds((current) => [
        result.value,
        ...current.filter((build) => build.buildId !== result.value.buildId),
      ]);
      setSelectedBuildId(String(result.value.buildId));
      setNotice(
        result.value.status === "succeeded"
          ? "Build completed. Review its evidence before approving a release."
          : `Build finished with status ${result.value.status}.`,
      );
    } else setError(result.error.message);
    setBusy(false);
  }

  async function cancelBuild(build: SystemBuildRecord) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await buildClient.cancel({
      workspaceId,
      buildId: String(build.buildId),
    });
    if (result.ok) {
      setBuilds((current) =>
        current.map((item) =>
          item.buildId === result.value.buildId ? result.value : item,
        ),
      );
      setNotice("Build cancellation recorded.");
    } else setError(result.error.message);
    setBusy(false);
  }

  async function approveRelease() {
    if (!selectedBuild?.lockDigest) {
      setError("Choose a successful evidence-backed build to approve.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await buildClient.approve({
      workspaceId,
      buildId: String(selectedBuild.buildId),
      expectedLockDigest: selectedBuild.lockDigest,
    });
    if (result.ok) {
      setReleases((current) => [
        result.value,
        ...current.filter(
          (release) => release.releaseId !== result.value.releaseId,
        ),
      ]);
      setLeftReleaseId(String(result.value.releaseId));
      setNotice(
        "Immutable release approved after artifact integrity verification.",
      );
    } else setError(result.error.message);
    setBusy(false);
  }

  async function compareReleases() {
    if (!leftReleaseId || !rightReleaseId) {
      setError("Choose two releases to compare.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await buildClient.compare({
      workspaceId,
      leftReleaseId,
      rightReleaseId,
    });
    if (result.ok) setComparison(result.value);
    else setError(result.error.message);
    setBusy(false);
  }

  return (
    <section
      className="ui-panel ui-panel--sectioned system-build"
      aria-labelledby="system-build-title"
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--blue">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="systems" />
          </span>
          <div>
            <h2 id="system-build-title" className="ui-panel__title">
              Build and release
            </h2>
            <p className="ui-text-muted">
              Resolve exact implementations, create deterministic artifacts,
              review evidence, and approve immutable releases.
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
        <WorkflowSequence ariaLabel="System build and release workflow">
          <WorkflowStep
            title="Choose an immutable revision"
            description="A build never reads a moving latest pointer after it starts."
            active={!selectedRevision}
          >
            <div className="ui-workflow__field-grid">
              <label>
                System
                <select
                  value={systemId}
                  onChange={(event) => setSystemId(event.currentTarget.value)}
                  disabled={busy}
                >
                  <option value="">Choose a system</option>
                  {systems.map((system) => (
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
                Revision
                <select
                  value={revisionId}
                  onChange={(event) => setRevisionId(event.currentTarget.value)}
                  disabled={busy || !systemId}
                >
                  <option value="">Choose a revision</option>
                  {revisions.map((revision) => (
                    <option
                      key={String(revision.revisionId)}
                      value={String(revision.revisionId)}
                    >
                      Revision {revision.revisionNumber} - {revision.revisionId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Deployment target
                <select
                  value={deploymentProfile}
                  onChange={(event) =>
                    setDeploymentProfile(
                      event.currentTarget.value as typeof deploymentProfile,
                    )
                  }
                  disabled={busy}
                >
                  <option value="local-desktop">Local desktop</option>
                  <option value="campus-server">
                    Campus or corporate server
                  </option>
                  <option value="cloud-server">Cloud server</option>
                  <option value="thin-client">Thin client</option>
                </select>
              </label>
            </div>
            {selectedRevision ? (
              <dl className="ui-workflow__subpanel system-build__summary">
                <div>
                  <dt>Assets</dt>
                  <dd>{selectedRevision.instances.length}</dd>
                </div>
                <div>
                  <dt>Connections</dt>
                  <dd>{selectedRevision.bindings.length}</dd>
                </div>
                <div>
                  <dt>Blocking issues</dt>
                  <dd>{blockingIssues.length}</dd>
                </div>
              </dl>
            ) : (
              <p className="ui-text-muted">
                Choose a saved revision to inspect its frozen inputs.
              </p>
            )}
          </WorkflowStep>
          <WorkflowStep
            title="Set the build environment"
            description="Compatibility and capability inputs become part of the deterministic lock."
            active={Boolean(selectedRevision) && !selectedBuild}
          >
            <div className="ui-workflow__field-grid">
              <label>
                Host API version
                <input
                  value={hostApiVersion}
                  onChange={(event) =>
                    setHostApiVersion(event.currentTarget.value)
                  }
                  disabled={busy}
                />
              </label>
              <label>
                Runtime ABI version{" "}
                <span className="ui-text-muted">(optional)</span>
                <input
                  value={runtimeAbiVersion}
                  onChange={(event) =>
                    setRuntimeAbiVersion(event.currentTarget.value)
                  }
                  disabled={busy}
                />
              </label>
              <label>
                Toolchain profile
                <input
                  value={toolchainProfile}
                  onChange={(event) =>
                    setToolchainProfile(event.currentTarget.value)
                  }
                  disabled={busy}
                />
              </label>
              <label>
                Available capabilities{" "}
                <span className="ui-text-muted">(comma separated)</span>
                <input
                  value={capabilitiesText}
                  onChange={(event) =>
                    setCapabilitiesText(event.currentTarget.value)
                  }
                  placeholder="network.egress, model.invoke"
                  disabled={busy}
                />
              </label>
            </div>
            <div className="ui-workflow__actions">
              <button
                type="button"
                onClick={() => void requestBuild()}
                disabled={
                  busy ||
                  !buildReady ||
                  !hostApiVersion.trim() ||
                  !toolchainProfile.trim()
                }
              >
                <ApplicationIcon name="play" />
                <span>{busy ? "Building..." : "Build system"}</span>
              </button>
            </div>
          </WorkflowStep>
          <WorkflowStep
            title="Review build evidence"
            description="Failed and cancelled builds never become releases; diagnostics are retained without activating artifacts."
            active={
              selectedBuild?.status !== undefined &&
              selectedBuild.status !== "succeeded"
            }
          >
            {sortedBuilds.length ? (
              <div className="system-build__review-grid">
                <div>
                  <label>
                    Build
                    <select
                      value={selectedBuildId}
                      onChange={(event) =>
                        setSelectedBuildId(event.currentTarget.value)
                      }
                    >
                      <option value="">Choose a build</option>
                      {sortedBuilds.map((build) => (
                        <option
                          key={String(build.buildId)}
                          value={String(build.buildId)}
                        >
                          {build.status.toUpperCase()} - {build.buildId}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {selectedBuild ? (
                  <div className="ui-workflow__status ui-stack ui-stack--sm">
                    <div className="system-build__status-line">
                      <span
                        className={`ui-badge ui-badge--${selectedBuild.status === "succeeded" ? "info" : selectedBuild.status === "failed" ? "danger" : "warning"}`}
                      >
                        {selectedBuild.status}
                      </span>
                      <span>{selectedBuild.assurance}</span>
                      {selectedBuild.lockDigest ? (
                        <code>{shortDigest(selectedBuild.lockDigest)}</code>
                      ) : null}
                    </div>
                    <dl className="system-build__summary">
                      <div>
                        <dt>Outputs</dt>
                        <dd>{selectedBuild.outputArtifacts.length}</dd>
                      </div>
                      <div>
                        <dt>Evidence</dt>
                        <dd>{selectedBuild.evidenceArtifacts.length}</dd>
                      </div>
                      <div>
                        <dt>Diagnostics</dt>
                        <dd>{selectedBuild.diagnostics.length}</dd>
                      </div>
                    </dl>
                    {selectedBuild.diagnostics.length ? (
                      <ul className="system-build__diagnostics">
                        {selectedBuild.diagnostics.map((diagnostic, index) => (
                          <li key={`${diagnostic.code}-${index}`}>
                            <strong>{diagnostic.code}</strong>
                            <span>{diagnostic.message}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ui-text-muted">No build diagnostics.</p>
                    )}
                    {selectedBuild.status === "queued" ||
                    selectedBuild.status === "running" ? (
                      <button
                        type="button"
                        className="ui-button ui-button--outline"
                        onClick={() => void cancelBuild(selectedBuild)}
                        disabled={busy}
                      >
                        <ApplicationIcon name="close" />
                        <span>Cancel build</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                compact
                title="No builds yet"
                description="Build a validated system revision to create evidence-backed artifacts."
                icon="systems"
              />
            )}
          </WorkflowStep>
          <WorkflowStep
            title="Approve and compare releases"
            description="Approval re-verifies every artifact; release identity is derived from content rather than a user-entered version."
            active={selectedBuild?.status === "succeeded"}
          >
            <div className="ui-workflow__actions">
              <button
                type="button"
                onClick={() => void approveRelease()}
                disabled={
                  busy ||
                  selectedBuild?.status !== "succeeded" ||
                  !selectedBuild.lockDigest
                }
              >
                <ApplicationIcon name="security" />
                <span>Approve immutable release</span>
              </button>
            </div>
            {releases.length ? (
              <div className="ui-workflow__subpanel ui-stack ui-stack--sm">
                <ul className="system-build__release-list">
                  {releases.map((release) => (
                    <li key={String(release.releaseId)}>
                      <div>
                        <strong>{release.releaseId}</strong>
                        <span>
                          {release.compatibility.deploymentProfiles.join(", ")}{" "}
                          - {release.assurance}
                        </span>
                      </div>
                      <code>{shortDigest(release.releaseDigest)}</code>
                    </li>
                  ))}
                </ul>
                {releases.length > 1 ? (
                  <>
                    <div className="ui-workflow__field-grid">
                      <label>
                        Left release
                        <select
                          value={leftReleaseId}
                          onChange={(event) =>
                            setLeftReleaseId(event.currentTarget.value)
                          }
                        >
                          {releases.map((release) => (
                            <option
                              key={String(release.releaseId)}
                              value={String(release.releaseId)}
                            >
                              {release.releaseId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Right release
                        <select
                          value={rightReleaseId}
                          onChange={(event) =>
                            setRightReleaseId(event.currentTarget.value)
                          }
                        >
                          <option value="">Choose a release</option>
                          {releases.map((release) => (
                            <option
                              key={String(release.releaseId)}
                              value={String(release.releaseId)}
                            >
                              {release.releaseId}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button
                      type="button"
                      className="ui-button ui-button--outline"
                      onClick={() => void compareReleases()}
                      disabled={busy}
                    >
                      <ApplicationIcon name="switch" />
                      <span>Compare releases</span>
                    </button>
                  </>
                ) : null}
                {comparison ? (
                  <dl className="system-build__summary">
                    <div>
                      <dt>Same inputs</dt>
                      <dd>{comparison.sameInputs ? "Yes" : "No"}</dd>
                    </div>
                    <div>
                      <dt>Same artifacts</dt>
                      <dd>{comparison.sameArtifacts ? "Yes" : "No"}</dd>
                    </div>
                    <div>
                      <dt>Changed implementations</dt>
                      <dd>
                        {comparison.changedImplementationInstanceIds.length}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>
            ) : (
              <p className="ui-text-muted">
                No approved releases for this system.
              </p>
            )}
          </WorkflowStep>
        </WorkflowSequence>
      </div>
    </section>
  );
}

function createBuildId(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `system-build:${random}`;
}

function parseList(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function shortDigest(value: string): string {
  return value.length > 24
    ? `${value.slice(0, 19)}...${value.slice(-4)}`
    : value;
}
