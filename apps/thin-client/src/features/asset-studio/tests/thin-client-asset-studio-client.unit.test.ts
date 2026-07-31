// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { createThinClientAssetStudioClient } from "../api/thinClientAssetStudioClient";

const response = (body: unknown) => ({
  status: 200,
  json: vi.fn().mockResolvedValue(body),
});

describe("thinClientAssetStudioClient", () => {
  it("keeps draft lifecycle routes, queries, and bodies aligned", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true, value: { drafts: [] } }))
      .mockResolvedValueOnce(
        response({
          ok: true,
          value: {
            draftId: "studio-draft-1",
            revision: 3,
            status: "published",
          },
        }),
      );
    (globalThis as any).fetch = fetch;
    const client = createThinClientAssetStudioClient("/api");

    const listed = await client.listAssetDrafts({
      workspaceId: "workspace-a",
      unpublishedOnly: true,
    } as any);
    const published = await client.publishAssetDraft({
      workspaceId: "workspace-a",
      draftId: "studio-draft-1",
      expectedRevision: 2,
    } as any);

    expect(listed.ok).toBe(true);
    expect(published.ok).toBe(true);
    expect(String(fetch.mock.calls[0][0])).toContain(
      "/api/asset-studio/asset-drafts?workspaceId=workspace-a&unpublishedOnly=true",
    );
    expect(String(fetch.mock.calls[1][0])).toBe(
      "/api/asset-studio/asset-drafts/publish",
    );
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toEqual({
      workspaceId: "workspace-a",
      draftId: "studio-draft-1",
      expectedRevision: 2,
    });
  });
});
