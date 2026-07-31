import { describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  createArtifactBrowserLocator,
  type ArtifactBrowseItem,
} from "../../../contracts/artifact-browser";
import { createContractError } from "../../../contracts/shared";
import { createSecurityApplicationError } from "../../../contracts/security";
import { createWorkspaceId } from "../../../contracts/workspace";
import type {
  ArtifactBrowserContentReadPort,
  ArtifactBrowserMetadataReadPort,
} from "../../ports/artifact-browser";
import {
  BrowseArtifactsUseCase,
  ReadArtifactContentUseCase,
  ReadArtifactDetailUseCase,
} from "../index";

function createMetadataReadPort(
  overrides: Partial<Record<keyof ArtifactBrowserMetadataReadPort, unknown>> = {},
): ArtifactBrowserMetadataReadPort {
  return {
    browseArtifacts: testDouble.fn<ArtifactBrowserMetadataReadPort["browseArtifacts"]>(),
    readArtifactDetail: testDouble.fn<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>(),
    ...overrides,
  } as ArtifactBrowserMetadataReadPort;
}

function createContentReadPort(
  overrides: Partial<Record<keyof ArtifactBrowserContentReadPort, unknown>> = {},
): ArtifactBrowserContentReadPort {
  return {
    readArtifactContent: testDouble.fn<ArtifactBrowserContentReadPort["readArtifactContent"]>(),
    ...overrides,
  } as ArtifactBrowserContentReadPort;
}

