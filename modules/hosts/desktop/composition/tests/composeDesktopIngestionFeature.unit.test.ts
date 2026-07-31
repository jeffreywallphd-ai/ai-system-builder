import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";

import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeDesktopIngestionFeature } from "../composeDesktopIngestionFeature";

const NOW = "2026-07-30T16:00:00.000Z";
const IMMUTABLE_REVISION = "a".repeat(40);

function createFixture(hasActiveOrganizationContext = true) {
  const organizationId = createOrganizationId("organization.local");
  const principalId = "principal.local";
  const workspaceId = createWorkspaceId("workspace-a");
  const documents = createInMemoryStructuredDocumentStore(
    () => NOW,
  ).forOrganization(organizationId);
  const registerArtifactFromRepoUseCase = {
    execute: testDouble.fn().mockResolvedValue({
      ok: true,
      value: { artifactId: "artifact-1" },
    }),
  };
  const feature = composeDesktopIngestionFeature({
    artifacts: { storage: {} as never },
    remoteArtifacts: {
      registerArtifactFromRepoUseCase: registerArtifactFromRepoUseCase as never,
    },
    storageRootDirectory: "artifacts/tmp/desktop-ingestion-context-tests",
    documents,
    workspaceRepository: {
      readWorkspace: async () => ({
        organizationId,
        workspaceId,
        displayName: "Workspace A",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    },
    organizationContextProvider: {
      getCurrentOrganizationContext: () =>
        hasActiveOrganizationContext
          ? { organizationId, principalId }
          : undefined,
    },
    now: () => NOW,
  });
  return { feature, organizationId, principalId, workspaceId };
}

describe("composeDesktopIngestionFeature", () => {
  it("keeps a Hugging Face namespace separate from the authoritative ingestion organization", async () => {
    const { feature, organizationId, workspaceId } = createFixture();

    const result = await feature.ingestionTasks.executeCommand(
      {
        action: "create-hugging-face",
        files: [
          {
            repository: "OpenFinAL/Reddit",
            path: "default/train/0000.parquet",
            revision: IMMUTABLE_REVISION,
          },
        ],
      },
      { workspaceId },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "task",
        task: {
          organizationId,
          workspaceId,
          kind: "hugging-face",
          files: [
            {
              providerSource: {
                repository: "OpenFinAL/Reddit",
                path: "default/train/0000.parquet",
                revision: IMMUTABLE_REVISION,
              },
            },
          ],
        },
      },
    });
  });

  it("rejects a caller-supplied organization that conflicts with the active host context", async () => {
    const { feature, workspaceId } = createFixture();

    const denied = await feature.ingestionTasks.executeCommand(
      {
        action: "create-hugging-face",
        files: [
          {
            repository: "OpenFinAL/Reddit",
            path: "default/train/0000.parquet",
            revision: IMMUTABLE_REVISION,
          },
        ],
      },
      {
        workspaceId,
        organizationId: createOrganizationId("organization.other"),
      },
    );

    expect(denied).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    await expect(
      feature.ingestionTasks.executeCommand(
        { action: "list" },
        { workspaceId },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "tasks", tasks: [] },
    });
  });

  it("fails closed when the host cannot establish an active organization", async () => {
    const { feature, workspaceId } = createFixture(false);

    const denied = await feature.ingestionTasks.executeCommand(
      {
        action: "create-hugging-face",
        files: [
          {
            repository: "OpenFinAL/Reddit",
            path: "default/train/0000.parquet",
            revision: IMMUTABLE_REVISION,
          },
        ],
      },
      { workspaceId },
    );

    expect(denied).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});
