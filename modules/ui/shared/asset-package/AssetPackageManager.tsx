import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  AssetPackageInspectionSummary,
  AssetPackageRecord,
} from "../../../contracts/asset-package";
import {
  ASSET_PACKAGE_MEDIA_TYPE,
  ASSET_PACKAGE_STARTER_FILENAME,
  serializeAssetPackageStarter,
} from "../../../contracts/asset-package";
import { ApplicationIcon } from "../components/ApplicationIcon";
import { EmptyState } from "../components/EmptyState";
import { WorkflowSequence, WorkflowStep } from "../components/WorkflowSequence";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";

export type AssetPackageClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface AssetPackageClient {
  inspect(input: {
    readonly workspaceId: string;
    readonly bytes: Uint8Array;
  }): Promise<AssetPackageClientResult<AssetPackageInspectionSummary>>;
  admit(input: {
    readonly workspaceId: string;
    readonly inspectionId: string;
    readonly packageDigest: string;
    readonly approvalScope: "workspace";
    readonly approvedCapabilities: readonly string[];
  }): Promise<AssetPackageClientResult<AssetPackageRecord>>;
  list(
    workspaceId: string,
  ): Promise<AssetPackageClientResult<readonly AssetPackageRecord[]>>;
  activate(input: {
    readonly workspaceId: string;
    readonly recordId: string;
  }): Promise<AssetPackageClientResult<AssetPackageRecord>>;
  disable(input: {
    readonly workspaceId: string;
    readonly recordId: string;
  }): Promise<AssetPackageClientResult<AssetPackageRecord>>;
  rollback(input: {
    readonly workspaceId: string;
    readonly recordId: string;
  }): Promise<AssetPackageClientResult<AssetPackageRecord>>;
}

export interface AssetPackageManagerProps {
  readonly workspaceId: string;
  readonly client: AssetPackageClient;
}

export interface AssetPackageStarterDownloadOptions {
  readonly document?: Document;
  readonly url?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  readonly scheduleCleanup?: (cleanup: () => void) => void;
}

export function downloadAssetPackageStarter(
  options: AssetPackageStarterDownloadOptions = {},
): void {
  const ownerDocument = options.document ?? document;
  const url = options.url ?? URL;
  const scheduleCleanup =
    options.scheduleCleanup ?? ((cleanup) => setTimeout(cleanup, 0));
  const objectUrl = url.createObjectURL(
    new Blob([serializeAssetPackageStarter()], {
      type: ASSET_PACKAGE_MEDIA_TYPE,
    }),
  );
  const anchor = ownerDocument.createElement("a");
  anchor.href = objectUrl;
  anchor.download = ASSET_PACKAGE_STARTER_FILENAME;
  anchor.hidden = true;

  try {
    ownerDocument.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    scheduleCleanup(() => url.revokeObjectURL(objectUrl));
  }
}

function matchesPackageInspection(value: AssetPackageInspectionSummary, workspaceId: string) {
  const strings = (items: readonly string[]) => Array.isArray(items) && items.every(item => typeof item === "string");
  const optionalText = (item: unknown) => item === undefined || typeof item === "string";
  return Boolean(value && value.workspaceId === workspaceId &&
    typeof value.inspectionId === "string" && value.inspectionId.length > 0 &&
    typeof value.packageDigest === "string" && value.packageDigest.length > 0 &&
    typeof value.eligibleForAdmission === "boolean" &&
    [value.packageId, value.version, value.displayName, value.publisher, value.formatVersion].every(optionalText) &&
    (!value.eligibleForAdmission || (value.packageId && value.version)) &&
    [value.definitionCount, value.implementationCount, value.entryCount, value.expandedSizeBytes].every(item => Number.isSafeInteger(item) && item >= 0) &&
    strings(value.requestedCapabilities) && strings(value.supportedDeploymentProfiles) && strings(value.conflicts) &&
    [value.signatureStatus, value.provenanceStatus, value.sbomStatus].every(item => ["verified", "unverified", "missing", "failed"].includes(item)) &&
    Array.isArray(value.issues) && value.issues.every(issue => issue && ["info", "warning", "error"].includes(issue.severity) &&
      typeof issue.code === "string" && typeof issue.message === "string" && optionalText(issue.path)));
}