describe("artifact browser read use cases", () => {
  it("denies workspace access before artifact reads when managed authorization rejects", async () => {
    const browseArtifacts = testDouble.fn<ArtifactBrowserMetadataReadPort["browseArtifacts"]>();
    const authorizeWorkspaceOperation = testDouble.fn().mockRejectedValue(
      createSecurityApplicationError("security.forbidden", "private policy detail"),
    );
    const useCase = new BrowseArtifactsUseCase({
      artifactBrowserMetadataRead: createMetadataReadPort({ browseArtifacts }),
      workspaceRepository: {
        readWorkspace: async () => ({
          organizationId: "org-b" as never,
          workspaceId: createWorkspaceId("workspace-a"),
          displayName: "Other tenant workspace",
          status: "active",
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:00:00.000Z",
        }),
      },
      workspaceAuthorization: { authorizeWorkspaceOperation } as never,
    });

    const result = await useCase.execute({}, { workspaceId: "workspace-a" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected authorization failure.");
    expect(result.error.code).toBe("forbidden");
    expect(result.error.message).toBe("Workspace access is forbidden.");
    expect(JSON.stringify(result)).not.toContain("private policy detail");
    expect(browseArtifacts).not.toHaveBeenCalled();
  });

  it("browse returns metadata-oriented image browse results", async () => {
    const browseArtifacts = testDouble
      .fn<ArtifactBrowserMetadataReadPort["browseArtifacts"]>()
      .mockResolvedValue({
        ok: true,
        value: {
          items: [
            {
              artifactId: " staged/images/cat-1 ",
              storageKey: " staged/images/cat-1 ",
              artifactFamily: "image",
              mediaType: " image/png ",
            } satisfies ArtifactBrowseItem,
          ],
        },
      });

    const useCase = new BrowseArtifactsUseCase({
      artifactBrowserMetadataRead: createMetadataReadPort({ browseArtifacts }),
    });

    const result = await useCase.execute(
      {
        artifactFamily: "image",
      },
      {
        requestId: "req-browse-1",
        correlationId: "corr-browse-1",
        workspaceId: "workspace-a",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected browse success result.");
    }

    expect(result.value).toMatchObject({
      items: [
        {
          storageKey: "staged/images/cat-1",
          artifactFamily: "image",
          mediaType: "image/png",
        },
      ],
    });
    expect("content" in result.value.items[0]).toBe(false);
    expect(browseArtifacts).toHaveBeenCalledWith(
      {
        artifactFamily: "image",
      },
      {
        requestId: "req-browse-1",
        correlationId: "corr-browse-1",
        workspaceId: "workspace-a",
      },
    );
  });

  it("browse passes through generic artifact kind filters without image/data restriction", async () => {
    const browseArtifacts = testDouble.fn<ArtifactBrowserMetadataReadPort["browseArtifacts"]>();
    browseArtifacts.mockResolvedValue({ ok: true, value: { items: [] } });
    const useCase = new BrowseArtifactsUseCase({
      artifactBrowserMetadataRead: createMetadataReadPort({ browseArtifacts }),
    });

    const result = await useCase.execute({
      artifactFamily: "document",
    }, { workspaceId: "workspace-a" });

    expect(result.ok).toBe(true);
    expect(browseArtifacts).toHaveBeenCalledWith({ artifactFamily: "document" }, { workspaceId: "workspace-a" });
  });

  it("detail returns one artifact metadata/read-model result by locator", async () => {
    const readArtifactDetail = testDouble
      .fn<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>()
      .mockResolvedValue({
        ok: true,
        value: {
          artifact: {
            locator: createArtifactBrowserLocator("staged/images/cat-2"),
            artifactFamily: "image",
            mediaType: "image/jpeg",
            metadata: {
              width: 640,
            },
          },
        },
      });

    const useCase = new ReadArtifactDetailUseCase({
      artifactBrowserMetadataRead: createMetadataReadPort({ readArtifactDetail }),
    });

    const result = await useCase.execute<{ width: number }>({
      locator: createArtifactBrowserLocator(" staged/images/cat-2 "),
    }, { workspaceId: "workspace-a" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected detail success.");
    }

    expect(result.value.artifact).toMatchObject({
      locator: { storageKey: "staged/images/cat-2" },
      artifactFamily: "image",
      mediaType: "image/jpeg",
      metadata: { width: 640 },
    });
    expect("content" in result.value.artifact).toBe(false);
  });

  it("detail passes through not-found failures and validates locator", async () => {
    const readArtifactDetail = testDouble
      .fn<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>()
      .mockResolvedValue({
        ok: false,
        error: createContractError("not-found", "Artifact not found."),
      });

    const useCase = new ReadArtifactDetailUseCase({
      artifactBrowserMetadataRead: createMetadataReadPort({ readArtifactDetail }),
    });

    const notFoundResult = await useCase.execute({
      locator: createArtifactBrowserLocator("staged/images/missing-1"),
    }, { workspaceId: "workspace-a" });

    expect(notFoundResult.ok).toBe(false);
    if (notFoundResult.ok) {
      throw new Error("Expected not-found failure.");
    }
    expect(notFoundResult.error.code).toBe("not-found");

    const validationResult = await useCase.execute({
      locator: { storageKey: "   " },
    }, { workspaceId: "workspace-a" });

    expect(validationResult.ok).toBe(false);
    if (validationResult.ok) {
      throw new Error("Expected validation failure.");
    }
    expect(validationResult.error.code).toBe("validation");
  });

  it("content read returns descriptor-oriented content model and remains distinct from detail", async () => {
    const readArtifactContent = testDouble
      .fn<ArtifactBrowserContentReadPort["readArtifactContent"]>()
      .mockResolvedValue({
        ok: true,
        value: {
          content: {
            locator: createArtifactBrowserLocator("staged/images/cat-3"),
            mediaType: "image/png",
            sizeBytes: 4,
            availability: "available",
            retrieval: "deferred",
          },
        },
      });

    const useCase = new ReadArtifactContentUseCase({
      artifactBrowserContentRead: createContentReadPort({ readArtifactContent }),
    });

    const result = await useCase.execute({
      locator: createArtifactBrowserLocator(" staged/images/cat-3 "),
    }, { workspaceId: "workspace-a" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected content-read success.");
    }

    expect(result.value.content).toEqual({
      locator: { storageKey: "staged/images/cat-3" },
      mediaType: "image/png",
      sizeBytes: 4,
      availability: "available",
      retrieval: "deferred",
    });
    expect("bytes" in result.value.content).toBe(false);
  });

  it("content read passes through not-found and returns validation for invalid locator", async () => {
    const readArtifactContent = testDouble
      .fn<ArtifactBrowserContentReadPort["readArtifactContent"]>()
      .mockResolvedValue({
        ok: false,
        error: createContractError("not-found", "Artifact content not found."),
      });

    const useCase = new ReadArtifactContentUseCase({
      artifactBrowserContentRead: createContentReadPort({ readArtifactContent }),
    });

    const notFoundResult = await useCase.execute({
      locator: createArtifactBrowserLocator("staged/images/missing-content-1"),
    }, { workspaceId: "workspace-a" });

    expect(notFoundResult.ok).toBe(false);
    if (notFoundResult.ok) {
      throw new Error("Expected not-found failure.");
    }
    expect(notFoundResult.error.code).toBe("not-found");

    const validationResult = await useCase.execute({
      locator: { storageKey: "" },
    }, { workspaceId: "workspace-a" });

    expect(validationResult.ok).toBe(false);
    if (validationResult.ok) {
      throw new Error("Expected validation failure.");
    }
    expect(validationResult.error.code).toBe("validation");
  });
});
