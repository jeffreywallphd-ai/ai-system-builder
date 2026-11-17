import type { Request } from "express";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import {
  DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL,
  createDesktopContextManagementExecuteRequest,
} from "../../../../../contracts/ipc";
import { createSuccessResult } from "../../../../../contracts/shared";
import { createDesktopContextManagementIpcHandler } from "../../../ipc-electron/context-management/registerContextManagementIpc";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { registerContextManagementApiRoutes } from "../registerContextManagementApiRoutes";

function authenticated<T extends object>(request: T): T {
  setExpressAuthContext(request as Request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: {
      principalId: "person-1",
      kind: "user",
      roles: ["organization-member"],
      scopes: ["artifact:read", "artifact:write"],
    },
  });
  return request;
}

describe("Context Management transport parity", () => {
  it("carries the same typed command and authoritative workspace over API and IPC", async () => {
    const executeApi = testDouble.fn(async (_command: any, context: any) =>
      createSuccessResult({ action: "browser-list", items: [] } as const, context),
    );
    const routes = new Map<string, any>();
    registerContextManagementApiRoutes({
      app: { post: (path, handler) => routes.set(path, handler) },
      contextManagement: { executeCommand: executeApi },
    });
    const json = testDouble.fn();
    const response: any = { status: testDouble.fn(() => response), json };
    await routes.get("/api/context-management/read")(
      authenticated({
        body: {
          workspaceId: "workspace-a",
          command: { action: "browser-list" },
        },
      }),
      response,
    );
    expect(executeApi.mock.calls[0]).toMatchObject([
      { action: "browser-list" },
      { workspaceId: "workspace-a", principalId: "person-1" },
    ]);

    const executeIpc = testDouble.fn(async (_command: any, context: any) =>
      createSuccessResult({ action: "browser-list", items: [] } as const, context),
    );
    const handler = createDesktopContextManagementIpcHandler({
      senderTrust: { isTrustedSender: () => true },
      contextManagement: { executeCommand: executeIpc },
      getAuthoritativeRequestContext: () => ({ principalId: "person-local" }),
    });
    const request = createDesktopContextManagementExecuteRequest({
      command: { action: "browser-list" },
      boundary: {
        host: "desktop",
        source: "test",
        workspaceId: "workspace-a",
      },
    });
    const ipcResult = await handler({}, request);
    expect(request.channel).toBe(
      DESKTOP_CONTEXT_MANAGEMENT_EXECUTE_REQUEST_CHANNEL.value,
    );
    expect(ipcResult.ok).toBe(true);
    expect(executeIpc.mock.calls[0]).toMatchObject([
      { action: "browser-list" },
      { workspaceId: "workspace-a", principalId: "person-local" },
    ]);
  });

  it("denies untrusted IPC before use-case execution and rejects writes on the read route", async () => {
    const execute = testDouble.fn(async () =>
      createSuccessResult({ action: "browser-delete", storageKey: "x" } as const),
    );
    const handler = createDesktopContextManagementIpcHandler({
      senderTrust: { isTrustedSender: () => false },
      contextManagement: { executeCommand: execute },
    });
    const request = createDesktopContextManagementExecuteRequest({
      command: { action: "browser-list" },
      boundary: { host: "desktop", source: "test", workspaceId: "workspace-a" },
    });
    const denied = await handler({}, request);
    expect(denied).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(execute).not.toHaveBeenCalled();

    const routes = new Map<string, any>();
    registerContextManagementApiRoutes({
      app: { post: (path, routeHandler) => routes.set(path, routeHandler) },
      contextManagement: { executeCommand: execute },
    });
    const json = testDouble.fn();
    const response: any = { status: testDouble.fn(() => response), json };
    await routes.get("/api/context-management/read")(
      authenticated({
        body: {
          workspaceId: "workspace-a",
          command: { action: "browser-delete", artifactId: "context-1" },
        },
      }),
      response,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts CommonMark-valid manual context through the desktop boundary", async () => {
    const execute = testDouble.fn(async (_command: any, context: any) =>
      createSuccessResult(
        {
          action: "generation-start",
          value: {
            requestId: "context-request-1",
            taskType: "generate-context-artifact",
            accepted: true,
            status: "queued",
          },
        } as const,
        context,
      ),
    );
    const handler = createDesktopContextManagementIpcHandler({
      senderTrust: { isTrustedSender: () => true },
      contextManagement: { executeCommand: execute },
    });
    const content =
      "#This is a test pack\r\n\r\nThis is a test of the pack capabilities.";
    const request = createDesktopContextManagementExecuteRequest({
      command: {
        action: "generation-start",
        command: {
          kind: "markdown-context-pack",
          name: "Test Pack",
          sources: [],
          manualEntries: [
            { id: "manual-entry-1", title: "Test Pack", content },
          ],
          chunking: {
            strategy: "structure-aware",
            chunkCharacters: 1200,
            overlapCharacters: 120,
            maximumChunks: 10_000,
            textFields: [],
          },
          contextPack: { inputMode: "manual", method: "none" },
        },
      },
      boundary: {
        host: "desktop",
        source: "context-management",
        workspaceId: "workspace-a",
      },
    });

    const result = await handler({}, request);

    expect(result.ok).toBe(true);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      action: "generation-start",
      command: {
        contextPack: { inputMode: "manual", method: "none" },
        manualEntries: [{ content }],
      },
    });
  });

  it("requires authentication before API use-case execution", async () => {
    const execute = testDouble.fn();
    const routes = new Map<string, any>();
    registerContextManagementApiRoutes({
      app: { post: (path, handler) => routes.set(path, handler) },
      contextManagement: { executeCommand: execute as any },
    });
    const json = testDouble.fn();
    const response: any = { status: testDouble.fn(() => response), json };
    await routes.get("/api/context-management/read")(
      { body: { workspaceId: "workspace-a", command: { action: "browser-list" } } },
      response,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(execute).not.toHaveBeenCalled();
  });
});
