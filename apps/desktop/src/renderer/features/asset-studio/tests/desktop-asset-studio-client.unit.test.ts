// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createDesktopAssetStudioClient } from "../api/desktopAssetStudioClient";

describe("desktopAssetStudioClient", () => {
  it("bridges the complete draft lifecycle through canonical preload envelopes", async () => {
    const createAssetStudioAssetDraft = vi.fn().mockResolvedValue({
      ok: true,
      value: { draftId: "studio-draft-1", revision: 1 },
    });
    const listAssetStudioAssetDrafts = vi.fn().mockResolvedValue({
      ok: true,
      value: { drafts: [] },
    });
    const publishAssetStudioAssetDraft = vi.fn().mockResolvedValue({
      ok: true,
      value: { draftId: "studio-draft-1", revision: 3, status: "published" },
    });
    (window as any).desktopApi = {
      createAssetStudioAssetDraft,
      listAssetStudioAssetDrafts,
      publishAssetStudioAssetDraft,
    };

    const client = createDesktopAssetStudioClient();
    const createInput = {
      workspaceId: "workspace-a",
      definitionRef: {
        kind: "asset-definition-version",
        id: "workspace.card",
        version: "1.0.0",
      },
      semanticDefinition: {},
      resources: [],
    } as any;
    const created = await client.createAssetDraft(createInput);
    const listed = await client.listAssetDrafts({
      workspaceId: "workspace-a",
      unpublishedOnly: true,
    } as any);
    const published = await client.publishAssetDraft({
      workspaceId: "workspace-a",
      draftId: "studio-draft-1",
      expectedRevision: 2,
    } as any);

    expect(created.ok && created.value.draftId).toBe("studio-draft-1");
    expect(listed.ok && listed.value.drafts).toEqual([]);
    expect(published.ok && published.value.status).toBe("published");
    expect(createAssetStudioAssetDraft).toHaveBeenCalledWith(createInput);
    expect(listAssetStudioAssetDrafts).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      unpublishedOnly: true,
    });
    expect(publishAssetStudioAssetDraft).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      draftId: "studio-draft-1",
      expectedRevision: 2,
    });
  });
});
