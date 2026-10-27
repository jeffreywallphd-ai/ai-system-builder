import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SystemPublicationBuildSummary } from "../../../contracts/system-build";
import type {
  SystemPublishedLifecycleAction,
  SystemPublishedLifecycleProjection,
} from "../../../contracts/system-deployment";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";
import type { SystemPublishedLifecycleClient } from "./SystemPublishedLifecycleClient";

const RUNNING_STATUS_REFRESH_INTERVAL_MS = 1_000;

interface PublishedLifecycleCardProps {
  readonly workspaceId: string;
  readonly build: SystemPublicationBuildSummary;
  readonly client: SystemPublishedLifecycleClient;
  readonly visualStartNotice?: string;
}

interface StatusReadOwner {
  readonly background: boolean;
  readonly settled: Promise<void>;
  invalidated: boolean;
}

export function SystemPublishedLifecycleCard(props: PublishedLifecycleCardProps) {
  const target = {
    workspaceId: props.workspaceId,
    client: props.client,
    buildId: String(props.build.buildId),
    revisionId: String(props.build.systemRevisionId),
    releaseId: String(props.build.releaseId ?? ""),
  };
  const [scope, setScope] = useState({ ...target, key: 0 });
  if (scope.workspaceId !== target.workspaceId || scope.client !== target.client ||
    scope.buildId !== target.buildId || scope.revisionId !== target.revisionId ||
    scope.releaseId !== target.releaseId) {
    setScope({ ...target, key: scope.key + 1 });
    return null;
  }
  return <PublishedLifecycleSession key={scope.key} {...props} />;
}

