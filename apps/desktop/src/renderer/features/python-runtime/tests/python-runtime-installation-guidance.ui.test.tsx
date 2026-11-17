// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { DesktopPythonRuntimeStatusSnapshot } from "../../../lib/desktopApi";
import type { DesktopPythonRuntimeClient } from "../api/desktopPythonRuntimeClient";
import { PythonRuntimeFooter } from "../components/PythonRuntimeFooter";

it("shows recovery for an unsupported Python interpreter and clears it after recovery", async () => {
  const diagnostics = { schemaVersion: "1", attempt: 1, outcome: "failed", phase: "context", reason: "unsupported-python", dependencies: [], stages: [] } as const;
  const failed: DesktopPythonRuntimeStatusSnapshot = {
    supervisorStatus: "failed", healthy: false, runtimeStatus: "failed", startupDiagnostics: diagnostics,
    capabilities: [], logs: [], loadedModels: [], activeTaskCount: 0,
    systemResources: { memoryUsagePercent: 0, cpuUsagePercent: 0, gpuUsagePercent: 0 },
  };
  const client = {
    readStatus: vi.fn<DesktopPythonRuntimeClient["readStatus"]>()
      .mockResolvedValueOnce({ ...failed, startupDiagnostics: { ...diagnostics, reason: "install-failed" } })
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce({ ...failed, supervisorStatus: "ready", runtimeStatus: "ready", healthy: true }),
    controlRuntime: vi.fn<DesktopPythonRuntimeClient["controlRuntime"]>(),
  };
  const guidance = "Install Python 3.14, then reopen AI System Builder and retry the download.";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<PythonRuntimeFooter enabled client={client} />); });
    expect(container.textContent).not.toContain(guidance);
    const refresh = [...container.querySelectorAll("button")].find(button => button.textContent === "Refresh")!;
    await act(async () => refresh.click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain(guidance);
    await act(async () => refresh.click());
    expect(container.textContent).not.toContain(guidance);
    expect(client.controlRuntime).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
