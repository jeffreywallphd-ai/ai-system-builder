import { describe, expect, it } from "../../../../testing/node-test";
import type { SystemBuildRepositoryPort } from "../../../ports/system-build";
import {
  systemDataFailure,
  systemDataSuccess,
  type SystemDataFormDescriptor,
} from "../../../../contracts/system-data";
import type { SystemRelease } from "../../../../contracts/system-build";
import { createSystemDataWorkflowHandler } from "../system-data-workflow-handler.service";

const release = {
  releaseId: "release-1",
  targetWorkspaceId: "workspace-1",
  releaseDigest: `sha256:${"a".repeat(64)}`,
} as SystemRelease;
const descriptor: SystemDataFormDescriptor = {
  schemaVersion: "1.0",
  targetWorkspaceId: "workspace-1" as never,
  releaseId: "release-1" as never,
  entityType: "service-request",
  title: "Service requests",
  maximumPageSize: 100,
  fields: [
    {
      name: "summary",
      label: "Summary",
      type: "text",
      required: true,
      maximumLength: 240,
    },
  ],
};
const actor = {
  actorId: "owner-1",
  roles: ["owner"],
  authenticated: true,
} as const;
const source = {
  kind: "approved-release" as const,
  sourceId: "release-1",
  sourceDigest: release.releaseDigest,
  label: "Release 1",
};

const createFixture = () => {
  const calls = { describe: 0, create: 0, list: 0, audit: 0 };
  const builds = {
    readRelease: async (workspaceId: string, releaseId: string) =>
      workspaceId === "workspace-1" && releaseId === "release-1"
        ? release
        : undefined,
    listReleases: async () => [release],
  } as unknown as SystemBuildRepositoryPort;
  const definitions = {
    resolve: async () => ({
      descriptor,
      rolesByAction: {
        create: ["owner"],
        read: ["owner"],
        update: ["owner"],
        list: ["owner"],
      },
      unmaskRoles: ["owner"],
    }),
  };
  const runtime = {
    async describe() {
      calls.describe += 1;
      return systemDataSuccess(descriptor);
    },
    async list() {
      calls.list += 1;
      return systemDataSuccess({
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
      });
    },
    async listAudit() {
      calls.audit += 1;
      return systemDataSuccess([]);
    },
    async create(input: { recordId: string; values: Record<string, unknown> }) {
      calls.create += 1;
      return systemDataSuccess({
        recordId: input.recordId,
        targetWorkspaceId: "workspace-1" as never,
        releaseId: "release-1" as never,
        entityType: "service-request",
        revision: 1,
        values: input.values,
        createdAt: "2026-07-29T00:00:00.000Z",
        createdBy: "owner-1",
        updatedAt: "2026-07-29T00:00:00.000Z",
        updatedBy: "owner-1",
      });
    },
    async read() {
      return systemDataFailure("system-data.not-found", "Not found.");
    },
    async update() {
      return systemDataFailure("system-data.not-found", "Not found.");
    },
  };
  return {
    calls,
    handler: createSystemDataWorkflowHandler({
      builds,
      definitions,
      runtime: runtime as any,
      now: () => "2026-07-29T00:00:00.000Z",
    }),
  };
};

describe("system data workflow handler", () => {
  it("discovers applicable releases without running data operations", async () => {
    const { calls, handler } = createFixture();
    const result = await handler.discover(
      { workspaceId: "workspace-1" },
      actor,
    );
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.length : 0).toBe(1);
    expect(calls).toEqual({ describe: 0, create: 0, list: 0, audit: 0 });
  });

  it("prepares bounded fields, records, actions, and audit through existing use cases", async () => {
    const { calls, handler } = createFixture();
    const result = await handler.prepare(
      {
        workspaceId: "workspace-1",
        profileId: handler.profileId,
        source,
      },
      actor,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.actions.map((action) => action.actionId)).toEqual([
      "refresh",
      "read-record",
      "create-record",
      "update-record",
    ]);
    expect(calls).toEqual({ describe: 1, create: 0, list: 1, audit: 1 });
  });

  it("delegates explicit confirmed mutations and re-reads the snapshot", async () => {
    const { calls, handler } = createFixture();
    const result = await handler.invoke(
      {
        workspaceId: "workspace-1",
        profileId: handler.profileId,
        source,
        actionId: "create-record",
        operationId: "operation-1",
        values: { recordId: "request-1", summary: "Help" },
      },
      actor,
    );
    expect(result.ok).toBe(true);
    expect(calls.create).toBe(1);
    expect(
      result.ok &&
        result.value.blocks.some(
          (block) => block.blockId === "selected-record",
        ),
    ).toBe(true);
  });

  it("fails closed when the release digest is stale", async () => {
    const { calls, handler } = createFixture();
    const result = await handler.prepare(
      {
        workspaceId: "workspace-1",
        profileId: handler.profileId,
        source: { ...source, sourceDigest: `sha256:${"b".repeat(64)}` },
      },
      actor,
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("workflow.source-stale");
    expect(calls).toEqual({ describe: 0, create: 0, list: 0, audit: 0 });
  });
});
