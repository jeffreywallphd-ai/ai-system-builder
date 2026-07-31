import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DatasetReviewDatasetGroup,
  DatasetReviewRowEditResult,
  DatasetReviewPage,
  DatasetReviewPageSize,
  DatasetReviewRowRejectionResult,
} from "../../../contracts/dataset";
import { TransientNotificationPublisher } from "../notifications/TransientNotificationPublisher";
import {
  DatasetReviewApproveButton,
  DatasetReviewModal,
  type ReviewDecision,
  type ReviewNavigatorItem,
} from "./DatasetReviewModal";

export interface DatasetReviewWorkspaceService {
  listTargets(
    workspaceId: string,
  ): Promise<readonly DatasetReviewDatasetGroup[]>;
  readPage(input: {
    workspaceId: string;
    artifactKey: string;
    versionId?: string;
    page: number;
    pageSize: DatasetReviewPageSize;
  }): Promise<DatasetReviewPage>;
  rejectRow(input: {
    workspaceId: string;
    artifactKey: string;
    versionId?: string;
    rowIndex: number;
    rowFingerprint: `sha256:${string}`;
  }): Promise<DatasetReviewRowRejectionResult>;
  editRow(input: {
    workspaceId: string;
    artifactKey: string;
    versionId?: string;
    rowIndex: number;
    rowFingerprint: `sha256:${string}`;
    values: Readonly<Record<string, unknown>>;
  }): Promise<DatasetReviewRowEditResult>;
}