function matchesPackageRecord(
  value: AssetPackageRecord,
  expected: { workspaceId: string; recordId?: string; packageId?: string; version?: string; packageDigest?: string; status?: AssetPackageRecord["status"] },
) {
  return Boolean(value && value.workspaceId === expected.workspaceId &&
    typeof value.recordId === "string" && value.recordId.length > 0 &&
    typeof value.packageId === "string" && value.packageId.length > 0 &&
    typeof value.version === "string" && value.version.length > 0 &&
    typeof value.packageDigest === "string" && value.packageDigest.length > 0 &&
    typeof value.displayName === "string" &&
    (value.trustLevel === undefined || typeof value.trustLevel === "string") &&
    (value.previousActiveRecordId === undefined || typeof value.previousActiveRecordId === "string") &&
    ["quarantined", "inspected", "rejected", "installed", "active", "disabled"].includes(value.status) &&
    Number.isSafeInteger(value.revision) && value.revision > 0 &&
    (!expected.recordId || value.recordId === expected.recordId) &&
    (!expected.packageId || value.packageId === expected.packageId) &&
    (!expected.version || value.version === expected.version) &&
    (!expected.packageDigest || value.packageDigest === expected.packageDigest) &&
    (!expected.status || value.status === expected.status));
}

export function AssetPackageManager(props: AssetPackageManagerProps) {
  const [scope, setScope] = useState({ workspaceId: props.workspaceId, client: props.client, key: 0 });
  if (scope.workspaceId !== props.workspaceId || scope.client !== props.client) {
    setScope({ workspaceId: props.workspaceId, client: props.client, key: scope.key + 1 });
    return null;
  }
  return <ScopedAssetPackageManager key={scope.key} {...props} />;
}

