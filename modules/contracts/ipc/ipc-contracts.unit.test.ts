import { describe, expect, it } from "../../testing/node-test";

import {
  createIpcChannel,
  createIpcChannelValue,
  createIpcError,
  createIpcFailureResponse,
  createIpcRequest,
  createIpcSuccessResponse,
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_OPERATION,
  DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL,
  createDesktopRuntimeCapabilityStatusReadRequest,
  createDesktopRuntimeReadinessReadRequest,
  createDesktopRuntimeReadinessReadSuccessResponse,
  getDesktopRuntimeCapabilityStatusReadChannel,
  isIpcChannelValueForOperation,
  parseIpcChannelValue,
  DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_TRANSCRIPT_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL,
  type DesktopConversationCreateSessionRequestPayload,
  type DesktopConversationSubmitTurnRequestPayload,
  type DesktopConversationTranscriptPayload,
  type DesktopConversationSessionListItemPayload,
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

describe("desktop runtime readiness ipc contracts", () => {
  it("creates host-scoped readiness read requests and success responses", () => {
    const request = createDesktopRuntimeReadinessReadRequest(
      {
        boundary: { host: "desktop", source: " desktop.renderer.runtime-readiness " },
      },
      { requestId: "req-ready-1", correlationId: "corr-ready-1" },
    );

    expect(request).toMatchObject({
      channel: DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL.value,
      operation: DESKTOP_RUNTIME_READINESS_READ_OPERATION,
      requestId: "req-ready-1",
      correlationId: "corr-ready-1",
      payload: { boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" } },
    });

    const response = createDesktopRuntimeReadinessReadSuccessResponse({
      status: "ready",
      healthy: true,
      available: true,
      capabilities: [],
      updatedAt: "2026-05-06T00:00:00.000Z",
    }, { requestId: request.requestId, correlationId: request.correlationId });

    expect(response).toMatchObject({
      ok: true,
      channel: DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL.value,
      operation: DESKTOP_RUNTIME_READINESS_READ_OPERATION,
      requestId: "req-ready-1",
      correlationId: "corr-ready-1",
    });
  });

  it("normalizes capability ids for capability status read requests", () => {
    const request = createDesktopRuntimeCapabilityStatusReadRequest({
      capabilityId: " Python-Runtime " as any,
      boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" },
    });

    expect(request.payload.capabilityId).toBe("python-runtime");
    expect(request.channel).toBe(DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL.value);
    expect(getDesktopRuntimeCapabilityStatusReadChannel("response")).toBe(DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL);
  });

  it("rejects unknown runtime capability ids in capability status requests", () => {
    expect(() => createDesktopRuntimeCapabilityStatusReadRequest({
      capabilityId: "unknown-runtime" as any,
      boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" },
    })).toThrow("Unknown runtime capability id");
  });
});

describe("desktop conversation execution ipc contracts", () => {
  it("keeps conversation channels versioned and host scoped", () => {
    expect(DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL.value).toBe("ipc.conversations.execution.create-session.request");
    expect(DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL.value).toBe("ipc.conversations.execution.list-sessions.request");
    expect(DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL.value).toBe("ipc.conversations.execution.submit-turn.request");
  });

  it("uses safe session creation input without caller supplied display identity", () => {
    const payload = {
      workspaceId: "workspace.1",
      sourceExecutionPlanId: "execution.plan.1",
    } satisfies DesktopConversationCreateSessionRequestPayload;
    expect(Object.keys(payload).sort()).toEqual(["sourceExecutionPlanId", "workspaceId"]);
  });

  it("keeps submit-turn input to visible text and operation identity", () => {
    const payload = {
      workspaceId: "workspace.1",
      conversationSessionId: "conversation.session.1",
      text: "hello",
      operationId: "operation.1",
    } satisfies DesktopConversationSubmitTurnRequestPayload;
    expect(Object.keys(payload).sort()).toEqual(["conversationSessionId", "operationId", "text", "workspaceId"]);
    expect(JSON.stringify(payload)).not.toContain("runtime");
    expect(JSON.stringify(payload)).not.toContain("prompt");
    expect(JSON.stringify(payload)).not.toContain("provider");
  });

  it("designates transcript as the content-bearing read surface", () => {
    const transcript = {
      ok: true,
      turns: [{
        turnId: "turn.1",
        sequence: 1,
        turnStatus: "completed",
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:01.000Z",
        activityState: "completed",
        userMessage: { id: "message.1", role: "user", text: "visible user text", createdAt: "2026-05-22T00:00:00.000Z" },
        assistantResponse: { id: "message.2", role: "assistant", text: "visible assistant text", createdAt: "2026-05-22T00:00:01.000Z" },
      }],
    } satisfies DesktopConversationTranscriptPayload;
    expect(DESKTOP_CONVERSATION_EXECUTION_V2_READ_TRANSCRIPT_REQUEST_CHANNEL.value).toContain("read-transcript");
    expect(JSON.stringify(transcript)).toContain("visible assistant text");
  });

  it("keeps session list payload operational rather than transcript-bearing", () => {
    const item = {
      conversationSessionId: "conversation.session.1",
      sessionLabel: "Verified assistant",
      sourceExecutionPlanId: "execution.plan.1",
      sessionStatus: "active",
      approvalStatus: "granted",
      runtimeStatus: "ready",
      turnCount: 1,
      latestAssistantResponseAvailable: true,
      latestActivityAt: "2026-05-22T00:00:00.000Z",
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      actions: { mayOpen: true, mayApprove: false, maySubmitMessage: true, mayClose: true, mayArchive: false, mayCancel: false, mayRetry: false },
      availability: {
        setupStatus: "ready",
        hostSubmitSupport: "supported",
        cancellation: { supported: false, available: false },
        retry: { supported: false, available: false, deferred: true },
        streaming: { supported: false, available: false },
      },
    } satisfies DesktopConversationSessionListItemPayload;
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("visible user text");
    expect(serialized).not.toContain("visible assistant text");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("provider");
  });
});