export function DatasetReviewWorkspace({
  workspaceId,
  service,
}: {
  readonly workspaceId: string;
  readonly service: DatasetReviewWorkspaceService;
}) {
  const [groups, setGroups] = useState<readonly DatasetReviewDatasetGroup[]>(
    [],
  );
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [pageNumber, setPageNumber] = useState(0);
  const pageSize: DatasetReviewPageSize = 10;
  const [page, setPage] = useState<DatasetReviewPage>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>(
    {},
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string>();
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const modalPageEntry = useRef<"first" | "last">("first");
  const [busy, setBusy] = useState<"groups" | "page" | "save">();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const selectedGroup = groups.find(
    (group) => group.groupId === selectedGroupId,
  );
  const selectedVersion =
    selectedGroup?.versions.find((version) =>
      selectedVersionId
        ? String(version.versionId ?? version.artifactKey) === selectedVersionId
        : version.latest,
    ) ?? selectedGroup?.versions.find((version) => version.latest);

  const loadGroups = useCallback(async () => {
    setBusy("groups");
    setError(undefined);
    try {
      const next = await service.listTargets(workspaceId);
      setGroups(next);
      setSelectedGroupId((current) =>
        next.some((group) => group.groupId === current)
          ? current
          : (next[0]?.groupId ?? ""),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Workspace datasets could not be loaded.",
      );
    } finally {
      setBusy(undefined);
    }
  }, [service, workspaceId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!selectedVersion) {
      setPage(undefined);
      return;
    }
    let active = true;
    setBusy("page");
    setError(undefined);
    void service
      .readPage({
        workspaceId,
        artifactKey: selectedVersion.artifactKey,
        ...(selectedVersion.versionId
          ? { versionId: String(selectedVersion.versionId) }
          : {}),
        page: pageNumber,
        pageSize,
      })
      .then((next) => {
        if (!active) return;
        setPage(next);
        setCurrentIndex(
          modalPageEntry.current === "last"
            ? Math.max(0, next.rows.length - 1)
            : 0,
        );
        modalPageEntry.current = "first";
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Dataset rows could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setBusy(undefined);
      });
    return () => {
      active = false;
    };
  }, [
    pageNumber,
    pageSize,
    selectedVersion?.artifactKey,
    selectedVersion?.versionId,
    service,
    workspaceId,
  ]);

  const items = useMemo<readonly ReviewNavigatorItem[]>(
    () =>
      (page?.rows ?? []).map((row) => {
        const id = `${page?.artifactKey}:${row.rowFingerprint}`;
        return {
          id,
          title: `Row ${row.rowIndex + 1}`,
          editable: row.editable !== false,
          approvalLocked: true,
          summary:
            editingItemId === id
              ? "Edit the values, then approve changes to create a new dataset version."
              : row.editable === false
                ? "Review this row below. It is too large or contains values that cannot be safely edited."
                : "Review the complete training record below.",
          content:
            editingItemId === id ? (
              <DatasetRowEditor
                values={row.values}
                draft={editDraft}
                onChange={(name, value) =>
                  setEditDraft((current) => ({ ...current, [name]: value }))
                }
              />
            ) : (
              <dl className="dataset-review__values">
                {Object.entries(row.values).map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      <pre>{formatValue(value)}</pre>
                    </dd>
                  </div>
                ))}
              </dl>
            ),
        };
      }),
    [editDraft, editingItemId, page],
  );

  const advance = (
    item: ReviewNavigatorItem,
    decision: ReviewDecision,
    moveNext = true,
  ) => {
    setDecisions((current) => ({ ...current, [item.id]: decision }));
    if (moveNext) {
      setCurrentIndex((index) =>
        Math.min(index + 1, Math.max(0, items.length - 1)),
      );
    }
  };

  const approve = async (item: ReviewNavigatorItem) => {
    advance(item, "approved");
  };

  const reject = async (item: ReviewNavigatorItem) => {
    if (editingItemId === item.id) {
      setEditingItemId(undefined);
      setEditDraft({});
    }
    advance(item, "rejected");
  };

  const beginEdit = (item: ReviewNavigatorItem) => {
    const row = page?.rows.find(
      (candidate) =>
        item.id === `${page.artifactKey}:${candidate.rowFingerprint}`,
    );
    if (!row) return;
    if (row.editable === false) {
      setError(
        "This row is too large or contains values that cannot be safely edited.",
      );
      return;
    }
    setEditingItemId(item.id);
    setEditDraft(
      Object.fromEntries(
        Object.entries(row.values).map(([name, value]) => [
          name,
          editableValue(value),
        ]),
      ),
    );
  };

  const cancelEdit = () => {
    setEditingItemId(undefined);
    setEditDraft({});
    setError(undefined);
  };

  const approveChanges = async (item: ReviewNavigatorItem) => {
    const row = page?.rows.find(
      (candidate) =>
        item.id === `${page.artifactKey}:${candidate.rowFingerprint}`,
    );
    if (!row || !selectedVersion || editingItemId !== item.id) return;
    let values: Record<string, unknown>;
    try {
      values = Object.fromEntries(
        Object.entries(row.values).map(([name, original]) => [
          name,
          parseEditableValue(editDraft[name] ?? "", original),
        ]),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The edited values could not be read.",
      );
      return;
    }
    setBusy("save");
    setError(undefined);
    try {
      const result = await service.editRow({
        workspaceId,
        artifactKey: selectedVersion.artifactKey,
        ...(selectedVersion.versionId
          ? { versionId: String(selectedVersion.versionId) }
          : {}),
        rowIndex: row.rowIndex,
        rowFingerprint: row.rowFingerprint,
        values,
      });
      setDecisions((current) => ({ ...current, [item.id]: "approved" }));
      setEditingItemId(undefined);
      setEditDraft({});
      setNotice(
        `Changes approved. Dataset version ${result.versionLabel} was created.`,
      );
      const nextGroups = await service.listTargets(workspaceId);
      setGroups(nextGroups);
      const nextGroup = nextGroups.find((group) =>
        group.versions.some(
          (version) => version.versionId === result.version.versionId,
        ),
      );
      if (nextGroup) {
        setSelectedGroupId(nextGroup.groupId);
        setSelectedVersionId(String(result.version.versionId));
      }
      setPageNumber(0);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The selected row could not be edited.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const navigatorProps = {
    items,
    currentIndex,
    decisions,
    busy: busy === "save",
    approveLabel: "Approve row",
    rejectLabel: "Reject row",
    editLabel: "Edit",
    approveChangesLabel: "Approve changes",
    editing: Boolean(
      editingItemId && items[currentIndex]?.id === editingItemId,
    ),
    absoluteIndex: page
      ? page.page * page.pageSize + currentIndex
      : currentIndex,
    totalItems: page?.totalRows ?? items.length,
    previousDisabled: !page || page.page * page.pageSize + currentIndex === 0,
    nextDisabled:
      !page || page.page * page.pageSize + currentIndex >= page.totalRows - 1,
    onCurrentIndexChange: setCurrentIndex,
    onApprove: approve,
    onReject: reject,
    onEdit: beginEdit,
    onApproveChanges: approveChanges,
    onCancelEdit: cancelEdit,
    onPrevious: () => {
      if (currentIndex > 0) {
        setCurrentIndex((value) => value - 1);
      } else if (pageNumber > 0) {
        modalPageEntry.current = "last";
        setPageNumber((value) => value - 1);
      }
    },
    onNext: () => {
      if (currentIndex < items.length - 1) {
        setCurrentIndex((value) => value + 1);
      } else if (page && (pageNumber + 1) * pageSize < page.totalRows) {
        modalPageEntry.current = "first";
        setPageNumber((value) => value + 1);
      }
    },
  } as const;

  const tableColumns = useMemo(() => {
    const names = new Set<string>();
    for (const row of page?.rows ?? []) {
      Object.keys(row.values).forEach((name) => names.add(name));
    }
    return [...names];
  }, [page]);

  return (
    <section
      className="dataset-review ui-stack ui-stack--lg"
      aria-labelledby="dataset-review-title"
    >
      <header className="ui-stack ui-stack--sm">
        <h2 id="dataset-review-title">Dataset Review</h2>
        <p className="ui-text-muted">
          Review every row in a local workspace Parquet dataset. Editing and
          approving changes preserves the original and creates the next minor
          version.
        </p>
      </header>
      {groups.length === 0 && busy !== "groups" ? (
        <p className="ui-empty-state">
          No local Parquet datasets are available in this workspace. Localize a
          repository file before reviewing it.
        </p>
      ) : (
        <div className="dataset-review__card-grid">
          {groups.map((group) => {
            const active = group.groupId === selectedGroupId;
            const version = active
              ? selectedVersion
              : group.versions.find((item) => item.latest);
            return (
              <article
                className="ui-panel ui-stack ui-stack--sm"
                key={group.groupId}
              >
                <h3>{group.name}</h3>
                <label>
                  Version
                  <select
                    className="ui-input"
                    value={
                      active
                        ? selectedVersionId ||
                          String(
                            version?.versionId ?? version?.artifactKey ?? "",
                          )
                        : String(
                            version?.versionId ?? version?.artifactKey ?? "",
                          )
                    }
                    onChange={(event) => {
                      setSelectedGroupId(group.groupId);
                      setSelectedVersionId(event.target.value);
                      setEditingItemId(undefined);
                      setEditDraft({});
                      modalPageEntry.current = "first";
                      setPageNumber(0);
                    }}
                  >
                    {group.versions.map((option) => (
                      <option
                        key={String(option.versionId ?? option.artifactKey)}
                        value={String(option.versionId ?? option.artifactKey)}
                      >
                        {option.label}
                        {option.latest ? " - Latest" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="ui-text-muted">
                  {version?.totalRows === undefined
                    ? "Row count available when opened"
                    : `${version.totalRows} rows`}
                </p>
                <div className="ui-actions">
                  <button
                    className="ui-button"
                    type="button"
                    onClick={() => {
                      setSelectedGroupId(group.groupId);
                      setSelectedVersionId(
                        String(
                          version?.versionId ?? version?.artifactKey ?? "",
                        ),
                      );
                      setPageNumber(0);
                      setCurrentIndex(0);
                      setEditingItemId(undefined);
                      setEditDraft({});
                      modalPageEntry.current = "first";
                      setModalOpen(true);
                    }}
                  >
                    Review rows
                  </button>
                  <button
                    className="ui-button ui-button--outline"
                    type="button"
                    onClick={() => {
                      setSelectedGroupId(group.groupId);
                      setSelectedVersionId(
                        String(
                          version?.versionId ?? version?.artifactKey ?? "",
                        ),
                      );
                      setPageNumber(0);
                      setCurrentIndex(0);
                      setEditingItemId(undefined);
                      setEditDraft({});
                      modalPageEntry.current = "first";
                      setModalOpen(false);
                    }}
                  >
                    View table
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {selectedVersion ? (
        <section
          className="ui-panel ui-stack ui-stack--sm"
          aria-labelledby="dataset-review-rows-title"
        >
          <div className="dataset-review__row-heading ui-cluster">
            <div>
              <h3 id="dataset-review-rows-title">{selectedGroup?.name}</h3>
              <p className="ui-text-muted">
                {page
                  ? `${page.totalRows} rows - Page ${page.page + 1}`
                  : "Loading rows..."}
              </p>
            </div>
            <button
              className="ui-button ui-button--outline"
              type="button"
              disabled={!items.length}
              onClick={() => setModalOpen(true)}
            >
              Review rows
            </button>
          </div>
          <div className="ui-actions">
            <button
              className="ui-button ui-button--outline"
              type="button"
              disabled={pageNumber === 0 || Boolean(busy)}
              onClick={() => {
                modalPageEntry.current = "first";
                setPageNumber((value) => value - 1);
              }}
            >
              Previous page
            </button>
            <button
              className="ui-button ui-button--outline"
              type="button"
              disabled={
                !page ||
                (pageNumber + 1) * pageSize >= page.totalRows ||
                Boolean(busy)
              }
              onClick={() => {
                modalPageEntry.current = "first";
                setPageNumber((value) => value + 1);
              }}
            >
              Next page
            </button>
          </div>
          {busy === "page" ? (
            <p className="ui-text-muted">Loading dataset rows...</p>
          ) : page?.rows.length ? (
            <div className="dataset-review__table-wrap">
              <table className="dataset-review__table">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    {tableColumns.map((column) => (
                      <th scope="col" key={column}>
                        {column}
                      </th>
                    ))}
                    <th className="dataset-review__table-actions" scope="col">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row) => {
                    const item = items.find(
                      (candidate) =>
                        candidate.id ===
                        `${page.artifactKey}:${row.rowFingerprint}`,
                    );
                    if (!item) return null;
                    return (
                      <tr key={item.id}>
                        <th scope="row">{row.rowIndex + 1}</th>
                        {tableColumns.map((column) => (
                          <td key={column}>
                            <pre>{formatValue(row.values[column])}</pre>
                          </td>
                        ))}
                        <td className="dataset-review__table-actions">
                          <div className="ui-actions">
                            <DatasetReviewApproveButton
                              label="Approve"
                              locked
                              className="ui-button ui-button--outline"
                              disabled={Boolean(busy)}
                              onClick={() => void approve(item)}
                            />
                            <button
                              className="ui-button ui-button--danger"
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => void reject(item)}
                            >
                              Reject
                            </button>
                            <button
                              className="ui-button ui-button--outline"
                              type="button"
                              disabled={Boolean(busy) || row.editable === false}
                              title={
                                row.editable === false
                                  ? "This row is too large or contains values that cannot be safely edited."
                                  : undefined
                              }
                              onClick={() => {
                                setCurrentIndex(
                                  page.rows.findIndex(
                                    (candidate) =>
                                      candidate.rowFingerprint ===
                                      row.rowFingerprint,
                                  ),
                                );
                                beginEdit(item);
                                setModalOpen(true);
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ui-empty-state">
              No rows are available on this page.
            </p>
          )}
        </section>
      ) : null}
      <DatasetReviewModal
        open={modalOpen}
        title={
          selectedGroup ? `Review ${selectedGroup.name}` : "Review dataset"
        }
        onClose={() => setModalOpen(false)}
        {...navigatorProps}
      />
      <TransientNotificationPublisher
        message={notice}
        title="Dataset review updated"
        tone="success"
        source="Dataset Review"
        workspaceId={workspaceId}
      />
      <TransientNotificationPublisher
        message={error}
        title="Dataset review needs attention"
        tone="error"
        source="Dataset Review"
        workspaceId={workspaceId}
      />
    </section>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function DatasetRowEditor({
  values,
  draft,
  onChange,
}: {
  readonly values: Readonly<Record<string, unknown>>;
  readonly draft: Readonly<Record<string, string>>;
  readonly onChange: (name: string, value: string) => void;
}) {
  return (
    <div className="dataset-review__editor ui-stack ui-stack--sm">
      {Object.entries(values).map(([name, original]) => (
        <label className="ui-stack ui-stack--xs" key={name}>
          <strong>{name}</strong>
          {typeof original === "boolean" ? (
            <select
              className="ui-input"
              value={draft[name] ?? String(original)}
              onChange={(event) => onChange(name, event.target.value)}
            >
              <option value="true">True</option>
              <option value="false">False</option>
            </select>
          ) : typeof original === "number" ? (
            <input
              className="ui-input"
              type="number"
              step="any"
              value={draft[name] ?? String(original)}
              onChange={(event) => onChange(name, event.target.value)}
            />
          ) : (
            <textarea
              className="ui-input"
              rows={typeof original === "string" ? 4 : 8}
              value={draft[name] ?? editableValue(original)}
              onChange={(event) => onChange(name, event.target.value)}
            />
          )}
          {typeof original === "object" && original !== null ? (
            <small className="ui-text-muted">
              Keep lists and grouped values in valid JSON format.
            </small>
          ) : null}
        </label>
      ))}
    </div>
  );
}

function editableValue(value: unknown): string {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? "" : serialized;
}

function parseEditableValue(raw: string, original: unknown): unknown {
  if (typeof original === "string") return raw;
  if (typeof original === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error("Enter a valid number before approving changes.");
    }
    return value;
  }
  if (typeof original === "boolean") {
    if (raw !== "true" && raw !== "false") {
      throw new Error("Choose True or False before approving changes.");
    }
    return raw === "true";
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Correct the JSON value before approving changes.");
  }
  if (original === null && value !== null) {
    throw new Error("This value must remain empty (null).");
  }
  if (Array.isArray(original) && !Array.isArray(value)) {
    throw new Error("This value must remain a list.");
  }
  if (
    original !== null &&
    typeof original === "object" &&
    !Array.isArray(original) &&
    (value === null || typeof value !== "object" || Array.isArray(value))
  ) {
    throw new Error("This value must remain a group of named values.");
  }
  return value;
}
