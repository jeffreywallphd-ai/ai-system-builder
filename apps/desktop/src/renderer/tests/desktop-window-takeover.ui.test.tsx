// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { UiControlLeaseTarget, UiControlRequestView } from "../../../../../modules/contracts/headless";
import { readUiControlLeaseTarget } from "../../../../../modules/contracts/headless";
import { useDesktopWindowTakeover } from "../features/workspace/hooks/useActiveWorkspaceTakeover";

test("the desktop hook commits a real visible presentation before acknowledgment and never answers context after revoke", async () => {
  const host = "b4d241c0-c0a4-42ca-ae65-be1ccff1b068";
  const id = (n: number) => `a28b2b28-3baa-4cce-b6ae-${String(n).padStart(12, "0")}`;
  const lease: UiControlLeaseTarget = readUiControlLeaseTarget({
    hostIncarnationId: host, uiIncarnationId: id(1), windowId: id(2), workspaceId: "sample",
    requestId: id(3), attemptId: id(4), leaseId: id(5), generation: 1,
  })!;
  const { leaseId: _leaseId, generation: _generation, ...target } = lease;
  let request: UiControlRequestView = { target, status: "pending", agentSessionId: id(6), taskId: id(7), expiresAt: 5000 };
  const grant = { target: lease, remainingMs: 5000 };
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  let current!: ReturnType<typeof useDesktopWindowTakeover>;
  let served = false;
  let acknowledgedAtView: string | undefined;
  const previous = Object.getOwnPropertyDescriptor(window, "desktopApi");
  const previousHidden = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const publishWindowContext = vi.fn(async () => true);
  Object.defineProperty(window, "desktopApi", { configurable: true, value: {
    async readWindowTakeover() {
      return request.status === "active" ? { status: "ready", request, lease: grant, contextChallenge: id(8) } : { status: "ready", request };
    },
    async acceptWindowTakeover() { return grant; },
    async readyWindowTakeover() { request = { ...request, status: "active" }; return grant; },
    async revokeWindowTakeover() { return false; }, // Main process never receives this revoke.
    async pullWindowPresentation() {
      if (served) return { status: "empty" };
      served = true;
      return { status: "command", detail: { title: "Exact saved resource" }, command: {
        target: lease, sequence: 1, commandId: id(9), remainingMs: 3000,
        intent: { action: "open-system", systemId: "sample-system", revisionId: "revision-one" },
      } };
    },
    async acknowledgeWindowPresentation() {
      acknowledgedAtView = mount.querySelector("section")?.textContent ?? undefined;
      return true;
    },
    publishWindowContext,
  } });
  const previousAct = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  function Witness() {
    current = useDesktopWindowTakeover("sample", false);
    return current.presented ? <section ref={current.presentedElement}>{current.presented.detail.title}</section> : null;
  }
  try {
    await act(async () => root.render(<Witness />));
    expect(current.controller.getSnapshot().status).toBe("pending");
    await act(async () => current.controller.accept());
    await vi.waitFor(() => expect(acknowledgedAtView).toBe("Exact saved resource"));
    await vi.waitFor(() => expect(publishWindowContext).toHaveBeenCalledWith(expect.objectContaining({
      target: lease, challenge: id(8), context: expect.objectContaining({
        view: "system", selection: { action: "open-system", systemId: "sample-system", revisionId: "revision-one" },
      }),
    })));
    await act(async () => current.controller.revoke());
    expect(current.controller.getSnapshot().status).toBe("manual");
    expect(mount.querySelector("section")).toBeNull();
    const calls = publishWindowContext.mock.calls.length;
    await act(async () => new Promise(resolve => setTimeout(resolve, 330)));
    expect(publishWindowContext.mock.calls).toHaveLength(calls);
  } finally {
    await act(async () => root.unmount());
    mount.remove();
    if (previous) Object.defineProperty(window, "desktopApi", previous);
    else Reflect.deleteProperty(window, "desktopApi");
    if (previousHidden) Object.defineProperty(document, "hidden", previousHidden);
    else Reflect.deleteProperty(document, "hidden");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
