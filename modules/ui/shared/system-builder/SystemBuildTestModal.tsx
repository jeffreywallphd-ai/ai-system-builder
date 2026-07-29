import { useEffect, useRef, useState } from "react";
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
import type { SystemBuildClient } from "./SystemBuildReleaseWorkflow";

export interface SystemBuildTestModalProps {
  readonly open: boolean;
  readonly workspaceId: string;
  readonly system?: SystemBuilderRecord;
  readonly revision?: SystemBuilderRevision;
  readonly buildClient: SystemBuildClient;
  readonly onClose: () => void;
}

export function SystemBuildTestModal({
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
  const buildActionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !system || !revision) return undefined;
    let active = true;
    setLoading(true);
    setPreparation(undefined);
    setBuild(undefined);
    setError(undefined);
    void buildClient
      .prepare({
        workspaceId,
        systemId: String(system.systemId),
        systemRevisionId: String(revision.revisionId),
      })
      .then((result) => {
        if (!active) return;
        if (result.ok) setPreparation(result.value);
        else setError(result.error.message);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [buildClient, open, revision, system, workspaceId]);

  useEffect(() => {
    if (open && preparation?.status === "ready" && !loading) {
      buildActionRef.current?.focus();
    }
  }, [loading, open, preparation?.status]);

  async function startBuild() {
    if (!system || !revision || preparation?.status !== "ready") return;
    setBuilding(true);
    setError(undefined);
    const result = await buildClient.request({
      workspaceId,
      buildId: createBuildId(),
      systemId: String(system.systemId),
      systemRevisionId: String(revision.revisionId),
    });
    if (result.ok) setBuild(result.value);
    else setError(result.error.message);
    setBuilding(false);
  }

  async function cancelBuild() {
    if (!build || !["queued", "running"].includes(build.status)) return;
    setCancelling(true);
    const result = await buildClient.cancel({
      workspaceId,
      buildId: String(build.buildId),
    });
    if (result.ok) setBuild(result.value);
    else setError(result.error.message);
    setCancelling(false);
  }

  const busy = loading || building || cancelling;
  const title = system ? `Build & test ${system.name}` : "Build & test";
  const descriptionId = "system-build-test-description";
  return (
    <ModalDialog
      open={open}
      title={title}
      onClose={onClose}
      closeDisabled={busy}
      descriptionId={descriptionId}
      dialogClassName="system-build-test-modal"
    >
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
          <button type="button" onClick={onClose} disabled={busy}>
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
