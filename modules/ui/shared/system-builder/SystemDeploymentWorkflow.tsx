import { useEffect, useMemo, useState } from "react";
import type { AssetImplementationDeploymentProfile } from "../../../contracts/asset-implementation";
import type { SystemRelease } from "../../../contracts/system-build";
import type {
  SystemDeployment,
  SystemDeploymentAuditEntry,
  SystemDeploymentCapabilityPolicy,
  SystemDeploymentResult,
  SystemDeploymentRun,
} from "../../../contracts/system-deployment";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import type { SystemBuildClient } from "./SystemBuildReleaseWorkflow";

interface DeploymentContextInput {
  readonly workspaceId: string;
  readonly deploymentId: string;
}

export interface SystemDeploymentClient {
  install(
    input: DeploymentContextInput & {
      releaseId: string;
      deploymentProfile: AssetImplementationDeploymentProfile;
      policy: SystemDeploymentCapabilityPolicy;
    },
  ): Promise<SystemDeploymentResult<SystemDeployment>>;
  activate(
    input: DeploymentContextInput,
  ): Promise<SystemDeploymentResult<SystemDeployment>>;
  health(
    input: DeploymentContextInput,
  ): Promise<SystemDeploymentResult<SystemDeployment>>;
  rollback(
    input: DeploymentContextInput,
  ): Promise<SystemDeploymentResult<SystemDeployment>>;
  revoke(
    input: DeploymentContextInput,
  ): Promise<SystemDeploymentResult<SystemDeployment>>;
  read(
    input: DeploymentContextInput,
  ): Promise<SystemDeploymentResult<SystemDeployment>>;
  list(input: {
    workspaceId: string;
    releaseId?: string;
  }): Promise<SystemDeploymentResult<readonly SystemDeployment[]>>;
  startRun(
    input: DeploymentContextInput & {
      runId: string;
      requestedCapabilities: readonly string[];
      requestedSecretReferences: readonly string[];
      requestedEgressOrigins: readonly string[];
    },
  ): Promise<SystemDeploymentResult<SystemDeploymentRun>>;
  cancelRun(input: {
    workspaceId: string;
    runId: string;
  }): Promise<SystemDeploymentResult<SystemDeploymentRun>>;
  listRuns(input: {
    workspaceId: string;
    deploymentId?: string;
    limit?: number;
  }): Promise<SystemDeploymentResult<readonly SystemDeploymentRun[]>>;
  listAudit(
    input: DeploymentContextInput & { limit?: number },
  ): Promise<SystemDeploymentResult<readonly SystemDeploymentAuditEntry[]>>;
}

export interface SystemDeploymentWorkflowProps {
  readonly workspaceId: string;
  readonly buildClient: Pick<SystemBuildClient, "listReleases">;
  readonly deploymentClient: SystemDeploymentClient;
  readonly deploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly controlSurfaceOnly?: boolean;
}

const DEFAULT_POLICY: SystemDeploymentCapabilityPolicy = {
  allowedCapabilities: [],
  allowedSecretReferences: [],
  egress: { mode: "deny-all", allowedOrigins: [] },
  quotas: {
    maximumRunSeconds: 300,
    maximumMemoryMiB: 512,
    maximumOutputBytes: 1024 * 1024,
    maximumConcurrentRuns: 1,
  },
};

