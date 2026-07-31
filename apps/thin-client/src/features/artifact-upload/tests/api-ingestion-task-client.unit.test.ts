// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createApiIngestionTaskClient } from "../api/apiIngestionTaskClient";

describe("api ingestion task client", () => {
  it("serializes chunk bytes as a bounded JSON array and preserves workspace context", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { kind: "cleanup", cleanedTaskIds: [] } }) });
    vi.stubGlobal("fetch", fetchMock);
    await createApiIngestionTaskClient("/api/").execute({
      workspaceId: "workspace-a",
      command: { action: "append-chunk", taskId: "task-a", fileId: "file-a", chunkIndex: 0, expectedOffset: 0, bytes: new Uint8Array([1, 2, 3]), sha256: `sha256:${"a".repeat(64)}` },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/ingestion/tasks/execute");
    expect(body).toMatchObject({ workspaceId: "workspace-a", source: "thin-client.data-management", command: { action: "append-chunk", bytes: [1, 2, 3] } });
  });
});
