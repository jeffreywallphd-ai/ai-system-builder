import { describe, expect, it } from "../../../testing/node-test";

import {
  createIpcChannel,
  createIpcError,
  createIpcFailureResponse,
  createIpcRequest,
  createIpcSuccessResponse,
  type IpcResponse,
} from "..";
import {
  createTransportFailureResponse,
  createTransportRequest,
  createTransportSuccessResponse,
  type TransportResponse,
} from "../../transport";

describe("ipc transport specialization contracts", () => {
  it("creates an ipc request from a derived channel binding and preserves transport request semantics", () => {
    const channel = createIpcChannel("workspace.create", "request");

    const ipcRequest = createIpcRequest(channel, { name: "alpha" }, {
      requestId: "req-500",
      correlationId: "corr-500",
      metadata: { source: "desktop-host" },
    });
    const transportRequest = createTransportRequest(
      "workspace.create",
      { name: "alpha" },
      {
        requestId: "req-500",
        correlationId: "corr-500",
        metadata: { source: "desktop-host" },
      },
    );

    expect(ipcRequest).toEqual({
      ...transportRequest,
      channel: "ipc.workspace.create.request",
    });
  });

  it("creates an ipc success response that is transport-compatible plus channel context", () => {
    const channel = createIpcChannel("workspace.create", "response");

    const ipcResponse = createIpcSuccessResponse(channel, { workspaceId: "ws-10" }, {
      requestId: "req-501",
      correlationId: "corr-501",
      metadata: { source: "desktop-host" },
    });
    const transportResponse = createTransportSuccessResponse(
      "workspace.create",
      { workspaceId: "ws-10" },
      {
        requestId: "req-501",
        correlationId: "corr-501",
        metadata: { source: "desktop-host" },
      },
    );

    expect(ipcResponse).toEqual({
      ...transportResponse,
      channel: "ipc.workspace.create.response",
    });
    expect("sender" in ipcResponse).toBe(false);
  });

  it("creates an ipc failure response from transport failure semantics and retains channel identity", () => {
    const channel = createIpcChannel("workspace.create", "response");

    const error = createIpcError(channel, "validation", "Workspace name is required", {
      requestId: "req-502",
      metadata: { source: "desktop-host" },
    });

    const ipcResponse = createIpcFailureResponse(error, {
      correlationId: "corr-502",
    });
    const transportResponse = createTransportFailureResponse(error, {
      correlationId: "corr-502",
    });

    expect(ipcResponse).toEqual({
      ...transportResponse,
      channel: "ipc.workspace.create.response",
      error,
    });
  });

  it("keeps ipc response assignable to the shared transport response contract", () => {
    const channel = createIpcChannel("workspace.create", "response");

    const ipcResponse: IpcResponse<
      { workspaceId: string },
      { reason?: string },
      "workspace.create",
      { source: string },
      "ipc.workspace.create.response"
    > = createIpcSuccessResponse(channel, { workspaceId: "ws-11" }, {
      metadata: { source: "desktop-host" },
    });

    const asTransportResponse: TransportResponse<
      { workspaceId: string },
      { reason?: string },
      "workspace.create",
      { source: string }
    > = ipcResponse;

    expect(asTransportResponse).toEqual(ipcResponse);
  });
});
