import { describe, expect, it } from "../../testing/node-test";

import {
  createIpcChannel,
  createIpcChannelValue,
  createIpcError,
  createIpcFailureResponse,
  createIpcRequest,
  createIpcSuccessResponse,
  isIpcChannelValueForOperation,
  parseIpcChannelValue,
} from ".";

describe("ipc contracts", () => {
  it("derives ipc channel values from operation identity and kind", () => {
    const channel = createIpcChannelValue("workspace.create", "request");

    expect(channel).toBe("ipc.workspace.create.request");
  });

  it("parses raw channel values into operation and channel kind", () => {
    const parsed = parseIpcChannelValue(" ipc.workspace.create.response ");

    expect(parsed).toEqual({
      operation: "workspace.create",
      kind: "response",
      value: "ipc.workspace.create.response",
    });
  });

  it("rejects channel values that do not follow the constrained ipc format", () => {
    expect(() => parseIpcChannelValue("desktop.workspace.create.request")).toThrow(
      'IPC channel must use format "ipc.<operation>.<kind>"',
    );
    expect(() => parseIpcChannelValue("ipc.workspace_create.request")).toThrow(
      'IPC channel must use format "ipc.<operation>.<kind>"',
    );
    expect(() => parseIpcChannelValue("ipc.workspace.create.invalid")).toThrow(
      'IPC channel must use format "ipc.<operation>.<kind>"',
    );
  });

  it("creates a channel mapping with derived channel identity", () => {
    const channel = createIpcChannel("workspace.create", "request");

    expect(channel).toEqual({
      operation: "workspace.create",
      kind: "request",
      value: "ipc.workspace.create.request",
    });
  });

  it("checks channel-to-operation invariants for valid and drifted combinations", () => {
    expect(
      isIpcChannelValueForOperation(
        "workspace.create",
        "ipc.workspace.create.request",
        "request",
      ),
    ).toBe(true);
    expect(
      isIpcChannelValueForOperation(
        "workspace.delete",
        "ipc.workspace.create.request",
      ),
    ).toBe(false);
    expect(
      isIpcChannelValueForOperation(
        "workspace.create",
        "ipc.workspace.create.response",
        "request",
      ),
    ).toBe(false);
  });

  it("creates an ipc request that preserves transport operation identity", () => {
    const channel = createIpcChannel("workspace.create", "request");

    const request = createIpcRequest(
      channel,
      { name: "alpha" },
      {
        requestId: "req-400",
        correlationId: "corr-400",
        metadata: { source: "desktop-ui" },
      },
    );

    expect(request).toEqual({
      channel: "ipc.workspace.create.request",
      operation: "workspace.create",
      payload: { name: "alpha" },
      requestId: "req-400",
      correlationId: "corr-400",
      metadata: { source: "desktop-ui" },
    });
  });

  it("creates ipc error and failure response envelopes with channel context", () => {
    const channel = createIpcChannel("workspace.create", "response");

    const error = createIpcError(
      channel,
      "validation",
      "Workspace name is required",
      {
        details: { field: "name" },
        requestId: "req-401",
        metadata: { source: "desktop-host" },
      },
    );

    const response = createIpcFailureResponse(error, {
      correlationId: "corr-401",
    });

    expect(response).toEqual({
      ok: false,
      error: {
        channel: "ipc.workspace.create.response",
        operation: "workspace.create",
        code: "validation",
        message: "Workspace name is required",
        details: { field: "name" },
        requestId: "req-401",
        correlationId: undefined,
        metadata: { source: "desktop-host" },
      },
      channel: "ipc.workspace.create.response",
      operation: "workspace.create",
      requestId: "req-401",
      correlationId: "corr-401",
      metadata: { source: "desktop-host" },
    });
  });

  it("creates ipc success responses without preload or electron-specific fields", () => {
    const channel = createIpcChannel("workspace.create", "response");

    const response = createIpcSuccessResponse(
      channel,
      { workspaceId: "ws-9" },
      {
        requestId: "req-402",
      },
    );

    expect(response).toEqual({
      ok: true,
      value: { workspaceId: "ws-9" },
      requestId: "req-402",
      correlationId: undefined,
      channel: "ipc.workspace.create.response",
      operation: "workspace.create",
      metadata: undefined,
    });
  });
});
