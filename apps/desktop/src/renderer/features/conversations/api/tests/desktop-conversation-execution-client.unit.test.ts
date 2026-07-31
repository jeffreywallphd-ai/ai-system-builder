import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../../../../modules/testing/node-test";
import { createDesktopConversationExecutionClient } from "../desktopConversationExecutionClient";

describe("desktopConversationExecutionClient", () => {
  it("calls matching preload methods", async () => {
    const create = testDouble.fn<
      (input: {
        workspaceId: string;
        sourceExecutionPlanId: string;
      }) => Promise<{ ok: true; value: { conversationSessionId: string } }>
    >(async () => ({ ok: true, value: { conversationSessionId: "s1" } }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopApi: { createConversationExecutionSessionFromPlan: create },
      },
    });
    const client = createDesktopConversationExecutionClient();
    await client.createConversationSessionFromPlan({
      workspaceId: "w",
      sourceExecutionPlanId: "plan",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toEqual({
      workspaceId: "w",
      sourceExecutionPlanId: "plan",
    });
  });

  it("unwraps authoritative nested operation results and preserves safe failures", async () => {
    const read = testDouble.fn(async () => ({
      ok: true as const,
      value: {
        kind: "success",
        value: { conversationSessionId: "s1", sessionStatus: "active" },
      },
    }));
    const approve = testDouble.fn(async () => ({
      ok: true as const,
      value: {
        kind: "failure",
        failureKind: "approval-required",
        diagnostics: [
          { code: "approval-required", message: "Approval is required." },
        ],
      },
    }));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        desktopApi: {
          readConversationSession: read,
          approveConversationSession: approve,
        },
      },
    });
    const client = createDesktopConversationExecutionClient();
    expect(
      await client.readConversationSession({
        workspaceId: "w",
        conversationSessionId: "s1",
      }),
    ).toEqual({
      ok: true,
      value: { conversationSessionId: "s1", sessionStatus: "active" },
    });
    expect(
      await client.approveConversationSession({
        workspaceId: "w",
        conversationSessionId: "s1",
        executionApprovalId: "approval-1",
      }),
    ).toEqual({
      ok: false,
      error: { code: "approval-required", message: "Approval is required." },
    });
  });

  it("fails safely when preload method is unavailable", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { desktopApi: {} },
    });
    const client = createDesktopConversationExecutionClient();
    const result = await client.submitConversationTurn({
      workspaceId: "w",
      conversationSessionId: "s",
      text: "hi",
      operationId: "op",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("exposes safe host capabilities without streaming cancel or retry claims", () => {
    const capabilities =
      createDesktopConversationExecutionClient().readCapabilities();
    expect(capabilities.submitTurn).toEqual({
      transport: true,
      hostSupport: "supported",
      streaming: false,
    });
    expect(capabilities.cancellation).toEqual({
      supported: false,
      deferred: true,
    });
    expect(capabilities.retry).toEqual({ supported: false, deferred: true });
  });
});
