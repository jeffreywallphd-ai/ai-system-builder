import { describe, expect, it } from "../../../../testing/node-test";
import type { SystemBuildRepositoryPort } from "../../../ports/system-build";
import {
  systemReviewSuccess,
  type SystemReviewDescriptor,
} from "../../../../contracts/system-review";
import type { SystemRelease } from "../../../../contracts/system-build";
import { createSystemReviewWorkflowHandler } from "../system-review-workflow-handler.service";

const release = {
  releaseId: "release-1",
  targetWorkspaceId: "workspace-1",
  releaseDigest: `sha256:${"a".repeat(64)}`,
} as SystemRelease;
const descriptor: SystemReviewDescriptor = {
  schemaVersion: "1.0",
  targetWorkspaceId: "workspace-1" as never,
  releaseId: "release-1" as never,
  title: "Review artifacts",
  allowedMediaTypes: ["text/plain"],
  maximumListItems: 100,
  maximumPreviewBytes: 1_024,
};
const actor = {
  actorId: "reviewer-1",
  roles: ["reviewer"],
  authenticated: true,
} as const;
const source = {
  kind: "approved-release" as const,
  sourceId: "release-1",
  sourceDigest: release.releaseDigest,
  label: "Release 1",
};

const fixture = () => {
  const calls = { describe: 0, browse: 0, preview: 0 };
  const builds = {
    readRelease: async () => release,
    listReleases: async () => [release],
  } as unknown as SystemBuildRepositoryPort;
  const handler = createSystemReviewWorkflowHandler({
    builds,
    definitions: {
      resolve: async () => ({
        descriptor,
        allowedRoles: ["reviewer"],
        protectedMetadataFields: [],
        unmaskRoles: ["reviewer"],
      }),
    },
    runtime: {
      async describe() {
        calls.describe += 1;
        return systemReviewSuccess(descriptor);
      },
      async browse() {
        calls.browse += 1;
        return systemReviewSuccess({
          items: [
            {
              artifactRef: "artifact-1",
              displayName: "notes.txt",
              artifactFamily: "document",
              mediaType: "text/plain",
            },
          ],
          total: 1,
          limit: 100,
        });
      },
      async detail() {
        return systemReviewSuccess({
          artifactRef: "artifact-1",
          displayName: "notes.txt",
          artifactFamily: "document",
          mediaType: "text/plain",
          metadata: { classification: "internal" },
        });
      },
      async preview() {
        calls.preview += 1;
        return systemReviewSuccess({
          artifactRef: "artifact-1",
          displayName: "notes.txt",
          mediaType: "text/plain",
          kind: "text",
          status: "ready",
          message: "Ready.",
          text: "Safe preview",
        });
      },
      async listAudit() {
        return systemReviewSuccess([]);
      },
    },
    now: () => "2026-07-29T00:00:00.000Z",
  });
  return { calls, handler };
};

describe("system review workflow handler", () => {
  it("discovers review profiles without browsing artifacts", async () => {
    const { calls, handler } = fixture();
    const result = await handler.discover(
      { workspaceId: "workspace-1" },
      actor,
    );
    expect(result.ok).toBe(true);
    expect(calls).toEqual({ describe: 0, browse: 0, preview: 0 });
  });

  it("prepares the selected review workflow lazily", async () => {
    const { calls, handler } = fixture();
    const result = await handler.prepare(
      {
        workspaceId: "workspace-1",
        profileId: handler.profileId,
        source,
      },
      actor,
    );
    expect(result.ok).toBe(true);
    expect(
      result.ok
        ? result.value.actions.map((action) => action.actionId)
        : [],
    ).toEqual(["refresh", "search", "open-artifact"]);
    expect(calls).toEqual({ describe: 1, browse: 1, preview: 0 });
  });

  it("projects safe preview content only after an explicit open action", async () => {
    const { calls, handler } = fixture();
    const result = await handler.invoke(
      {
        workspaceId: "workspace-1",
        profileId: handler.profileId,
        source,
        actionId: "open-artifact",
        operationId: "operation-1",
        values: { artifactRef: "artifact-1" },
      },
      actor,
    );
    expect(result.ok).toBe(true);
    expect(calls.preview).toBe(1);
    expect(
      result.ok &&
        result.value.blocks.some(
          (block) =>
            block.kind === "artifacts" &&
            block.items.some((item) => item.previewText === "Safe preview"),
        ),
    ).toBe(true);
  });
});
