import { describe, expect, it } from "../../../../testing/node-test";
import type { SystemBuildRepositoryPort } from "../../../ports/system-build";
import type { SystemBuilderRepositoryPort } from "../../../ports/system-builder";
import type { SystemRelease } from "../../../../contracts/system-build";
import {
  normalizeSystemBuilderRevisionId,
  normalizeSystemBuilderSystemId,
  type SystemBuilderRecord,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ListSystemBuilderManagementUseCase } from "../list-system-builder-management.use-case";

describe("ListSystemBuilderManagementUseCase", () => {
  it("derives truthful publication state and deterministic bounded pages", async () => {
    const fixture = createFixture();
    const first = await fixture.useCase.execute({
      workspaceId: fixture.workspaceA,
      view: "active",
      sort: "name-asc",
      limit: 2,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.items.map((item) => item.name)).toEqual([
      "Alpha draft",
      "Beta published",
    ]);
    expect(first.value.items.map((item) => item.publicationStatus)).toEqual([
      "unpublished",
      "published",
    ]);
    expect(first.value.totalCount).toBe(3);
    expect(first.value.nextCursor).toBe("2");

    const second = await fixture.useCase.execute({
      workspaceId: fixture.workspaceA,
      view: "active",
      sort: "name-asc",
      limit: 2,
      cursor: first.value.nextCursor,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.items.length).toBe(1);
    expect(second.value.items[0]?.publicationStatus).toBe("draft-changes");
    expect(second.value.nextCursor).toBeUndefined();
  });

  it("isolates workspaces and supports search, lifecycle views, and action eligibility", async () => {
    const fixture = createFixture();
    const archived = await fixture.useCase.execute({
      workspaceId: fixture.workspaceA,
      view: "archived",
      searchText: "retained",
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.value.items.length).toBe(1);
    expect(archived.value.items[0]).toMatchObject({
      name: "Retained archive",
      archived: true,
      releaseCount: 1,
      actions: {
        canDelete: false,
        canRestore: true,
        canOpenInCompose: false,
        deleteStrategy: "archive",
      },
    });

    const published = await fixture.useCase.execute({
      workspaceId: fixture.workspaceA,
      view: "published",
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.items.map((item) => item.name)).toEqual([
      "Beta published",
    ]);
    expect(
      published.value.items.some((item) => item.name === "Other workspace"),
    ).toBe(false);
  });

  it("rejects malformed cursors, excessive searches, and out-of-range limits", async () => {
    const fixture = createFixture();
    for (const query of [
      { cursor: "-1" },
      { cursor: "not-a-cursor" },
      { limit: 0 },
      { limit: 101 },
      { searchText: "x".repeat(201) },
    ]) {
      const result = await fixture.useCase.execute({
        workspaceId: fixture.workspaceA,
        ...query,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "system-builder.management-query-invalid" },
      });
    }
  });
});

function createFixture() {
  const workspaceA = createWorkspaceId("workspace-a");
  const workspaceB = createWorkspaceId("workspace-b");
  const records = [
    record(workspaceA, "system-alpha", "Alpha draft", "alpha.r1", 1),
    record(workspaceA, "system-beta", "Beta published", "beta.r2", 2),
    record(workspaceA, "system-gamma", "Gamma changes", "gamma.r2", 2),
    record(
      workspaceA,
      "system-archive",
      "Retained archive",
      "archive.r1",
      3,
      true,
    ),
    record(workspaceB, "system-other", "Other workspace", "other.r1", 1),
  ];
  const releases = [
    release(
      workspaceA,
      "release-beta",
      "system-beta",
      "beta.r2",
      "2026-07-17T10:00:00.000Z",
    ),
    release(
      workspaceA,
      "release-gamma",
      "system-gamma",
      "gamma.r1",
      "2026-07-17T11:00:00.000Z",
    ),
    release(
      workspaceA,
      "release-archive",
      "system-archive",
      "archive.r1",
      "2026-07-17T12:00:00.000Z",
    ),
    release(
      workspaceB,
      "release-other",
      "system-other",
      "other.r1",
      "2026-07-17T13:00:00.000Z",
    ),
  ];
  const systems = {
    listRecords: async (workspaceId: string) =>
      records.filter((item) => item.targetWorkspaceId === workspaceId),
  } as Pick<SystemBuilderRepositoryPort, "listRecords">;
  const builds = {
    listReleases: async (workspaceId: string) =>
      releases.filter((item) => item.targetWorkspaceId === workspaceId),
  } as Pick<SystemBuildRepositoryPort, "listReleases">;
  return {
    workspaceA,
    useCase: new ListSystemBuilderManagementUseCase(systems, builds),
  };
}

function record(
  workspaceId: ReturnType<typeof createWorkspaceId>,
  systemId: string,
  name: string,
  revisionId: string,
  revision: number,
  archived = false,
): SystemBuilderRecord {
  return {
    systemId: normalizeSystemBuilderSystemId(systemId),
    targetWorkspaceId: workspaceId,
    name,
    status: archived ? "archived" : "validated",
    revision,
    currentRevisionId: normalizeSystemBuilderRevisionId(revisionId),
    composition: {
      instanceRefs: [{ kind: "asset-instance", id: `${systemId}.root` }],
    } as SystemBuilderRecord["composition"],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: `2026-07-17T0${revision}:00:00.000Z`,
    createdBy: "person-1",
    updatedBy: "person-1",
    ...(archived ? { archivedAt: "2026-07-17T14:00:00.000Z" } : {}),
  };
}

function release(
  workspaceId: ReturnType<typeof createWorkspaceId>,
  releaseId: string,
  systemId: string,
  revisionId: string,
  approvedAt: string,
): SystemRelease {
  return {
    releaseId,
    targetWorkspaceId: workspaceId,
    systemId: normalizeSystemBuilderSystemId(systemId),
    systemRevisionId: normalizeSystemBuilderRevisionId(revisionId),
    approvedAt,
  } as SystemRelease;
}