export function SystemDeploymentWorkflow({
  workspaceId,
  buildClient,
  deploymentClient,
  deploymentProfiles,
  controlSurfaceOnly = false,
}: SystemDeploymentWorkflowProps) {
  const [releases, setReleases] = useState<readonly SystemRelease[]>([]);
  const [deployments, setDeployments] = useState<readonly SystemDeployment[]>(
    [],
  );
  const [runs, setRuns] = useState<readonly SystemDeploymentRun[]>([]);
  const [audit, setAudit] = useState<readonly SystemDeploymentAuditEntry[]>([]);
  const [releaseId, setReleaseId] = useState("");
  const [deploymentId, setDeploymentId] = useState("");
  const [profile, setProfile] = useState<AssetImplementationDeploymentProfile>(
    deploymentProfiles[0] ?? "local-desktop",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const selected = useMemo(
    () =>
      deployments.find((item) => String(item.deploymentId) === deploymentId),
    [deploymentId, deployments],
  );

  async function refresh(preferredDeploymentId?: string) {
    const [releaseResult, deploymentResult, runResult] = await Promise.all([
      buildClient.listReleases({ workspaceId }),
      deploymentClient.list({ workspaceId }),
      deploymentClient.listRuns({ workspaceId, limit: 50 }),
    ]);
    if (!releaseResult.ok) throw new Error(releaseResult.error.message);
    if (!deploymentResult.ok) throw new Error(deploymentResult.error.message);
    if (!runResult.ok) throw new Error(runResult.error.message);
    const orderedDeployments = [...deploymentResult.value].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    setReleases(releaseResult.value);
    setDeployments(orderedDeployments);
    setRuns(runResult.value);
    setReleaseId(
      (current) => current || String(releaseResult.value[0]?.releaseId ?? ""),
    );
    setDeploymentId(
      (current) =>
        preferredDeploymentId ||
        current ||
        String(orderedDeployments[0]?.deploymentId ?? ""),
    );
  }

  async function refreshAudit(targetDeploymentId: string) {
    const result = await deploymentClient.listAudit({
      workspaceId,
      deploymentId: targetDeploymentId,
      limit: 50,
    });
    if (!result.ok) throw new Error(result.error.message);
    setAudit(result.value);
  }

  useEffect(() => {
    let active = true;
    setError(undefined);
    void refresh().catch((cause) => {
      if (active) setError(safeMessage(cause));
    });
    return () => {
      active = false;
    };
  }, [buildClient, deploymentClient, workspaceId]);

  useEffect(() => {
    if (!deploymentId) {
      setAudit([]);
      return;
    }
    let active = true;
    void refreshAudit(deploymentId).catch((cause) => {
      if (active) setError(safeMessage(cause));
    });
    return () => {
      active = false;
    };
  }, [deploymentClient, deploymentId, workspaceId]);

  async function install() {
    if (!releaseId) return setError("Choose an approved release to install.");
    const nextId = createSafeId("system-deployment");
    await perform(
      () =>
        deploymentClient.install({
          workspaceId,
          deploymentId: nextId,
          releaseId,
          deploymentProfile: profile,
          policy: DEFAULT_POLICY,
        }),
      "Release installed. Activate it after reviewing compatibility evidence.",
      nextId,
    );
  }

  async function lifecycle(
    operation: "activate" | "health" | "rollback" | "revoke",
  ) {
    if (!selected) return setError("Choose a deployment first.");
    const message = {
      activate: "Deployment activated after readiness verification.",
      health: "Deployment health reconciled.",
      rollback: "Previous deployment restored.",
      revoke: "Deployment revoked and further starts denied.",
    }[operation];
    await perform(
      () => deploymentClient[operation]({ workspaceId, deploymentId }),
      message,
    );
  }

  async function startRun() {
    if (!selected) return setError("Choose an active deployment first.");
    await perform(
      () =>
        deploymentClient.startRun({
          workspaceId,
          deploymentId,
          runId: createSafeId("system-run"),
          requestedCapabilities: [],
          requestedSecretReferences: [],
          requestedEgressOrigins: [],
        }),
      "The host-owned runtime accepted the release-bound run handoff.",
    );
  }

  async function cancelRun(runId: string) {
    await perform(
      () => deploymentClient.cancelRun({ workspaceId, runId }),
      "Run cancellation recorded.",
    );
  }

  async function perform<T>(
    operation: () => Promise<SystemDeploymentResult<T>>,
    successMessage: string,
    preferredDeploymentId?: string,
  ) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await operation();
      if (!result.ok) setError(result.error.message);
      else {
        setNotice(successMessage);
        await refresh(preferredDeploymentId);
        const auditDeploymentId = preferredDeploymentId || deploymentId;
        if (auditDeploymentId) await refreshAudit(auditDeploymentId);
      }
    } catch (cause) {
      setError(safeMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="ui-panel ui-panel--sectioned"
      aria-labelledby="system-deployment-title"
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--blue">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="play" />
          </span>
          <div>
            <h2 id="system-deployment-title" className="ui-panel__title">
              Deploy and run
            </h2>
            <p className="ui-text-muted">
              Install an immutable release, verify host compatibility and
              readiness, then use the bounded host-owned runtime.
            </p>
          </div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--md">
        {controlSurfaceOnly ? (
          <p className="ui-status" role="status">
            This thin client is a control surface only. Build, secrets, storage,
            and privileged execution remain on the authenticated server.
          </p>
        ) : null}
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
        <div className="ui-workflow__field-grid">
          <label>
            Approved release
            <select
              value={releaseId}
              onChange={(event) => setReleaseId(event.currentTarget.value)}
              disabled={busy}
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
          <label>
            Host profile
            <select
              value={profile}
              onChange={(event) =>
                setProfile(
                  event.currentTarget
                    .value as AssetImplementationDeploymentProfile,
                )
              }
              disabled={busy}
            >
              {deploymentProfiles.map((item) => (
                <option key={item} value={item}>
                  {profileLabel(item)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ui-workflow__actions">
          <button
            type="button"
            onClick={() => void install()}
            disabled={busy || !releaseId}
          >
            <ApplicationIcon name="add" />
            <span>Install release</span>
          </button>
        </div>

        {deployments.length ? (
          <div className="ui-stack ui-stack--md">
            <label>
              Deployment
              <select
                value={deploymentId}
                onChange={(event) => setDeploymentId(event.currentTarget.value)}
                disabled={busy}
              >
                <option value="">Choose a deployment</option>
                {deployments.map((item) => (
                  <option
                    key={String(item.deploymentId)}
                    value={String(item.deploymentId)}
                  >
                    {item.status.toUpperCase()} - {item.deploymentId}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <>
                <dl className="system-build__summary">
                  <div>
                    <dt>Status</dt>
                    <dd>{selected.status}</dd>
                  </div>
                  <div>
                    <dt>Health</dt>
                    <dd>{selected.health.status}</dd>
                  </div>
                  <div>
                    <dt>Profile</dt>
                    <dd>{selected.deploymentProfile}</dd>
                  </div>
                  <div>
                    <dt>Sandbox</dt>
                    <dd>
                      {selected.compatibility.sandboxRequired
                        ? selected.compatibility.sandboxQualified
                          ? "qualified"
                          : "unavailable"
                        : "not required"}
                    </dd>
                  </div>
                </dl>
                {selected.compatibility.diagnostics.length ? (
                  <ul className="system-build__diagnostics">
                    {selected.compatibility.diagnostics.map((item, index) => (
                      <li key={`${item.code}-${index}`}>
                        <strong>{item.code}</strong>
                        <span>{item.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="ui-workflow__actions">
                  <button
                    type="button"
                    onClick={() => void lifecycle("activate")}
                    disabled={
                      busy ||
                      selected.status === "active" ||
                      selected.status === "revoked"
                    }
                  >
                    Activate
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    onClick={() => void lifecycle("health")}
                    disabled={busy || selected.status === "revoked"}
                  >
                    Check health
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    onClick={() => void lifecycle("rollback")}
                    disabled={
                      busy ||
                      selected.status !== "active" ||
                      !selected.previousDeploymentId
                    }
                  >
                    Rollback
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--outline"
                    onClick={() => void lifecycle("revoke")}
                    disabled={busy || selected.status === "revoked"}
                  >
                    Revoke
                  </button>
                  <button
                    type="button"
                    onClick={() => void startRun()}
                    disabled={busy || selected.status !== "active"}
                  >
                    Start bounded run
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <EmptyState
            compact
            title="No deployments"
            description="Install an approved release to create separate operational history."
            icon="systems"
          />
        )}

        <div className="ui-stack ui-stack--sm">
          <h3>Run history</h3>
          {runs.length ? (
            <ul className="system-build__release-list">
              {runs.map((run) => (
                <li key={String(run.runId)}>
                  <div>
                    <strong>{run.runId}</strong>
                    <span>
                      {run.status}
                      {" \u00b7 "}release {run.releaseId}
                    </span>
                  </div>
                  {run.status === "queued" || run.status === "running" ? (
                    <button
                      type="button"
                      className="ui-button ui-button--outline"
                      onClick={() => void cancelRun(String(run.runId))}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-text-muted">No deployment runs recorded.</p>
          )}
        </div>
        <div className="ui-stack ui-stack--sm">
          <h3>Safe audit evidence</h3>
          {audit.length ? (
            <ul className="system-build__diagnostics">
              {audit.map((entry) => (
                <li key={String(entry.auditId)}>
                  <strong>
                    {entry.action}: {entry.outcome}
                  </strong>
                  <span>
                    {entry.reasonCode}
                    {" \u00b7 "}
                    {entry.occurredAt}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ui-text-muted">
              Choose a deployment to inspect its bounded audit history.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const safeMessage = (cause: unknown) =>
  cause instanceof Error && cause.message
    ? cause.message
    : "The deployment request failed safely.";

function createSafeId(prefix: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${suffix}`;
}

function profileLabel(profile: AssetImplementationDeploymentProfile): string {
  return {
    "local-desktop": "Local desktop",
    "campus-server": "Campus or corporate server",
    "cloud-server": "Cloud server",
    "thin-client": "Thin client (control only)",
  }[profile];
}
