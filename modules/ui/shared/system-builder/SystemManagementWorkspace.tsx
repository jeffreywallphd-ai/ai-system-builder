import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  SystemBuilderComposerAsset,
  SystemBuilderManagementItem,
  SystemBuilderManagementSort,
  SystemBuilderManagementView,
  SystemBuilderRevision,
} from "../../../contracts/system-builder";
import { ModalDialog } from "../components/ModalDialog";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";
import { SystemCompositionPreview } from "./SystemCompositionPreview";
import type { SystemBuilderClient } from "./SystemBuilderWorkspace";

const PAGE_SIZE = 25;

export interface SystemManagementWorkspaceProps {
  readonly workspaceId: string;
  readonly client: SystemBuilderClient;
  readonly onOpenInCompose: (systemId: string) => void;
  readonly onActiveSystemsChanged?: () => void;
}

interface PreviewState {
  readonly item: SystemBuilderManagementItem;
  readonly revision: SystemBuilderRevision;
  readonly catalog: readonly SystemBuilderComposerAsset[];
}

function formatUpdatedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function publicationLabel(item: SystemBuilderManagementItem): string {
  if (item.publicationStatus === "published") return "Published";
  if (item.publicationStatus === "draft-changes") {
    return "Unpublished changes";
  }
  return "Draft";
}

function publicationBadgeClass(item: SystemBuilderManagementItem): string {
  if (item.publicationStatus === "published") return "ui-badge--info";
  if (item.publicationStatus === "draft-changes") return "ui-badge--warning";
  return "";
}

