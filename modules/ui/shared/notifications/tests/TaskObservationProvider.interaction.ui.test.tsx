// @vitest-environment jsdom
import { act, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import { TaskObservationProvider, useTaskObservationManager } from "../TaskObservationProvider";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("TaskObservationProvider", () => {
  it("starts hidden without requests, restores immediately, survives StrictMode and disposes after unmount", async () => {
    vi.useFakeTimers();
    let visibility = "hidden";
    const descriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    const read = vi.fn(async () => ({ value: "progress", activity: "active" as const }));
    const publish = vi.fn();
    function Probe() {
      const manager = useTaskObservationManager();
      useEffect(() => manager.subscribe({ workspaceId: "workspace-a", family: "context" }, read, publish), [manager]);
      return null;
    }
    const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
    try {
      await act(async () => { root.render(<StrictMode><TaskObservationProvider><Probe /></TaskObservationProvider></StrictMode>); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(read).toHaveBeenCalledTimes(0);
      visibility = "visible";
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
      expect(read).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(read).toHaveBeenCalledTimes(2);
      await act(async () => { root.unmount(); await Promise.resolve(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      container.remove(); vi.useRealTimers();
      if (descriptor) Object.defineProperty(document, "visibilityState", descriptor); else delete (document as any).visibilityState;
    }
  });
});
