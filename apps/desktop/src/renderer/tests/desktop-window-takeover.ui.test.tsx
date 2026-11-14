// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { UiControlAttempt, UiControlLeaseTarget, UiControlRequestView } from "../../../../../modules/contracts/headless";
import { readUiControlLeaseTarget } from "../../../../../modules/contracts/headless";
import { useDesktopWindowTakeover } from "../features/workspace/hooks/useActiveWorkspaceTakeover";

test.each(["explicit revoke", "native retirement"] as const)("the desktop acknowledges the visible effect and fences context after %s", async mode => {
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
  let currentRead: (() => Promise<unknown>) | undefined;
  let acknowledgedAtView: string | undefined;
  const previous = Object.getOwnPropertyDescriptor(window, "desktopApi");
  const previousHidden = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  const publishWindowContext = vi.fn(async () => true);
  let notifyRetirement: ((attempt: UiControlAttempt) => void) | undefined;
  Object.defineProperty(window, "desktopApi", { configurable: true, value: {
    onWindowTakeoverRetired(listener: typeof notifyRetirement) {
      notifyRetirement = listener;
      return () => { notifyRetirement = undefined; };
    },
    async readWindowTakeover() {
      if (currentRead) return currentRead();
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
    await act(async () => notifyRetirement?.({ ...target, attemptId: id(99) }));
    expect(current.controller.getSnapshot().status).toBe("active");
    await act(async () => {
      if (mode === "native retirement") notifyRetirement?.(target);
      else current.controller.revoke();
    });
    expect(current.controller.getSnapshot().status).toBe("manual");
    expect(mount.querySelector("section")).toBeNull();
    const calls = publishWindowContext.mock.calls.length;
    const inFlight = Promise.withResolvers<void>();
    const reply = Promise.withResolvers<{ status: "ready"; request: UiControlRequestView }>();
    currentRead = () => { inFlight.resolve(); return reply.promise; };
    await act(async () => inFlight.promise);
    const oldPending = { ...request, target: { ...target, attemptId: id(10) }, status: "pending" as const };
    await act(async () => notifyRetirement?.(oldPending.target));
    await act(async () => reply.resolve({ status: "ready", request: oldPending }));
    currentRead = undefined;
    expect(current.controller.getSnapshot().status).toBe("manual");
    expect(publishWindowContext.mock.calls).toHaveLength(calls);
    const nextObservation = current.controller.beginObservation();
    const nextPending = { ...oldPending, target: { ...oldPending.target, attemptId: id(11) } };
    await act(async () => notifyRetirement?.(oldPending.target));
    await act(async () => nextObservation(nextPending));
    expect(current.controller.getSnapshot()).toEqual({ status: "pending", request: nextPending });
  } finally {
    await act(async () => root.unmount());
    expect(notifyRetirement).toBeUndefined();
    mount.remove();
    if (previous) Object.defineProperty(window, "desktopApi", previous);
    else Reflect.deleteProperty(window, "desktopApi");
    if (previousHidden) Object.defineProperty(document, "hidden", previousHidden);
    else Reflect.deleteProperty(document, "hidden");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
