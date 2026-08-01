import { useEffect, useRef, useState } from "react";
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

export function SystemPublishedLifecycleCard({
  workspaceId,
  build,
  client,
  visualStartNotice = "The visual system started on its host.",
}: {
  readonly workspaceId: string;
  readonly build: SystemPublicationBuildSummary;
  readonly client: SystemPublishedLifecycleClient;
  readonly visualStartNotice?: string;
}) {
  const releaseId = String(build.releaseId ?? "");
  const [projection, setProjection] =
    useState<SystemPublishedLifecycleProjection>();
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] =
    useState<SystemPublishedLifecycleAction>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const requestGeneration = useRef(0);
  const actionInFlight = useRef(false);

  async function refresh(
    expectedGeneration = requestGeneration.current,
    background = false,
  ) {
    if (!releaseId) {
      setLoading(false);
      setProjection(undefined);
      setError("This published build does not have a release reference.");
      return;
    }
    if (!background) setLoading(true);
    setError(undefined);
    let result: Awaited<ReturnType<SystemPublishedLifecycleClient["read"]>>;
    try {
      result = await client.read({ workspaceId, releaseId });
    } catch {
      if (requestGeneration.current !== expectedGeneration) return;
      setProjection(undefined);
      setError("Unable to read the published build status.");
      setLoading(false);
      return;
    }
    if (requestGeneration.current !== expectedGeneration) return;
    if (result.ok) setProjection(result.value);
    else {
      setProjection(undefined);
      setError(result.error.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    requestGeneration.current += 1;
    const expectedGeneration = requestGeneration.current;
    setProjection(undefined);
    setNotice(undefined);
    void refresh(expectedGeneration);
    return () => {
      requestGeneration.current += 1;
    };
  }, [client, releaseId, workspaceId]);

  useEffect(() => {
    if (projection?.state !== "running") return;
    const expectedGeneration = requestGeneration.current;
    const interval = globalThis.setInterval(() => {
      if (
        actionInFlight.current ||
        requestGeneration.current !== expectedGeneration
      )
        return;
      void refresh(expectedGeneration, true);
    }, RUNNING_STATUS_REFRESH_INTERVAL_MS);
    return () => globalThis.clearInterval(interval);
  }, [client, projection?.revision, projection?.state, releaseId, workspaceId]);

  async function invoke(action: SystemPublishedLifecycleAction) {
    const current = projection;
    if (
      !current ||
      !current.eligibleActions.includes(action) ||
      busyAction ||
      actionInFlight.current
    )
      return;
    actionInFlight.current = true;
    setBusyAction(action);
    setError(undefined);
    setNotice(undefined);
    const expectedGeneration = requestGeneration.current;
    let result: Awaited<ReturnType<SystemPublishedLifecycleClient["invoke"]>>;
    try {
      result = await client.invoke({
        workspaceId,
        releaseId,
        action,
        expectedRevision: current.revision,
      });
    } catch {
      if (requestGeneration.current === expectedGeneration) {
        setError("Unable to update the published build status.");
        setBusyAction(undefined);
      }
      actionInFlight.current = false;
      return;
    }
    if (requestGeneration.current !== expectedGeneration) {
      actionInFlight.current = false;
      return;
    }
    if (result.ok) {
      setProjection(result.value);
      if (action === "start") {
        if (result.value.runtimeKind === "visual") {
          setNotice(visualStartNotice);
        } else if (result.value.runtimeKind === "service") {
          setNotice("The service is running.");
        } else {
          setNotice(
            "The system is running, but no trusted visual interface is available.",
          );
        }
      } else {
        setNotice(actionNotice(action));
      }
    } else {
      const actionError = result.error.message;
      await refresh(expectedGeneration);
      if (requestGeneration.current === expectedGeneration)
        setError(actionError);
    }
    setBusyAction(undefined);
    actionInFlight.current = false;
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
              disabled={loading || Boolean(busyAction)}
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
