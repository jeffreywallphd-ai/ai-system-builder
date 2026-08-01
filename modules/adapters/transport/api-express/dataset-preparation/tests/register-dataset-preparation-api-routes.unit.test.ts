import type { Request } from "express";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { setExpressOrganizationContext } from "../../security/expressOrganizationContext";
import { createOrganizationId } from "../../../../../contracts/organization";
import { registerDatasetPreparationApiRoutes } from "../registerDatasetPreparationApiRoutes";

function authenticatedRequest<T extends object>(request: T): T {
  setExpressAuthContext(request as Request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: {
      principalId: "person-1",
      kind: "user",
      roles: ["organization-member"],
      scopes: ["artifact:write"],
    },
  });
  setExpressOrganizationContext(request as Request, {
    organizationId: createOrganizationId("org-a"),
    principalId: "person-1",
  });
  return request;
}

function responseRecorder() {
  const record: { status?: number; body?: any } = {};
  const response = {
    status(status: number) {
      record.status = status;
      return response;
    },
    json(body: unknown) {
      record.body = body;
    },
  };
  return { record, response };
}

describe("registerDatasetPreparationApiRoutes", () => {
  it("returns bounded generation capacity only to authenticated callers", async () => {
    const get = new Map<string, any>();
    const readGenerationCapacity = testDouble.fn(async () => ({
      schemaVersion: "1" as const,
      capturedAt: "2026-07-30T12:00:00.000Z",
      decoderAvailable: true,
      schemaSupported: true,
      logicalProcessorCount: 12,
      totalSystemMemoryBytes: 32 * 1024 ** 3,
    }));
    registerDatasetPreparationApiRoutes({
      app: {
        get: (path, handler) => get.set(path, handler),
        post: testDouble.fn(),
      },
      prepareTrainingDatasetUseCase: {} as any,
      readGenerationCapacity,
    });
    const handler = get.get("/api/dataset-preparation/generation-capacity");

    const unauthorized = responseRecorder();
    await handler(
      { query: { workspaceId: "workspace-a" } },
      unauthorized.response,
    );
    expect(unauthorized.record.status).toBe(401);
    expect(readGenerationCapacity).not.toHaveBeenCalled();

    const authorized = responseRecorder();
    await handler(
      authenticatedRequest({ query: { workspaceId: "workspace-a" } }),
      authorized.response,
    );
    expect(authorized.record.status).toBe(200);
    expect(authorized.record.body).toMatchObject({
      ok: true,
      value: {
        decoderAvailable: true,
        logicalProcessorCount: 12,
      },
    });
  });

  it("registers start, read, approve, and cancel routes", () => {
    const get = new Map<string, unknown>();
    const post = new Map<string, unknown>();
    registerDatasetPreparationApiRoutes({
      app: {
        get: (path, handler) => get.set(path, handler),
        post: (path, handler) => post.set(path, handler),
      },
      prepareTrainingDatasetUseCase: {
        startPrepareTrainingDataset: testDouble.fn(),
        readPrepareTrainingDataset: testDouble.fn(),
        cancelPrepareTrainingDataset: testDouble.fn(),
        approvePreparedTrainingDataset: testDouble.fn(),
      } as any,
    });

    expect([...get.keys()]).toEqual([
      "/api/dataset-preparation/tasks/:requestId/review-page",
      "/api/dataset-preparation/tasks/:requestId",
    ]);
    expect([...post.keys()].sort()).toEqual(
      [
        "/api/dataset-preparation/start",
        "/api/dataset-preparation/tasks/:requestId/approve",
        "/api/dataset-preparation/tasks/:requestId/cancel",
      ].sort(),
    );
  });

  it("binds approval and its final save name to the authenticated workspace and fingerprint", async () => {
    const post = new Map<string, any>();
    const approvePreparedTrainingDataset = testDouble.fn(async () => ({
      ok: false,
      error: {
        code: "conflict",
        message: "The data review changed.",
      },
    }));
    registerDatasetPreparationApiRoutes({
      app: {
        get: testDouble.fn(),
        post: (path, handler) => post.set(path, handler),
      },
      prepareTrainingDatasetUseCase: {
        startPrepareTrainingDataset: testDouble.fn(),
        readPrepareTrainingDataset: testDouble.fn(),
        cancelPrepareTrainingDataset: testDouble.fn(),
        approvePreparedTrainingDataset,
      } as any,
    });
    const { record, response } = responseRecorder();

    await post.get("/api/dataset-preparation/tasks/:requestId/approve")(
      authenticatedRequest({
        params: { requestId: "task-1" },
        body: {
          workspaceId: "workspace-a",
          reportFingerprint: "a".repeat(64),
          outputBaseName: "support-tickets-2026",
        },
      }),
      response,
    );

    expect(approvePreparedTrainingDataset).toHaveBeenCalledWith(
      {
        requestId: "task-1",
        reportFingerprint: "a".repeat(64),
        outputBaseName: "support-tickets-2026",
      },
      expect.objectContaining({
        workspaceId: "workspace-a",
        organizationId: "org-a",
        principalId: "person-1",
      }),
    );
    expect(record.status).toBe(409);
    expect(record.body).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });

  it("binds prepared-row pages to the authenticated scope and exact report line", async () => {
    const get = new Map<string, any>();
    const readPreparedDatasetQualityReviewPage = testDouble.fn(async () => ({
      ok: true,
      value: {
        lineId: "reason:exact-duplicate",
        page: 0,
        pageSize: 10,
        totalRows: 1,
        rows: [],
      },
    }));
    registerDatasetPreparationApiRoutes({
      app: {
        get: (path, handler) => get.set(path, handler),
        post: testDouble.fn(),
      },
      prepareTrainingDatasetUseCase: {
        startPrepareTrainingDataset: testDouble.fn(),
        readPrepareTrainingDataset: testDouble.fn(),
        cancelPrepareTrainingDataset: testDouble.fn(),
        approvePreparedTrainingDataset: testDouble.fn(),
        readPreparedDatasetQualityReviewPage,
      } as any,
    });
    const captured = responseRecorder();
    await get.get("/api/dataset-preparation/tasks/:requestId/review-page")(
      authenticatedRequest({
        params: { requestId: "task-1" },
        query: {
          workspaceId: "workspace-a",
          reportFingerprint: "a".repeat(64),
          lineId: "reason:exact-duplicate",
          page: "0",
        },
      }),
      captured.response,
    );
    expect(captured.record.status).toBe(200);
    expect(readPreparedDatasetQualityReviewPage).toHaveBeenCalledWith(
      {
        requestId: "task-1",
        reportFingerprint: "a".repeat(64),
        lineId: "reason:exact-duplicate",
        page: 0,
      },
      expect.objectContaining({
        workspaceId: "workspace-a",
        organizationId: "org-a",
        principalId: "person-1",
      }),
    );
  });

  it("rejects unauthenticated starts before invoking the use case", async () => {
    const post = new Map<string, any>();
    const startPrepareTrainingDataset = testDouble.fn();
    registerDatasetPreparationApiRoutes({
      app: {
        get: testDouble.fn(),
        post: (path, handler) => post.set(path, handler),
      },
      prepareTrainingDatasetUseCase: {
        startPrepareTrainingDataset,
        readPrepareTrainingDataset: testDouble.fn(),
        cancelPrepareTrainingDataset: testDouble.fn(),
      } as any,
    });
    const { record, response } = responseRecorder();

    await post.get("/api/dataset-preparation/start")(
      { body: { workspaceId: "workspace-a", command: {} } },
      response,
    );

    expect(record.status).toBe(401);
    expect(record.body).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    expect(startPrepareTrainingDataset).not.toHaveBeenCalled();
  });

  it("passes authenticated workspace context and maps not-found reads", async () => {
    const get = new Map<string, any>();
    const post = new Map<string, any>();
    const startPrepareTrainingDataset = testDouble.fn(async () => ({
      ok: true,
      value: {
        requestId: "task-1",
        taskType: "prepare-training-dataset",
        accepted: true,
        status: "queued",
      },
    }));
    const readPrepareTrainingDataset = testDouble.fn(async () => ({
      ok: false,
      error: {
        code: "not-found",
        message: "Dataset preparation task was not found.",
      },
    }));
    registerDatasetPreparationApiRoutes({
      app: {
        get: (path, handler) => get.set(path, handler),
        post: (path, handler) => post.set(path, handler),
      },
      prepareTrainingDatasetUseCase: {
        startPrepareTrainingDataset,
        readPrepareTrainingDataset,
        cancelPrepareTrainingDataset: testDouble.fn(),
      } as any,
    });

    const startResponse = responseRecorder();
    await post.get("/api/dataset-preparation/start")(
      authenticatedRequest({
        headers: { "x-request-id": "request-1" },
        body: {
          workspaceId: "workspace-a",
          command: { sourceArtifactIds: ["artifact-1"] },
        },
      }),
      startResponse.response,
    );
    expect(startResponse.record.status).toBe(202);
    expect(startPrepareTrainingDataset).toHaveBeenCalledWith(
      { sourceArtifactIds: ["artifact-1"] },
      expect.objectContaining({
        workspaceId: "workspace-a",
        organizationId: "org-a",
        principalId: "person-1",
        requestId: "request-1",
      }),
    );

    const readResponse = responseRecorder();
    await get.get("/api/dataset-preparation/tasks/:requestId")(
      authenticatedRequest({
        params: { requestId: "task-1" },
        query: { workspaceId: "workspace-b" },
      }),
      readResponse.response,
    );
    expect(readResponse.record.status).toBe(404);
    expect(readResponse.record.body).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });
});
