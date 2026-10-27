import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  SystemBuildPreparation,
  SystemBuildRecord,
} from "../../../contracts/system-build";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../contracts/system-builder";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { ModalDialog } from "../components/ModalDialog";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";
import type { SystemBuildClient } from "./SystemBuildReleaseWorkflow";

export interface SystemBuildTestModalProps {
  readonly open: boolean;
  readonly workspaceId: string;
  readonly system?: SystemBuilderRecord;
  readonly revision?: SystemBuilderRevision;
  readonly buildClient: SystemBuildClient;
  readonly onClose: () => void;
}

export function SystemBuildTestModal(props: SystemBuildTestModalProps) {
  const target = { open: props.open, workspaceId: props.workspaceId,
    systemId: String(props.system?.systemId ?? ""), revisionId: String(props.revision?.revisionId ?? ""), client: props.buildClient };
  const [scope, setScope] = useState({ ...target, key: 0 });
  if (scope.open !== target.open || scope.workspaceId !== target.workspaceId ||
    scope.systemId !== target.systemId || scope.revisionId !== target.revisionId || scope.client !== target.client) {
    setScope({ ...target, key: scope.key + 1 });
    return null;
  }
  return <SystemBuildTestSession key={scope.key} {...props} />;
}

function SystemBuildTestSession({
  open,
  workspaceId,
  system,
  revision,
  buildClient,
  onClose,
}: SystemBuildTestModalProps) {
  const [preparation, setPreparation] = useState<SystemBuildPreparation>();
  const [build, setBuild] = useState<SystemBuildRecord>();
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();
  const [notification, setNotification] = useState<string>();
  const mounted = useRef(false);
  const preparationOwner = useRef<object | undefined>(undefined);
  const actionOwner = useRef<object | undefined>(undefined);
  const buildActionRef = useRef<HTMLButtonElement>(null);
  const systemId = String(system?.systemId ?? "");
  const revisionId = String(revision?.revisionId ?? "");

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      preparationOwner.current = undefined;
      actionOwner.current = undefined;
    };
  }, []);

  async function checkSavedRevision() {
    if (!mounted.current || !open || !systemId || !revisionId || preparationOwner.current || actionOwner.current) return;
    const owner = {};
    preparationOwner.current = owner;
    const current = () => mounted.current && preparationOwner.current === owner;
    setLoading(true);
    setPreparation(undefined);
    setBuild(undefined);
    setError(undefined);
    setNotification(undefined);
    try {
      const result = await Promise.resolve().then(() => current()
        ? buildClient.prepare({ workspaceId, systemId, systemRevisionId: revisionId }) : undefined);
      if (!current() || !result) return;
      if (!result.ok) setError(result.error.message);
      else if (String(result.value.systemId) !== systemId || String(result.value.systemRevisionId) !== revisionId) {
        setNotification("The build checks did not match this saved version. Select Retry checks.");
      } else setPreparation(result.value);
    } catch {
      if (current()) setNotification("Could not check this saved version. Select Retry checks to try again.");
    } finally {
      if (current()) { preparationOwner.current = undefined; setLoading(false); }
    }
  }

  useEffect(() => { void checkSavedRevision(); }, [buildClient, open, revisionId, systemId, workspaceId]);

  useEffect(() => {
    if (open && preparation?.status === "ready" && !loading) {
      buildActionRef.current?.focus();
    }
  }, [loading, open, preparation?.status]);

  async function startBuild() {
    if (!mounted.current || !open || !system || !revision || preparation?.status !== "ready" || preparationOwner.current || actionOwner.current || build) return;
    const owner = {};
    actionOwner.current = owner;
    const current = () => mounted.current && actionOwner.current === owner;
    setBuilding(true);
    setError(undefined);
    setNotification(undefined);
    try {
      const requestedBuildId = createBuildId();
      const result = await buildClient.request({ workspaceId, buildId: requestedBuildId, systemId, systemRevisionId: revisionId });
      if (!current()) return;
      if (!result.ok) setError(result.error.message);
      else if (String(result.value.buildId) !== requestedBuildId || String(result.value.systemId) !== systemId || String(result.value.systemRevisionId) !== revisionId || String(result.value.targetWorkspaceId) !== workspaceId) {
        setNotification("The build result did not match this saved version. Close this view and check the saved version again.");
      } else setBuild(result.value);
    } catch {
      if (current()) setNotification("Could not build this saved version. Try Build & test again.");
    } finally {
      if (current()) { actionOwner.current = undefined; setBuilding(false); }
    }
  }

  async function cancelBuild() {
    if (!mounted.current || !open || actionOwner.current || preparationOwner.current || !build || !["queued", "running"].includes(build.status)) return;
    const owner = {};
    actionOwner.current = owner;
    const current = () => mounted.current && actionOwner.current === owner;
    setCancelling(true);
    setError(undefined);
    setNotification(undefined);
    try {
      const result = await buildClient.cancel({ workspaceId, buildId: String(build.buildId) });
      if (!current()) return;
      if (!result.ok) setError(result.error.message);
      else if (String(result.value.buildId) !== String(build.buildId) || String(result.value.targetWorkspaceId) !== workspaceId || String(result.value.systemId) !== systemId || String(result.value.systemRevisionId) !== revisionId) {
        setNotification("The cancellation result did not match this build. Close this view and check the saved version again.");
      } else setBuild(result.value);
    } catch {
      if (current()) setNotification("Could not cancel this build. Try Cancel build again.");
    } finally {
      if (current()) { actionOwner.current = undefined; setCancelling(false); }
    }
  }

  function close() {
    if (mounted.current && !preparationOwner.current && !actionOwner.current) onClose();
  }

  const busy = loading || building || cancelling;
  const title = system ? `Build & test ${system.name}` : "Build & test";
  const descriptionId = "system-build-test-description";
  return (
    <ModalDialog
      open={open}
      title={title}
      onClose={close}
      closeDisabled={busy}
      descriptionId={descriptionId}
      dialogClassName="system-build-test-modal"
    >
      <TransientNotificationPublisher message={notification} title="Build needs attention" tone="error" source="System Build" workspaceId={workspaceId} />
      <p id={descriptionId} className="ui-text-muted">
        Create a checked build from the current saved version. Publishing remains
        a separate step.
      </p>
      {error ? (
        <p className="ui-status ui-status--error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">Checking this saved version…</p> : null}
      {preparation ? (
        <>
          <dl className="system-build__summary">
            <div>
              <dt>Saved version</dt>
              <dd>Version {preparation.revisionNumber}</dd>
            </div>
            <div>
              <dt>Build location</dt>
              <dd>{preparation.targetLabel}</dd>
            </div>
            <div>
              <dt>Ready</dt>
              <dd>{preparation.status === "ready" ? "Yes" : "Not yet"}</dd>
            </div>
          </dl>
          <ul className="system-build__diagnostics" aria-label="Build readiness checks">
            {preparation.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.label}</strong>
                <span>{check.message}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {building ? (
        <p className="ui-status ui-status--info" role="status">
          Building and testing this saved version…
        </p>
      ) : null}
      {build ? <BuildResultSummary build={build} /> : null}
      <div className="ui-workflow__actions">
        {!loading && !preparation && open && system && revision ? (
          <button type="button" onClick={() => void checkSavedRevision()} disabled={busy}>Retry checks</button>
        ) : null}
        {build && ["queued", "running"].includes(build.status) ? (
          <button
            ref={buildActionRef}
            type="button"
            className="ui-button ui-button--outline"
            onClick={() => void cancelBuild()}
            disabled={busy}
          >
            Cancel build
          </button>
        ) : null}
        {!build ? (
          <button
            type="button"
            onClick={() => void startBuild()}
            disabled={busy || preparation?.status !== "ready"}
            data-modal-initial-focus
          >
            <ApplicationIcon name="play" />
            <span>{building ? "Building & testing…" : "Build & test"}</span>
          </button>
        ) : (
          <button type="button" onClick={close} disabled={busy}>
            Close
          </button>
        )}
      </div>
    </ModalDialog>
  );
}

function BuildResultSummary({ build }: { readonly build: SystemBuildRecord }) {
  const succeeded = build.status === "succeeded";
  return (
    <section className="ui-stack ui-stack--sm" aria-labelledby="build-result-title">
      <h3 id="build-result-title">
        {succeeded
          ? "Build and checks completed"
          : build.status === "cancelled"
            ? "Build cancelled"
            : "Build needs attention"}
      </h3>
      <p
        className={`ui-status ${succeeded ? "ui-status--success" : "ui-status--error"}`}
        role="status"
      >
        {succeeded
          ? "This build is ready to review in Publish."
          : "Nothing was published. Review the messages below before trying again."}
      </p>
      {build.diagnostics.length ? (
        <ul className="system-build__diagnostics">
          {build.diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${index}`}>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>Technical details</summary>
        <dl className="system-build__summary">
          <div><dt>Build reference</dt><dd>{build.buildId}</dd></div>
          <div><dt>Saved version reference</dt><dd>{build.systemRevisionId}</dd></div>
          <div><dt>Outputs</dt><dd>{build.outputArtifacts.length}</dd></div>
          <div><dt>Evidence items</dt><dd>{build.evidenceArtifacts.length}</dd></div>
          {build.lockDigest ? <div><dt>Integrity</dt><dd>{shortDigest(build.lockDigest)}</dd></div> : null}
        </dl>
      </details>
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

function shortDigest(value: string): string {
  return value.length > 24
    ? `${value.slice(0, 19)}…${value.slice(-4)}`
    : value;
}