function ScopedAssetPackageManager({ workspaceId, client }: AssetPackageManagerProps) {
  const [inspection, setInspection] = useState<AssetPackageInspectionSummary>();
  const [packages, setPackages] = useState<readonly AssetPackageRecord[]>([]);
  const [approvedCapabilities, setApprovedCapabilities] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listFailed, setListFailed] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const mounted = useRef(true);
  const actionSequence = useRef(0);
  const actionOwner = useRef<number | undefined>(undefined);
  const listSequence = useRef(0);
  const listOwner = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const ownsAction = (owner: number) => mounted.current && actionOwner.current === owner;
  const beginAction = () => {
    if (!mounted.current || busy || actionOwner.current !== undefined) return;
    const owner = ++actionSequence.current;
    actionOwner.current = owner;
    setBusy(true);
    return owner;
  };
  const endAction = (owner: number) => {
    if (!ownsAction(owner)) return;
    actionOwner.current = undefined;
    setBusy(false);
  };
  const ownsList = (owner: number) => mounted.current && listOwner.current === owner;
  const invalidateList = () => {
    const pending = listOwner.current !== undefined;
    listOwner.current = undefined;
    listSequence.current++;
    setLoading(false);
    setListFailed(pending);
  };
  const matchesList = (value: readonly AssetPackageRecord[]) => Array.isArray(value) &&
    value.every(record => matchesPackageRecord(record, { workspaceId })) &&
    new Set(value.map(record => record.recordId)).size === value.length;

  async function loadPackages() {
    if (!mounted.current || actionOwner.current !== undefined || listOwner.current !== undefined) return;
    const owner = ++listSequence.current;
    listOwner.current = owner;
    setLoading(true);
    setListFailed(false);
    setError(undefined);
    try {
      const result = await client.list(workspaceId);
      if (!ownsList(owner)) return;
      if (!result.ok) { setError(result.error.message); setListFailed(true); }
      else {
        if (!matchesList(result.value)) throw new Error("Invalid package list response.");
        setPackages(result.value);
      }
    } catch {
      if (ownsList(owner)) { setError("Installed packages could not be loaded. Retry loading them."); setListFailed(true); }
    } finally {
      if (ownsList(owner)) { listOwner.current = undefined; setLoading(false); }
    }
  }

  useEffect(() => {
    void loadPackages();
    return () => { listOwner.current = undefined; };
  }, [client, workspaceId]);

  async function inspect(file: File | undefined) {
    if (!file) return;
    const owner = beginAction();
    if (owner === undefined) return;
    setError(undefined);
    setNotice(undefined);
    setInspection(undefined);
    setApprovedCapabilities([]);
    try {
      const buffer = await file.arrayBuffer();
      if (!ownsAction(owner)) return;
      const result = await client.inspect({ workspaceId, bytes: new Uint8Array(buffer) });
      if (!ownsAction(owner)) return;
      if (!result.ok) setError(result.error.message);
      else {
        const value = result.value;
        if (!matchesPackageInspection(value, workspaceId)) throw new Error("Invalid package inspection response.");
        setInspection(value);
      }
    } catch {
      if (ownsAction(owner)) setError("The package could not be read or inspected. Choose it again to retry.");
    } finally { endAction(owner); }
  }

  async function admit() {
    if (!inspection?.eligibleForAdmission || !inspection.requestedCapabilities.every(capability => approvedCapabilities.includes(capability))) return;
    const owner = beginAction();
    if (owner === undefined) return;
    invalidateList();
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await client.admit({ workspaceId, inspectionId: inspection.inspectionId, packageDigest: inspection.packageDigest,
        approvalScope: "workspace", approvedCapabilities: [...approvedCapabilities] });
      if (!ownsAction(owner)) return;
      if (!result.ok) setError(result.error.message);
      else {
        if (!matchesPackageRecord(result.value, { workspaceId, packageId: inspection.packageId, version: inspection.version, packageDigest: inspection.packageDigest }) ||
          !["installed", "active", "disabled"].includes(result.value.status)) throw new Error("Invalid package installation response.");
        setPackages(current => replaceRecord(current, result.value));
        setNotice(`${result.value.displayName} is installed for this workspace.`);
        setInspection(undefined);
        setApprovedCapabilities([]);
        await refreshAfterAction(owner, result.value);
      }
    } catch {
      if (ownsAction(owner)) setError("The package could not be installed. Refresh installed packages before trying again.");
    } finally { endAction(owner); }
  }

  async function refreshAfterAction(owner: number, acknowledged: AssetPackageRecord) {
    try {
      const refreshed = await client.list(workspaceId);
      if (!ownsAction(owner)) return;
      if (!refreshed.ok || !matchesList(refreshed.value)) throw new Error("Package refresh unavailable.");
      const target = refreshed.value.find(record => record.recordId === acknowledged.recordId);
      if (!target || !matchesPackageRecord(target, { workspaceId, recordId: acknowledged.recordId, packageId: acknowledged.packageId,
        version: acknowledged.version, packageDigest: acknowledged.packageDigest }) || target.revision < acknowledged.revision ||
        (target.revision === acknowledged.revision && target.status !== acknowledged.status)) throw new Error("Package refresh is inconsistent.");
      setPackages(refreshed.value);
      setListFailed(false);
      if (target.revision > acknowledged.revision) setNotice(`${target.displayName} is now ${target.status}.`);
    } catch {
      if (ownsAction(owner)) { setListFailed(true); setError("The package was updated, but installed packages could not be refreshed. Retry loading them."); }
    }
  }

  async function mutate(record: AssetPackageRecord, operation: "activate" | "disable" | "rollback") {
    const expectedId = operation === "rollback" ? record.previousActiveRecordId : record.recordId;
    if (!expectedId || !matchesPackageRecord(record, { workspaceId }) ||
      (operation === "activate" && !["installed", "disabled"].includes(record.status))) return;
    const owner = beginAction();
    if (owner === undefined) return;
    const target = operation === "rollback" ? packages.find(value => value.recordId === expectedId) : record;
    invalidateList();
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await client[operation]({ workspaceId, recordId: record.recordId });
      if (!ownsAction(owner)) return;
      if (!result.ok) { setError(result.error.message); return; }
      if (!matchesPackageRecord(result.value, { workspaceId, recordId: expectedId, packageId: record.packageId,
        version: target?.version, packageDigest: target?.packageDigest, status: operation === "disable" ? "disabled" : "active" })) throw new Error("Invalid package lifecycle response.");
      setPackages(current => replaceRecord(current, result.value));
      setNotice(`${result.value.displayName} is now ${result.value.status}.`);
      await refreshAfterAction(owner, result.value);
    } catch {
      if (ownsAction(owner)) setError("The package action could not be completed. Refresh installed packages before trying again.");
    } finally { endAction(owner); }
  }

  const allCapabilitiesApproved =
    inspection?.requestedCapabilities.every((capability) =>
      approvedCapabilities.includes(capability),
    ) ?? false;

  return (
    <section
      className="ui-panel ui-panel--sectioned asset-package-manager"
      aria-labelledby="asset-packages-title"
      aria-busy={busy || loading}
    >
      <header className="ui-panel__section-header">
        <div className="ui-panel-heading ui-panel-heading--violet">
          <span className="ui-panel-heading__icon" aria-hidden="true">
            <ApplicationIcon name="upload" />
          </span>
          <div>
            <h2 id="asset-packages-title" className="ui-panel__title">
              Import Assets
            </h2>
            <p className="ui-text-muted">
              Create or select an .aisb-package, inspect its contents without
              execution, and explicitly approve installation and activation.
            </p>
          </div>
        </div>
      </header>
      <div className="ui-panel__section-body ui-stack">
        <TransientNotificationPublisher message={error} title="Asset package needs attention" tone="error" source="Asset Packages" workspaceId={workspaceId} />
        <TransientNotificationPublisher message={notice} title="Asset package updated" tone="success" source="Asset Packages" workspaceId={workspaceId} />
        <section
          className="asset-package-manager__starter ui-workflow__subpanel"
          aria-labelledby="asset-package-starter-title"
        >
          <div className="asset-package-manager__starter-intro">
            <div>
              <h3 id="asset-package-starter-title">Create an asset package</h3>
              <p className="ui-text-muted">
                Download the safe JSON starter, replace every example identity,
                then add the definitions, implementations, entries, and evidence
                your assets require.
              </p>
            </div>
            <button
              type="button"
              className="ui-button ui-button--outline"
              onClick={() => downloadAssetPackageStarter()}
            >
              <ApplicationIcon name="download" />
              <span>Download .aisb-package starter</span>
            </button>
          </div>
          <ol className="asset-package-manager__authoring-steps">
            <li>
              <strong>Describe the assets.</strong> Set a namespaced package ID
              and version, then add semantic definitions with stable exact
              identities.
            </li>
            <li>
              <strong>Declare implementation content.</strong> Add safe relative
              entry paths, media types, exact byte sizes and SHA-256 digests,
              base64 content, deployment profiles, dependencies, and only the
              capabilities each facet needs.
            </li>
            <li>
              <strong>Attach and review evidence.</strong> Reference an SPDX
              SBOM and in-toto provenance, add a signature when policy requires
              it, then inspect below. Admission, installation, and activation
              remain separate explicit decisions.
            </li>
          </ol>
        </section>
        <WorkflowSequence ariaLabel="Asset import steps">
          <WorkflowStep
            title="Select and inspect"
            description="Choose an .aisb-package file. Inspection verifies the bounded container, hashes, compatibility, and evidence without running its contents."
            active={!inspection}
          >
            <label className="asset-package-manager__file ui-button ui-button--outline">
              <ApplicationIcon name="upload" />
              <span>{busy ? "Working…" : "Choose package"}</span>
              <input
                type="file"
                accept=".aisb-package,application/vnd.ai-system-builder.package.v1+json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void inspect(file);
                }}
              />
            </label>
          </WorkflowStep>
          <WorkflowStep
            title="Review trust and permissions"
            description="Admission remains blocked until inspection succeeds and every requested capability is explicitly approved."
            active={Boolean(inspection)}
          >
            {!inspection ? (
              <p className="ui-text-muted">
                Select a package to view its verified identity, evidence,
                compatibility, and capabilities.
              </p>
            ) : (
              <div className="ui-stack ui-stack--sm">
                <dl className="asset-package-manager__summary">
                  <div>
                    <dt>Package</dt>
                    <dd>
                      {inspection.displayName ??
                        inspection.packageId ??
                        "Unknown"}{" "}
                      {inspection.version ? `v${inspection.version}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Contents</dt>
                    <dd>
                      {inspection.definitionCount} definitions ·{" "}
                      {inspection.implementationCount} implementations ·{" "}
                      {inspection.entryCount} files
                    </dd>
                  </div>
                  <div>
                    <dt>Evidence</dt>
                    <dd>
                      Signature: {inspection.signatureStatus} · Provenance:{" "}
                      {inspection.provenanceStatus} · SBOM:{" "}
                      {inspection.sbomStatus}
                    </dd>
                  </div>
                  <div>
                    <dt>Compatibility</dt>
                    <dd>
                      {inspection.supportedDeploymentProfiles.join(", ") ||
                        "No supported deployment profile declared"}
                    </dd>
                  </div>
                </dl>
                {inspection.issues.length ? (
                  <ul className="asset-package-manager__issues">
                    {inspection.issues.map((issue, index) => (
                      <li
                        key={`${issue.code}-${index}`}
                        data-severity={issue.severity}
                      >
                        <strong>{issue.severity}:</strong> {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ui-status ui-status--success">
                    No inspection issues were found.
                  </p>
                )}
                <fieldset className="ui-workflow__subpanel" disabled={busy}>
                  <legend>Requested capabilities</legend>
                  {inspection.requestedCapabilities.length ? (
                    inspection.requestedCapabilities.map((capability) => (
                      <label
                        className="ui-workflow__checkbox-row"
                        key={capability}
                      >
                        <input
                          type="checkbox"
                          checked={approvedCapabilities.includes(capability)}
                          onChange={(event) =>
                            setApprovedCapabilities(
                              toggle(
                                approvedCapabilities,
                                capability,
                                event.currentTarget.checked,
                              ),
                            )
                          }
                        />
                        <span>{capability}</span>
                      </label>
                    ))
                  ) : (
                    <p className="ui-text-muted">
                      This package requests no host capabilities.
                    </p>
                  )}
                </fieldset>
              </div>
            )}
          </WorkflowStep>
          <WorkflowStep
            title="Install for this workspace"
            description="Installation stores immutable definitions and implementation releases. Activation is a separate, reversible action."
          >
            <button
              type="button"
              className="ui-button"
              disabled={
                busy ||
                !inspection?.eligibleForAdmission ||
                !allCapabilitiesApproved
              }
              onClick={() => void admit()}
            >
              <ApplicationIcon name="save" />
              <span>Install package</span>
            </button>
          </WorkflowStep>
        </WorkflowSequence>
        <section
          className="asset-package-manager__installed"
          aria-labelledby="installed-packages-title"
        >
          <h3 id="installed-packages-title">Installed packages</h3>
          <button type="button" className="ui-button ui-button--outline" disabled={busy || loading}
            onClick={() => void loadPackages()}>
            {listFailed ? "Retry loading installed packages" : "Refresh installed packages"}
          </button>
          {loading ? (
            <p role="status">Loading installed packages…</p>
          ) : listFailed && packages.length === 0 ? (
            <p className="ui-text-muted">Refresh installed packages to view this list.</p>
          ) : packages.length === 0 ? (
            <EmptyState
              title="No packages installed"
              description="Inspected packages you approve will appear here."
              icon="assets"
              compact
            />
          ) : (
            <ul className="asset-package-manager__records">
              {packages.map((record) => (
                <li key={record.recordId} className="ui-workflow__subpanel">
                  <div>
                    <strong>{record.displayName}</strong>{" "}
                    <span className="ui-type-badge ui-type-badge--violet">
                      {record.status.toUpperCase()}
                    </span>
                    <p className="ui-text-muted">
                      {record.packageId} · v{record.version} ·{" "}
                      {record.trustLevel ?? "unverified"}
                    </p>
                  </div>
                  <div className="asset-package-manager__record-actions">
                    {record.status !== "active" ? (
                      <button
                        type="button"
                        disabled={busy || !["installed", "disabled"].includes(record.status)}
                        onClick={() => void mutate(record, "activate")}
                      >
                        <ApplicationIcon name="play" />
                        <span>Activate</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ui-button ui-button--outline"
                        disabled={busy}
                        onClick={() => void mutate(record, "disable")}
                      >
                        <ApplicationIcon name="close" />
                        <span>Disable</span>
                      </button>
                    )}
                    {record.previousActiveRecordId ? (
                      <button
                        type="button"
                        className="ui-button ui-button--outline"
                        disabled={busy}
                        onClick={() => void mutate(record, "rollback")}
                      >
                        <ApplicationIcon name="refresh" />
                        <span>Rollback</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function toggle(
  values: readonly string[],
  value: string,
  enabled: boolean,
): readonly string[] {
  return enabled
    ? Array.from(new Set([...values, value]))
    : values.filter((entry) => entry !== value);
}

function replaceRecord(
  records: readonly AssetPackageRecord[],
  record: AssetPackageRecord,
): readonly AssetPackageRecord[] {
  return [
    ...records.filter((entry) => entry.recordId !== record.recordId),
    record,
  ].sort((left, right) => left.displayName.localeCompare(right.displayName));
}