export function SystemManagementWorkspace({
  workspaceId,
  client,
  onOpenInCompose,
  onActiveSystemsChanged,
}: SystemManagementWorkspaceProps) {
  const [items, setItems] = useState<readonly SystemBuilderManagementItem[]>(
    [],
  );
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string>();
  const [searchText, setSearchText] = useState("");
  const [appliedSearchText, setAppliedSearchText] = useState("");
  const [view, setView] = useState<SystemBuilderManagementView>("active");
  const [sort, setSort] = useState<SystemBuilderManagementSort>("updated-desc");
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busySystemId, setBusySystemId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [preview, setPreview] = useState<PreviewState>();
  const [deleteTarget, setDeleteTarget] =
    useState<SystemBuilderManagementItem>();
  const [cloneTarget, setCloneTarget] = useState<SystemBuilderManagementItem>();
  const [cloneName, setCloneName] = useState("");
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const cancelCloneRef = useRef<HTMLButtonElement>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(undefined);
    void client
      .listManagement({
        workspaceId: workspaceId as Parameters<
          SystemBuilderClient["listManagement"]
        >[0]["workspaceId"],
        searchText: appliedSearchText || undefined,
        view,
        sort,
        limit: PAGE_SIZE,
      })
      .then((result) => {
        if (requestId !== requestSequence.current) return;
        if (result.ok) {
          setItems(result.value.items);
          setTotalCount(result.value.totalCount);
          setNextCursor(result.value.nextCursor);
        } else {
          setItems([]);
          setTotalCount(0);
          setNextCursor(undefined);
          setError(result.error.message);
        }
      })
      .finally(() => {
        if (requestId === requestSequence.current) setLoading(false);
      });
  }, [appliedSearchText, client, refreshToken, sort, view, workspaceId]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextSearchText = searchText.trim();
    if (nextSearchText === appliedSearchText) {
      setRefreshToken((current) => current + 1);
    } else {
      setAppliedSearchText(nextSearchText);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(undefined);
    const result = await client.listManagement({
      workspaceId: workspaceId as Parameters<
        SystemBuilderClient["listManagement"]
      >[0]["workspaceId"],
      searchText: appliedSearchText || undefined,
      view,
      sort,
      cursor: nextCursor,
      limit: PAGE_SIZE,
    });
    if (result.ok) {
      setItems((current) => {
        const knownIds = new Set(current.map((item) => String(item.systemId)));
        return [
          ...current,
          ...result.value.items.filter(
            (item) => !knownIds.has(String(item.systemId)),
          ),
        ];
      });
      setTotalCount(result.value.totalCount);
      setNextCursor(result.value.nextCursor);
    } else {
      setError(result.error.message);
    }
    setLoadingMore(false);
  };

  const openPreview = async (item: SystemBuilderManagementItem) => {
    setBusySystemId(String(item.systemId));
    setError(undefined);
    const [revisionResult, catalogResult] = await Promise.all([
      client.readRevision({
        workspaceId,
        systemId: String(item.systemId),
        revisionId: item.currentRevisionId
          ? String(item.currentRevisionId)
          : undefined,
      }),
      client.listComposerAssets({
        workspaceId,
        limit: 200,
      }),
    ]);
    if (!revisionResult.ok) {
      setError(revisionResult.error.message);
    } else if (!catalogResult.ok) {
      setError(catalogResult.error.message);
    } else {
      setPreview({
        item,
        revision: revisionResult.value,
        catalog: catalogResult.value.items,
      });
    }
    setBusySystemId(undefined);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusySystemId(String(deleteTarget.systemId));
    setError(undefined);
    const result = await client.archive({
      workspaceId,
      systemId: String(deleteTarget.systemId),
      expectedRevision: deleteTarget.recordRevision,
    });
    if (result.ok) {
      setDeleteTarget(undefined);
      setNotice(
        `${deleteTarget.name} was removed from active systems and can be restored from the Archived view.`,
      );
      setRefreshToken((current) => current + 1);
      onActiveSystemsChanged?.();
    } else {
      setError(result.error.message);
    }
    setBusySystemId(undefined);
  };

  const restoreSystem = async (item: SystemBuilderManagementItem) => {
    setBusySystemId(String(item.systemId));
    setError(undefined);
    const result = await client.restore({
      workspaceId,
      systemId: String(item.systemId),
      expectedRevision: item.recordRevision,
    });
    if (result.ok) {
      setNotice(`${item.name} was restored to active systems.`);
      setRefreshToken((current) => current + 1);
      onActiveSystemsChanged?.();
    } else {
      setError(result.error.message);
    }
    setBusySystemId(undefined);
  };

  const openCloneDialog = (item: SystemBuilderManagementItem) => {
    setCloneTarget(item);
    setCloneName(`${item.name} copy`);
  };

  const confirmClone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cloneTarget || !cloneName.trim()) return;
    setBusySystemId(String(cloneTarget.systemId));
    setError(undefined);
    const result = await client.clone({
      workspaceId,
      sourceSystemId: String(cloneTarget.systemId),
      name: cloneName.trim(),
    });
    if (result.ok) {
      setCloneTarget(undefined);
      setNotice(`${result.value.name} was created as an unpublished system.`);
      setRefreshToken((current) => current + 1);
      onActiveSystemsChanged?.();
    } else {
      setError(result.error.message);
    }
    setBusySystemId(undefined);
  };

  return (
    <section
      className="system-management ui-stack ui-stack--md"
      aria-labelledby="system-management-title"
    >
      <header className="ui-stack ui-stack--xs">
        <h2 id="system-management-title">Manage systems</h2>
        <p className="ui-text-muted">
          Find drafted and published systems, preview their current revision,
          reopen them in Compose, duplicate them, or manage archived systems.
        </p>
      </header>

      <form className="system-management__filters" onSubmit={submitSearch}>
        <label className="ui-field system-management__search">
          <span>Search systems</span>
          <input
            type="search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Name or description"
          />
        </label>
        <label className="ui-field">
          <span>Show</span>
          <select
            value={view}
            onChange={(event) =>
              setView(event.target.value as SystemBuilderManagementView)
            }
          >
            <option value="active">Active systems</option>
            <option value="all">All systems</option>
            <option value="unpublished">Drafts</option>
            <option value="published">Published</option>
            <option value="draft-changes">Unpublished changes</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="ui-field">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as SystemBuilderManagementSort)
            }
          >
            <option value="updated-desc">Recently updated</option>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
          </select>
        </label>
        <div className="system-management__filter-actions">
          <button type="submit">Search</button>
          <button
            type="button"
            className="ui-button ui-button--outline"
            onClick={() => setRefreshToken((current) => current + 1)}
          >
            Refresh
          </button>
        </div>
      </form>

      <TransientNotificationPublisher message={error} title="Systems need attention" tone="error" source="System Management" workspaceId={workspaceId} />
      <TransientNotificationPublisher message={notice} title="Systems updated" tone="success" source="System Management" workspaceId={workspaceId} />

      {loading ? (
        <p role="status">Loading systems…</p>
      ) : items.length === 0 ? (
        <div className="ui-card ui-stack ui-stack--xs">
          <h3>No systems found</h3>
          <p className="ui-text-muted">
            Adjust the search or view filter, or create a system in Compose.
          </p>
        </div>
      ) : (
        <div className="system-management__table-region">
          <table className="ui-table system-management__table">
            <caption>
              Showing {items.length} of {totalCount} matching systems
            </caption>
            <thead>
              <tr>
                <th scope="col">System</th>
                <th scope="col">State</th>
                <th scope="col">Contents</th>
                <th scope="col">Updated</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const systemId = String(item.systemId);
                const busy = busySystemId === systemId;
                return (
                  <tr key={systemId}>
                    <td data-label="System">
                      <div className="ui-stack ui-stack--xs">
                        <strong>{item.name}</strong>
                        {item.description ? (
                          <span className="ui-text-muted">
                            {item.description}
                          </span>
                        ) : null}
                        <span className="ui-text-muted">
                          Revision {item.recordRevision}
                        </span>
                      </div>
                    </td>
                    <td data-label="State">
                      <div className="system-management__badges">
                        <span
                          className={`ui-badge ${publicationBadgeClass(item)}`.trim()}
                        >
                          {publicationLabel(item)}
                        </span>
                        <span className="ui-badge">{item.designStatus}</span>
                        {item.archived ? (
                          <span className="ui-badge ui-badge--warning">
                            Archived
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td data-label="Contents">
                      {item.assetCount} assets · {item.releaseCount} releases
                    </td>
                    <td data-label="Updated">
                      <time dateTime={item.updatedAt}>
                        {formatUpdatedAt(item.updatedAt)}
                      </time>
                    </td>
                    <td data-label="Actions">
                      <div className="system-management__actions">
                        <button
                          type="button"
                          className="ui-button ui-button--outline"
                          disabled={!item.actions.canPreview || busy}
                          onClick={() => void openPreview(item)}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          className="ui-button ui-button--outline"
                          disabled={!item.actions.canOpenInCompose || busy}
                          onClick={() => onOpenInCompose(systemId)}
                        >
                          Open in Compose
                        </button>
                        {!item.archived ? (
                          <>
                            <button
                              type="button"
                              className="ui-button ui-button--outline"
                              disabled={busy}
                              onClick={() => openCloneDialog(item)}
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              className="ui-button--danger"
                              disabled={!item.actions.canDelete || busy}
                              onClick={() => setDeleteTarget(item)}
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={!item.actions.canRestore || busy}
                            onClick={() => void restoreSystem(item)}
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor ? (
        <button
          type="button"
          className="ui-button ui-button--outline system-management__load-more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? "Loading…" : "Load more systems"}
        </button>
      ) : null}

      <ModalDialog
        open={Boolean(preview)}
        title={preview ? `Preview: ${preview.item.name}` : "System preview"}
        onClose={() => setPreview(undefined)}
        dialogClassName="system-management__preview-dialog"
      >
        {preview ? (
          <SystemCompositionPreview
            systemName={preview.item.name}
            instances={preview.revision.instances}
            placements={preview.revision.placements ?? []}
            rootInstanceRefs={preview.revision.composition.rootInstanceRefs}
            catalog={preview.catalog}
          />
        ) : null}
      </ModalDialog>

      <ModalDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete system?"}
        onClose={() => setDeleteTarget(undefined)}
        closeDisabled={Boolean(busySystemId)}
        descriptionId="system-management-delete-description"
        initialFocusRef={cancelDeleteRef}
        dialogClassName="system-management__confirmation-dialog"
      >
        <div className="ui-stack ui-stack--md">
          <p id="system-management-delete-description">
            This removes the system from active lists. Immutable revisions and
            releases are retained for audit and recovery, and the system can be
            restored from the Archived view.
          </p>
          <div className="system-management__dialog-actions">
            <button
              ref={cancelDeleteRef}
              type="button"
              className="ui-button ui-button--outline"
              disabled={Boolean(busySystemId)}
              onClick={() => setDeleteTarget(undefined)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ui-button--danger"
              disabled={Boolean(busySystemId)}
              onClick={() => void confirmDelete()}
            >
              {busySystemId ? "Deleting…" : "Delete system"}
            </button>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(cloneTarget)}
        title={
          cloneTarget ? `Duplicate ${cloneTarget.name}` : "Duplicate system"
        }
        onClose={() => setCloneTarget(undefined)}
        closeDisabled={Boolean(busySystemId)}
        initialFocusRef={cancelCloneRef}
        dialogClassName="system-management__confirmation-dialog"
      >
        <form className="ui-stack ui-stack--md" onSubmit={confirmClone}>
          <label className="ui-field">
            <span>New system name</span>
            <input
              value={cloneName}
              onChange={(event) => setCloneName(event.target.value)}
              required
            />
          </label>
          <p className="ui-text-muted">
            The duplicate starts as an unpublished system with its own revision
            history.
          </p>
          <div className="system-management__dialog-actions">
            <button
              ref={cancelCloneRef}
              type="button"
              className="ui-button ui-button--outline"
              disabled={Boolean(busySystemId)}
              onClick={() => setCloneTarget(undefined)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(busySystemId) || !cloneName.trim()}
            >
              {busySystemId ? "Duplicating…" : "Duplicate system"}
            </button>
          </div>
        </form>
      </ModalDialog>
    </section>
  );
}