function PublishedLifecycleSession({
  workspaceId,
  build,
  client,
  visualStartNotice = "The visual system started on its host.",
}: PublishedLifecycleCardProps) {
  const releaseId = String(build.releaseId ?? "");
  const [projection, setProjection] = useState<SystemPublishedLifecycleProjection>();
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [busyAction, setBusyAction] = useState<SystemPublishedLifecycleAction>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mounted = useRef(false);
  const readOwner = useRef<StatusReadOwner | undefined>(undefined);
  const actionOwner = useRef<object | undefined>(undefined);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readOwner.current = undefined;
      actionOwner.current = undefined;
    };
  }, []);

  async function refresh(background = false, afterDeniedAction = false) {
    if (!mounted.current || readOwner.current || (actionOwner.current && !afterDeniedAction)) return;
    if (!releaseId) {
      setLoading(false);
      setProjection(undefined);
      setError("This published build does not have a release reference.");
      return;
    }
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    const owner: StatusReadOwner = { background, invalidated: false, settled };
    readOwner.current = owner;
    const ownsRead = () => mounted.current && readOwner.current === owner;
    const mayAdopt = () => ownsRead() && !owner.invalidated;
    setReading(true);
    if (!background) {
      setLoading(true);
      setError(undefined);
    }
    try {
      const result = await Promise.resolve().then(() => mayAdopt()
        ? client.read({ workspaceId, releaseId }) : undefined);
      if (!mayAdopt() || !result) return;
      if (!result.ok) {
        setProjection(undefined);
        setError(result.error.message);
      } else if (String(result.value.releaseId) !== releaseId) {
        setProjection(undefined);
        setError("The status reply did not match this published build. Select Retry status.");
      } else setProjection(result.value);
    } catch {
      if (mayAdopt()) {
        setProjection(undefined);
        setError("Unable to read the published build status.");
      }
    } finally {
      if (ownsRead()) {
        readOwner.current = undefined;
        setReading(false);
        if (!background) setLoading(false);
      }
      settle();
    }
  }

  useEffect(() => { void refresh(); }, [client, releaseId, workspaceId]);

  useEffect(() => {
    if (projection?.state !== "running") return;
    const interval = globalThis.setInterval(() => {
      if (mounted.current && !actionOwner.current) void refresh(true);
    }, RUNNING_STATUS_REFRESH_INTERVAL_MS);
    return () => globalThis.clearInterval(interval);
  }, [client, projection?.revision, projection?.state, releaseId, workspaceId]);

  async function invoke(action: SystemPublishedLifecycleAction) {
    const currentProjection = projection;
    if (!mounted.current || actionOwner.current || !currentProjection ||
      String(currentProjection.releaseId) !== releaseId ||
      !currentProjection.eligibleActions.includes(action) ||
      (readOwner.current && !readOwner.current.background)) return;

    // Keep the physical read slot until settlement. Ignore its stale result,
    // but do not accumulate replacement polls or claim transport cancellation.
    if (readOwner.current) readOwner.current.invalidated = true;
    const owner = {};
    actionOwner.current = owner;
    const current = () => mounted.current && actionOwner.current === owner;
    setBusyAction(action);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await client.invoke({ workspaceId, releaseId, action, expectedRevision: currentProjection.revision });
      if (!current()) return;
      if (!result.ok) {
        const actionError = result.error.message;
        setError(actionError);
        const pendingRead = readOwner.current;
        if (pendingRead) await pendingRead.settled;
        if (!current()) return;
        await refresh(false, true);
        if (current()) setError(actionError);
        return;
      }
      if (String(result.value.releaseId) !== releaseId) {
        setProjection(undefined);
        setError("The action reply did not match this published build. Select Retry status.");
        return;
      }
      setProjection(result.value);
      if (action === "start") {
        if (result.value.runtimeKind === "visual") setNotice(visualStartNotice);
        else if (result.value.runtimeKind === "service") setNotice("The service is running.");
        else setNotice("The system is running, but no trusted visual interface is available.");
      } else setNotice(actionNotice(action));
    } catch {
      if (current()) setError("Unable to update the published build status.");
    } finally {
      if (current()) {
        actionOwner.current = undefined;
        setBusyAction(undefined);
      }
    }
  }

  const stateLabel = projection
    ? lifecycleStateLabel(projection.state)
    : "Unavailable";
  const diagnostic = projection?.diagnostics.find(
    (item) => item.severity === "error" || item.severity === "warning",
  );

  return (
    <article
      className="system-published-lifecycle-card"
      aria-labelledby={`published-build-${String(build.buildId)}`}
    >
      <header className="system-published-lifecycle-card__header">
        <div>
          <h4 id={`published-build-${String(build.buildId)}`}>
            Build {build.versionNumber}
          </h4>
          <p>Published {formatDate(build.publishedAt)}</p>
        </div>
        <span
          className={`ui-badge ui-badge--${projection?.state === "running" ? "success" : projection?.state === "recovering" ? "warning" : "info"}`}
        >
          {stateLabel}
        </span>
      </header>

      {loading ? (
        <div className="system-published-lifecycle-card__loading">
          <LoadingSpinner
            label={`Loading build ${build.versionNumber} status`}
          />
          <span>Loading controls...</span>
        </div>
      ) : null}
      {error ? (
        <div className="ui-stack ui-stack--xs">
          <p className="ui-status ui-status--error" role="alert">
            {error}
          </p>
          {releaseId ? (
            <button
              type="button"
              className="ui-button ui-button--outline"
              onClick={() => void refresh()}
              disabled={reading || loading || Boolean(busyAction)}
            >
              <ApplicationIcon name="refresh" />
              <span>Retry status</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <TransientNotificationPublisher
        message={notice}
        title="Published system updated"
        tone="success"
        source="Published Systems"
        workspaceId={workspaceId}
      />
      {!error && diagnostic ? (
        <p
          className={`ui-status ui-status--${diagnostic.severity === "error" ? "error" : "warning"}`}
          role="status"
        >
          {diagnostic.message}
        </p>
      ) : null}

      {!loading && projection ? (
        <div
          className="system-published-lifecycle-card__actions"
          aria-label={`Controls for build ${build.versionNumber}`}
        >
          {projection.eligibleActions.map((action) => (
            <button
              key={action}
              type="button"
              className={
                action === "uninstall"
                  ? "ui-button ui-button--destructive"
                  : "ui-button"
              }
              disabled={Boolean(busyAction)}
              onClick={() => void invoke(action)}
            >
              {action === "start" ? <ApplicationIcon name="play" /> : null}
              <span>
                {busyAction === action
                  ? `${actionLabel(action)}...`
                  : actionLabel(action)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <details>
        <summary>Release details</summary>
        <dl className="system-published-lifecycle-card__details">
          <div>
            <dt>Release</dt>
            <dd>{releaseId || "Unavailable"}</dd>
          </div>
          <div>
            <dt>Saved version</dt>
            <dd>{String(build.systemRevisionId)}</dd>
          </div>
          {projection?.runtimeKind ? (
            <div>
              <dt>Runtime</dt>
              <dd>
                {projection.runtimeKind === "visual"
                  ? "Visual system"
                  : "Service"}
              </dd>
            </div>
          ) : null}
          {projection ? (
            <div>
              <dt>Health</dt>
              <dd>{projection.health}</dd>
            </div>
          ) : null}
        </dl>
      </details>
    </article>
  );
}

function actionLabel(action: SystemPublishedLifecycleAction): string {
  switch (action) {
    case "install":
      return "Install";
    case "activate":
      return "Activate";
    case "deactivate":
      return "Deactivate";
    case "start":
      return "Start";
    case "stop":
      return "Stop";
    case "uninstall":
      return "Uninstall";
  }
}

function actionNotice(action: SystemPublishedLifecycleAction): string {
  switch (action) {
    case "install":
      return "Installed and activated.";
    case "activate":
      return "Activated.";
    case "deactivate":
      return "Deactivated.";
    case "stop":
      return "Stopped.";
    case "uninstall":
      return "Uninstalled.";
    case "start":
      return "Started.";
  }
}

function lifecycleStateLabel(
  state: SystemPublishedLifecycleProjection["state"],
): string {
  switch (state) {
    case "not-installed":
      return "Not installed";
    case "active-stopped":
      return "Active and stopped";
    case "inactive-stopped":
      return "Inactive and stopped";
    case "running":
      return "Running";
    case "recovering":
      return "Needs attention";
  }
}

function formatDate(value?: string): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}
