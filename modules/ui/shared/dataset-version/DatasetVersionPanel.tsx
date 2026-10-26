import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  groupDatasetVersionsForDisplay,
  normalizeDatasetVersionRecord,
  normalizeDatasetVersionPublicationRecord,
  type DatasetVersionComparison,
  type DatasetVersionPublicationRecord,
  type DatasetVersionRecord,
  type DatasetVersionReproduction,
} from "../../../contracts/dataset";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";

export interface DatasetVersionPanelService {
  list(
    workspaceId: string,
    datasetId?: string,
  ): Promise<readonly DatasetVersionRecord[]>;
  compare(
    workspaceId: string,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<DatasetVersionComparison>;
  reproduce(
    workspaceId: string,
    versionId: string,
  ): Promise<DatasetVersionReproduction>;
  publish(input: {
    workspaceId: string;
    versionId: string;
    repositoryId: string;
    visibility: "private" | "public";
    createRepository?: boolean;
    publicAccessConfirmed?: true;
  }): Promise<DatasetVersionPublicationRecord>;
}

export interface DatasetVersionPanelProps {
  workspaceId: string;
  datasetArtifactKey: string;
  currentVersionId?: string;
  datasetId?: string;
  service: DatasetVersionPanelService;
  onReuse?: (reproduction: DatasetVersionReproduction, context: {
    workspaceId: string;
    datasetArtifactKey: string;
    selectedVersion: DatasetVersionRecord;
  }) => boolean | Promise<boolean>;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function comparisonMessages(comparison: DatasetVersionComparison): string[] {
  if (comparison.identical) return ["No data or setup changes were found."];
  const messages: string[] = [];
  if (comparison.rowDelta !== 0)
    messages.push(
      `${Math.abs(comparison.rowDelta)} ${comparison.rowDelta > 0 ? "more" : "fewer"} rows`,
    );
  const sourceChanges =
    comparison.sources.added +
    comparison.sources.removed +
    comparison.sources.changed;
  if (sourceChanges > 0)
    messages.push(
      `${sourceChanges} source ${sourceChanges === 1 ? "change" : "changes"}`,
    );
  if (comparison.recipeChanged) messages.push("Preparation setup changed");
  if (comparison.qualityPolicyChanged) messages.push("Data checks changed");
  if (comparison.changedArtifactRoles.length > 0)
    messages.push("Saved data files changed");
  return messages.length > 0 ? messages : ["Documentation changed"];
}

// A changed selection/workspace gets a new session before any old reply can render.
export function DatasetVersionPanel(props: DatasetVersionPanelProps) {
  return <DatasetVersionSession key={JSON.stringify([props.workspaceId, props.datasetArtifactKey,
    props.currentVersionId, props.datasetId])} {...props} />;
}

function DatasetVersionSession({ workspaceId, datasetArtifactKey, currentVersionId,
  datasetId, service, onReuse }: DatasetVersionPanelProps) {
  const titleId = useId();
  const [versions, setVersions] = useState<readonly DatasetVersionRecord[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [comparison, setComparison] = useState<DatasetVersionComparison>();
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [comparisonState, setComparisonState] = useState<"idle" | "loading" | "failed">("idle");
  const [refresh, setRefresh] = useState(0);
  const [compareRefresh, setCompareRefresh] = useState(0);
  const [repositoryId, setRepositoryId] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [createRepository, setCreateRepository] = useState(false);
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [busy, setBusy] = useState<"reuse" | "publish" | undefined>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const session = useRef(0);
  const operation = useRef(false);
  const inputs = useRef(0);
  // Service replacement and unmount retire every read/action from that session.
  useLayoutEffect(() => {
    const id = ++session.current;
    operation.current = false;
    setBusy(undefined);
    setReadState("loading");
    setVersions([]);
    setSelectedVersionId("");
    setNotice(undefined);
    setError(undefined);
    setPublicConfirmed(false);
    return () => { if (session.current === id) ++session.current; };
  }, [service]);

  const selected = versions.find(version => version.versionId === selectedVersionId);
  const displayGroups = useMemo(() => groupDatasetVersionsForDisplay(versions), [versions]);
  useEffect(() => {
    let active = true;
    const scope = session.current;
    setReadState("loading"); setVersions([]); setSelectedVersionId("");
    setComparison(undefined); setPublicConfirmed(false);
    void (async () => {
      try {
        const raw = await service.list(workspaceId, datasetId);
        if (!active || scope !== session.current) return;
        if (!Array.isArray(raw) || raw.length > 1000) throw new Error();
        const items = raw.map(normalizeDatasetVersionRecord);
        if (items.some(item => item.workspaceId !== workspaceId || (datasetId && item.datasetId !== datasetId)) ||
            new Set(items.map(item => item.versionId)).size !== items.length) throw new Error();
        const matches = items.filter(item => item.artifacts.some(artifact =>
          artifact.role === "dataset" && artifact.artifactKey === datasetArtifactKey));
        if (matches.length > 1 || (currentVersionId && matches[0]?.versionId !== currentVersionId)) throw new Error();
        const exact = matches[0];
        setVersions(exact ? items.filter(item => item.datasetId === exact.datasetId) : []);
        setSelectedVersionId(exact?.versionId ?? ""); setReadState("ready");
      } catch {
        if (active && scope === session.current) setReadState("failed");
      }
    })();
    return () => { active = false; };
  }, [currentVersionId, datasetArtifactKey, datasetId, refresh, service, workspaceId]);

  useEffect(() => {
    let active = true;
    const scope = session.current;
    setComparison(undefined); setComparisonState("idle");
    const group = displayGroups.find(item => item.versions.some(entry => entry.version.versionId === selectedVersionId));
    const index = group?.versions.findIndex(entry => entry.version.versionId === selectedVersionId) ?? -1;
    const previous = index >= 0 ? group?.versions[index + 1]?.version : undefined;
    if (!previous || !selected) return;
    setComparisonState("loading");
    void (async () => {
      try {
        const value = await service.compare(workspaceId, previous.versionId, selected.versionId);
        if (!active || scope !== session.current) return;
        if (!value || value.fromVersionId !== previous.versionId || value.toVersionId !== selected.versionId ||
            !Number.isSafeInteger(value.rowDelta) || typeof value.identical !== "boolean" ||
            !value.sources || [value.sources.added, value.sources.removed, value.sources.changed].some(n => !Number.isSafeInteger(n) || n < 0) ||
            !Array.isArray(value.changedArtifactRoles) || value.changedArtifactRoles.length > 100 ||
            value.changedArtifactRoles.some(role => typeof role !== "string" || role.length > 64) ||
            [value.recipeChanged, value.qualityPolicyChanged, value.documentationChanged].some(flag => typeof flag !== "boolean")) throw new Error();
        setComparison(value); setComparisonState("idle");
      } catch {
        if (active && scope === session.current) setComparisonState("failed");
      }
    })();
    return () => { active = false; };
  }, [displayGroups, selected, selectedVersionId, service, workspaceId, compareRefresh]);

  const reuse = async () => {
    if (!selected || !onReuse || operation.current || readState !== "ready") return;
    operation.current = true; setBusy("reuse"); setError(undefined); setNotice(undefined);
    const scope = session.current;
    const inputVersion = inputs.current;
    try {
      const reproduction = await service.reproduce(workspaceId, selected.versionId);
      if (scope !== session.current || inputVersion !== inputs.current) return;
      if (reproduction.versionId !== selected.versionId) throw new Error();
      // The consumer must validate the full recipe and acknowledge actual application.
      const applied = await onReuse(reproduction, { workspaceId, datasetArtifactKey, selectedVersion: selected });
      if (scope !== session.current || inputVersion !== inputs.current) return;
      if (applied === true) setNotice("Saved setup loaded. Review it before preparing again.");
      else setError("Saved setup was not applied. Your setup was not changed.");
    } catch {
      if (scope === session.current && inputVersion === inputs.current) setError("Saved setup could not be loaded. Your setup was not changed.");
    } finally {
      if (scope === session.current) { operation.current = false; setBusy(undefined); }
    }
  };

  const publish = async () => {
    if (!selected || operation.current || readState !== "ready") return;
    const repository = repositoryId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(repository)) {
      setError("Enter a repository in owner/name format."); return;
    }
    if (visibility === "public" && !publicConfirmed) {
      setError("Confirm that this dataset may be publicly accessible."); return;
    }
    const request = { workspaceId, versionId: selected.versionId, repositoryId: repository, visibility,
      ...(createRepository ? { createRepository: true } : {}),
      ...(visibility === "public" ? { publicAccessConfirmed: true as const } : {}) };
    const scope = session.current;
    const inputVersion = inputs.current;
    operation.current = true; setBusy("publish"); setError(undefined); setNotice(undefined);
    setPublicConfirmed(false);
    try {
      const result = await service.publish(request);
      if (scope !== session.current || inputVersion !== inputs.current) return;
      const publication = normalizeDatasetVersionPublicationRecord(result);
      if (publication.workspaceId !== request.workspaceId || publication.versionId !== request.versionId ||
          publication.repositoryId !== request.repositoryId || publication.visibility !== request.visibility) throw new Error();
      setNotice(`Dataset published ${request.visibility === "public" ? "publicly" : "privately"} to ${request.repositoryId}.`);
    } catch {
      if (scope === session.current && inputVersion === inputs.current) setError("Publication could not be confirmed. Check the repository before trying again.");
    } finally {
      if (scope === session.current) { operation.current = false; setBusy(undefined); }
    }
  };

  return (
    <section
      className="ui-stack ui-stack--sm"
      aria-labelledby={titleId}
    >
      <h3 id={titleId}>Saved versions</h3>
      {readState === "loading" ? <p role="status">Loading saved versions…</p> : null}
      {readState === "failed" ? <p role="status">Version history could not be loaded. Try again.</p> : null}
      {readState === "ready" && versions.length === 0 ? <p>No saved dataset version matches this file.</p> : null}
      <button type="button" className="ui-button" disabled={readState === "loading" || Boolean(busy)}
        onClick={() => setRefresh(value => value + 1)}>
        {readState === "failed" ? "Retry version history" : "Refresh versions"}
      </button>
      <p className="ui-text-muted">
        Inspect completed dataset versions and publish a selected version when ready.
      </p>
      {versions.length > 0 ? <label className="ui-stack ui-stack--sm">
        <span>Version</span>
        <select
          className="ui-input"
          value={selectedVersionId}
          disabled={Boolean(busy) || readState !== "ready"}
          onChange={(event) => {
            ++inputs.current;
            setSelectedVersionId(event.target.value);
            setComparison(undefined);
            setPublicConfirmed(false); setNotice(undefined); setError(undefined);
          }}
        >
          {displayGroups.map((group) => (
            <optgroup key={group.datasetId} label={group.name}>
              {group.versions.map((entry) => (
                <option
                  key={entry.version.versionId}
                  value={entry.version.versionId}
                >
                  Version {entry.label}
                  {entry.latest ? " - Latest" : ""} -{" "}
                  {dateLabel(entry.version.createdAt)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label> : null}
      {selected ? (
        <>
          <dl className="ui-grid ui-grid--two">
            <dt>Rows</dt>
            <dd>{selected.totalRows}</dd>
            <dt>Saved</dt>
            <dd>{dateLabel(selected.createdAt)}</dd>
          </dl>
          {comparisonState === "loading" ? <p role="status">Comparing versions…</p> : null}
          {comparisonState === "failed" ? <div><p role="status">Versions could not be compared.</p>
            <button type="button" className="ui-button" onClick={() => setCompareRefresh(value => value + 1)}>Retry comparison</button></div> : null}
          {comparison ? (
            <div>
              <h4>What changed</h4>
              <ul>
                {comparisonMessages(comparison).map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {onReuse ? <button className="ui-button" type="button" disabled={Boolean(busy)} onClick={() => void reuse()}>
            {busy === "reuse" ? "Loading setup…" : "Use this setup again"}
          </button> : null}
          <details>
            <summary>Publish this version</summary>
            <div className="ui-stack ui-stack--sm">
              <p className="ui-text-muted">
                Private is recommended. Publishing sends this saved version and
                its documentation in one update.
              </p>
              <fieldset disabled={Boolean(busy)} className="ui-stack ui-stack--sm">
              <legend>Publication settings</legend>
              <label>
                Repository{" "}
                <input
                  className="ui-input"
                  placeholder="owner/dataset-name"
                  value={repositoryId}
                  onChange={(event) => { ++inputs.current; setRepositoryId(event.target.value); setPublicConfirmed(false); }}
                />
              </label>
              <label>
                Access{" "}
                <select
                  className="ui-input"
                  value={visibility}
                  onChange={(event) => {
                    ++inputs.current;
                    setVisibility(event.target.value as "private" | "public");
                    setPublicConfirmed(false);
                  }}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createRepository}
                  onChange={(event) =>
                    { ++inputs.current; setCreateRepository(event.target.checked); setPublicConfirmed(false); }
                  }
                />{" "}
                Create the repository if it does not exist
              </label>
              {visibility === "public" ? (
                <label>
                  <input
                    type="checkbox"
                    checked={publicConfirmed}
                    onChange={(event) =>
                      setPublicConfirmed(event.target.checked)
                    }
                  />{" "}
                  I understand this dataset will be publicly accessible
                </label>
              ) : null}
              <button
                className="ui-button"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void publish()}
              >
                {busy === "publish"
                  ? "Publishing…"
                  : `Publish ${visibility === "public" ? "publicly" : "privately"}`}
              </button>
              </fieldset>
            </div>
          </details>
          <details>
            <summary>Advanced details</summary>
            <dl className="ui-grid ui-grid--two">
              <dt>Version ID</dt>
              <dd>{selected.versionId}</dd>
              <dt>Version digest</dt>
              <dd>{selected.versionDigest}</dd>
              <dt>Recipe digest</dt>
              <dd>{selected.lineage.recipe.digest}</dd>
            </dl>
            <ul>
              {selected.artifacts.map((artifact) => (
                <li key={`${artifact.role}:${artifact.artifactKey}`}>
                  {artifact.role}: {artifact.digest}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
      <TransientNotificationPublisher
        message={notice}
        title="Dataset versions updated"
        tone="success"
        source="Artifact Browser"
        workspaceId={workspaceId}
      />
      <TransientNotificationPublisher
        message={error}
        title="Dataset versions need attention"
        tone="error"
        source="Artifact Browser"
        workspaceId={workspaceId}
      />
    </section>
  );
}
