// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createApiDatasetPreparationClient } from "../api/apiDatasetPreparationClient";

const response = (status: number, body: unknown) => ({
  status,
  json: vi.fn().mockResolvedValue(body),
});

describe("api dataset preparation client", () => {
  it("reads and normalizes the authenticated generation capacity snapshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(200, {
        ok: true,
        value: {
          schemaVersion: "1",
          capturedAt: "2026-07-30T12:00:00.000Z",
          decoderAvailable: true,
          schemaSupported: true,
          logicalProcessorCount: 12,
          totalSystemMemoryBytes: 32 * 1024 ** 3,
          ignoredHardwareIdentity: "not-retained",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createApiDatasetPreparationClient("/api/").readGenerationCapacity({
        workspaceId: "workspace a",
      }),
    ).resolves.toEqual({
      schemaVersion: "1",
      capturedAt: "2026-07-30T12:00:00.000Z",
      decoderAvailable: true,
      schemaSupported: true,
      logicalProcessorCount: 12,
      totalSystemMemoryBytes: 32 * 1024 ** 3,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/dataset-preparation/generation-capacity?workspaceId=workspace%20a",
    );
  });

  it("keeps start, read, approve, and cancel routes aligned with workspace context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(202, {
          ok: true,
          value: {
            requestId: "task/1",
            taskType: "prepare-training-dataset",
            accepted: true,
            status: "queued",
          },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          ok: true,
          value: {
            requestId: "task/1",
            taskType: "prepare-training-dataset",
            status: "succeeded",
            result: {},
          },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          ok: true,
          value: { requestId: "task/1", status: "running" },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          ok: true,
          value: {
            requestId: "task/1",
            cancelled: true,
            status: "cancelled",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiDatasetPreparationClient("/api/");
    const command = {
      sourceArtifactIds: ["artifact-1"],
      recipe: {} as never,
      split: { trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1 },
      output: { format: "parquet" as const },
    };

    await client.start({ workspaceId: "workspace a", command });
    await client.read({ workspaceId: "workspace a", requestId: "task/1" });
    await client.approve({
      workspaceId: "workspace a",
      requestId: "task/1",
      reportFingerprint: "a".repeat(64),
    });
    await client.cancel({ workspaceId: "workspace a", requestId: "task/1" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/dataset-preparation/start");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      workspaceId: "workspace a",
      command,
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/dataset-preparation/tasks/task%2F1?workspaceId=workspace%20a",
    );
    expect(fetchMock.mock.calls[2][0]).toBe(
      "/api/dataset-preparation/tasks/task%2F1/approve",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body))).toEqual({
      workspaceId: "workspace a",
      reportFingerprint: "a".repeat(64),
    });
    expect(fetchMock.mock.calls[3][0]).toBe(
      "/api/dataset-preparation/tasks/task%2F1/cancel",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[3][1].body))).toEqual({
      workspaceId: "workspace a",
    });
  });

  it("preserves sanitized API failure status and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(404, {
          ok: false,
          error: {
            code: "not-found",
            message: "Dataset preparation task was not found.",
          },
        }),
      ),
    );

    await expect(
      createApiDatasetPreparationClient().read({
        workspaceId: "workspace-a",
        requestId: "missing",
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "not-found",
      message: "Dataset preparation task was not found.",
    });
  });

  it("uses encoded dataset-version routes and sends explicit publication choices", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { ok: true, value: { versions: [] } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { comparison: {} } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { reproduction: {} } }))
      .mockResolvedValueOnce(response(200, { ok: true, value: { publication: {} } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiDatasetPreparationClient("/api/");
    await client.listVersions!({ workspaceId: "workspace a", datasetId: "data/one" });
    await client.compareVersions!({ workspaceId: "workspace a", fromVersionId: "version/1", toVersionId: "version/2" });
    await client.readReproduction!({ workspaceId: "workspace a", versionId: "version/2" });
    await client.publishVersion!({ workspaceId: "workspace a", versionId: "version/2", repositoryId: "owner/data", visibility: "public", publicAccessConfirmed: true });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/dataset-versions?workspaceId=workspace%20a&datasetId=data%2Fone");
    expect(fetchMock.mock.calls[1][0]).toContain("fromVersionId=version%2F1&toVersionId=version%2F2");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/dataset-versions/version%2F2/reproduction?workspaceId=workspace%20a");
    expect(JSON.parse(String(fetchMock.mock.calls[3][1].body))).toMatchObject({ repositoryId: "owner/data", visibility: "public", publicAccessConfirmed: true });
  });
});
