import { useEffect, useMemo, useState } from "react";
import {
  groupDatasetVersionsForDisplay,
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
  currentVersionId?: string;
  datasetId?: string;
  service: DatasetVersionPanelService;
  onReuse(reproduction: DatasetVersionReproduction): void;
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

export function DatasetVersionPanel({
  workspaceId,
  currentVersionId,
  datasetId,
  service,
  onReuse,
}: DatasetVersionPanelProps) {
  const [versions, setVersions] = useState<readonly DatasetVersionRecord[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState(
    currentVersionId ?? "",
  );
  const [comparison, setComparison] = useState<DatasetVersionComparison>();
  const [repositoryId, setRepositoryId] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [createRepository, setCreateRepository] = useState(false);
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [busy, setBusy] = useState<"load" | "reuse" | "publish">();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const selected = useMemo(
    () => versions.find((version) => version.versionId === selectedVersionId),
    [selectedVersionId, versions],
  );
  const displayGroups = useMemo(
    () => groupDatasetVersionsForDisplay(versions),
    [versions],
  );

  useEffect(() => {
    let active = true;
    setBusy("load");
    setError(undefined);
    void service
      .list(workspaceId, datasetId)
      .then(async (items) => {
        if (!active) return;
        setVersions(items);
        const newestVersionId =
          groupDatasetVersionsForDisplay(items)[0]?.versions[0]?.version
            .versionId;
        const nextId = currentVersionId ?? newestVersionId ?? "";
        setSelectedVersionId(nextId);
      })
      .catch(() => {
        if (active) setError("Version history could not be loaded.");
      })
      .finally(() => {
        if (active) setBusy(undefined);
      });
    return () => {
      active = false;
    };
  }, [currentVersionId, datasetId, service, workspaceId]);

  useEffect(() => {
    let active = true;
    const group = displayGroups.find((item) =>
      item.versions.some(
        (entry) => entry.version.versionId === selectedVersionId,
      ),
    );
    const index =
      group?.versions.findIndex(
        (entry) => entry.version.versionId === selectedVersionId,
      ) ?? -1;
    const previous =
      index >= 0 ? group?.versions[index + 1]?.version : undefined;
    if (!previous || !selectedVersionId) {
      setComparison(undefined);
      return () => {
        active = false;
      };
    }
    void service
      .compare(workspaceId, previous.versionId, selectedVersionId)
      .then((value) => {
        if (active) setComparison(value);
      })
      .catch(() => {
        if (active) setComparison(undefined);
      });
    return () => {
      active = false;
    };
  }, [displayGroups, selectedVersionId, service, workspaceId]);

  const reuse = async () => {
    if (!selected) return;
    setBusy("reuse");
    setError(undefined);
    try {
      onReuse(await service.reproduce(workspaceId, selected.versionId));
      setNotice("Saved setup loaded. Review it before preparing again.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Saved setup could not be loaded.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const publish = async () => {
    if (!selected || !repositoryId.trim()) {
      setError("Enter a repository in owner/name format.");
      return;
    }
    if (visibility === "public" && !publicConfirmed) {
      setError("Confirm that this dataset may be publicly accessible.");
      return;
    }
    setBusy("publish");
    setError(undefined);
    try {
      const publication = await service.publish({
        workspaceId,
        versionId: selected.versionId,
        repositoryId: repositoryId.trim(),
        visibility,
        ...(createRepository ? { createRepository: true } : {}),
        ...(visibility === "public"
          ? { publicAccessConfirmed: true as const }
          : {}),
      });
      setNotice(
        `Dataset published ${publication.visibility === "public" ? "publicly" : "privately"} to ${publication.repositoryId}.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Dataset version could not be published.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  if (busy === "load" && versions.length === 0)
    return <p className="ui-text-muted">Loading saved versions…</p>;
  if (versions.length === 0) return null;

  return (
    <section
      className="ui-stack ui-stack--sm"
      aria-labelledby="dataset-version-history-title"
    >
      <h3 id="dataset-version-history-title">Saved versions</h3>
      <p className="ui-text-muted">
        Every completed dataset is saved as a version you can compare, reuse, or
        publish later.
      </p>
      <label className="ui-stack ui-stack--sm">
        <span>Version</span>
        <select
          className="ui-input"
          value={selectedVersionId}
          onChange={(event) => {
            setSelectedVersionId(event.target.value);
            setComparison(undefined);
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
      </label>
      {selected ? (
        <>
          <dl className="ui-grid ui-grid--two">
            <dt>Rows</dt>
            <dd>{selected.totalRows}</dd>
            <dt>Saved</dt>
            <dd>{dateLabel(selected.createdAt)}</dd>
          </dl>
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
          <button
            className="ui-button"
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void reuse()}
          >
            {busy === "reuse" ? "Loading setup…" : "Use this setup again"}
          </button>
          <details>
            <summary>Publish this version</summary>
            <div className="ui-stack ui-stack--sm">
              <p className="ui-text-muted">
                Private is recommended. Publishing sends this saved version and
                its documentation in one update.
              </p>
              <label>
                Repository{" "}
                <input
                  className="ui-input"
                  placeholder="owner/dataset-name"
                  value={repositoryId}
                  onChange={(event) => setRepositoryId(event.target.value)}
                />
              </label>
              <label>
                Access{" "}
                <select
                  className="ui-input"
                  value={visibility}
                  onChange={(event) => {
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
                    setCreateRepository(event.target.checked)
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
        source="Dataset Preparation"
        workspaceId={workspaceId}
      />
      <TransientNotificationPublisher
        message={error}
        title="Dataset versions need attention"
        tone="error"
        source="Dataset Preparation"
        workspaceId={workspaceId}
      />
    </section>
  );
}
