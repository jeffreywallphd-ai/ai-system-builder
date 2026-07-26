import type { SystemBuildRepositoryPort } from "../../ports/system-build";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import type {
  ListSystemBuilderManagementQuery,
  SystemBuilderManagementItem,
  SystemBuilderManagementPage,
  SystemBuilderManagementSort,
  SystemBuilderManagementView,
  SystemBuilderResult,
} from "../../../contracts/system-builder";
import {
  SYSTEM_BUILDER_MANAGEMENT_SORTS,
  SYSTEM_BUILDER_MANAGEMENT_VIEWS,
  systemBuilderFailure,
  systemBuilderSuccess,
} from "../../../contracts/system-builder";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 200;

export class ListSystemBuilderManagementUseCase {
  public constructor(
    private readonly systems: Pick<SystemBuilderRepositoryPort, "listRecords">,
    private readonly builds: Pick<SystemBuildRepositoryPort, "listReleases">,
  ) {}

  public async execute(
    query: ListSystemBuilderManagementQuery,
  ): Promise<SystemBuilderResult<SystemBuilderManagementPage>> {
    const normalized = normalizeQuery(query);
    if (!normalized) {
      return systemBuilderFailure(
        "system-builder.management-query-invalid",
        "The system management query is invalid.",
      );
    }

    const [records, releases] = await Promise.all([
      this.systems.listRecords(query.workspaceId, true),
      this.builds.listReleases(query.workspaceId),
    ]);
    const releasesBySystem = new Map<string, typeof releases>();
    for (const release of releases) {
      if (release.targetWorkspaceId !== query.workspaceId) continue;
      const systemId = String(release.systemId);
      releasesBySystem.set(systemId, [
        ...(releasesBySystem.get(systemId) ?? []),
        release,
      ]);
    }

    const items = records
      .filter((record) => record.targetWorkspaceId === query.workspaceId)
      .map((record) => {
        const systemReleases = [
          ...(releasesBySystem.get(String(record.systemId)) ?? []),
        ].sort(
          (left, right) =>
            right.approvedAt.localeCompare(left.approvedAt) ||
            String(right.releaseId).localeCompare(String(left.releaseId)),
        );
        const latestRelease = systemReleases[0];
        const publicationStatus = !latestRelease
          ? "unpublished"
          : latestRelease.systemRevisionId === record.currentRevisionId
            ? "published"
            : "draft-changes";
        const archived = record.status === "archived";
        const hasRevision = Boolean(record.currentRevisionId);
        return {
          systemId: record.systemId,
          name: record.name,
          ...(record.description ? { description: record.description } : {}),
          designStatus: record.status,
          archived,
          publicationStatus,
          recordRevision: record.revision,
          ...(record.currentRevisionId
            ? { currentRevisionId: record.currentRevisionId }
            : {}),
          assetCount: record.composition.instanceRefs.length,
          releaseCount: systemReleases.length,
          ...(latestRelease
            ? {
                latestRelease: {
                  releaseId: String(latestRelease.releaseId),
                  systemRevisionId: latestRelease.systemRevisionId,
                  approvedAt: latestRelease.approvedAt,
                },
              }
            : {}),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          actions: {
            canPreview: hasRevision,
            canOpenInCompose: hasRevision && !archived,
            canDelete: !archived,
            canRestore: archived,
            deleteStrategy: "archive",
            ...(!hasRevision
              ? {
                  unavailableReason:
                    "Save a revision before previewing this system.",
                }
              : archived
                ? {
                    unavailableReason:
                      "Restore this system before opening it in Compose.",
                  }
                : {}),
          },
        } satisfies SystemBuilderManagementItem;
      })
      .filter((item) => matchesView(item, normalized.view))
      .filter((item) => matchesSearch(item, normalized.searchText))
      .sort(sortItems(normalized.sort));

    const pageItems = items.slice(
      normalized.offset,
      normalized.offset + normalized.limit,
    );
    const nextOffset = normalized.offset + pageItems.length;
    return systemBuilderSuccess({
      items: pageItems,
      totalCount: items.length,
      ...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
      query: {
        ...(normalized.searchText ? { searchText: normalized.searchText } : {}),
        view: normalized.view,
        sort: normalized.sort,
        limit: normalized.limit,
      },
    });
  }
}

function normalizeQuery(query: ListSystemBuilderManagementQuery) {
  const searchText = query.searchText?.trim();
  const view = query.view ?? "active";
  const sort = query.sort ?? "updated-desc";
  const limit = query.limit ?? DEFAULT_LIMIT;
  if (
    (searchText?.length ?? 0) > MAX_SEARCH_LENGTH ||
    !SYSTEM_BUILDER_MANAGEMENT_VIEWS.includes(view) ||
    !SYSTEM_BUILDER_MANAGEMENT_SORTS.includes(sort) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT ||
    (query.cursor !== undefined && !/^\d+$/.test(query.cursor))
  ) {
    return undefined;
  }
  const offset = query.cursor ? Number(query.cursor) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) return undefined;
  return { searchText, view, sort, limit, offset };
}

function matchesView(
  item: SystemBuilderManagementItem,
  view: SystemBuilderManagementView,
): boolean {
  if (view === "all") return true;
  if (view === "active") return !item.archived;
  if (view === "archived") return item.archived;
  return !item.archived && item.publicationStatus === view;
}

function matchesSearch(
  item: SystemBuilderManagementItem,
  searchText?: string,
): boolean {
  if (!searchText) return true;
  const needle = searchText.toLocaleLowerCase();
  return [item.name, item.description, String(item.systemId)].some((value) =>
    value?.toLocaleLowerCase().includes(needle),
  );
}

function sortItems(sort: SystemBuilderManagementSort) {
  return (
    left: SystemBuilderManagementItem,
    right: SystemBuilderManagementItem,
  ) => {
    const nameOrder = left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
    if (sort === "name-asc")
      return (
        nameOrder || String(left.systemId).localeCompare(String(right.systemId))
      );
    if (sort === "name-desc")
      return (
        -nameOrder ||
        String(left.systemId).localeCompare(String(right.systemId))
      );
    return (
      right.updatedAt.localeCompare(left.updatedAt) ||
      nameOrder ||
      String(left.systemId).localeCompare(String(right.systemId))
    );
  };
}
