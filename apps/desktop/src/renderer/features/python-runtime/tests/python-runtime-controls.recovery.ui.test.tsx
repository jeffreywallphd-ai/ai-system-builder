// @vitest-environment jsdom
import { act, StrictMode, Suspense, startTransition } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PythonRuntimeFooter } from "../components/PythonRuntimeFooter";
import { usePythonRuntimeFooter, type UsePythonRuntimeFooterResult } from "../hooks/usePythonRuntimeFooter";
import type { DesktopPythonRuntimeClient } from "../api/desktopPythonRuntimeClient";
import type { DesktopPythonRuntimeStatusSnapshot } from "../../../lib/desktopApi";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
type Snapshot = DesktopPythonRuntimeStatusSnapshot;
function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return { supervisorStatus: "ready", healthy: true, runtimeStatus: "ready", capabilities: ["prepare-training-dataset"], logs: [], loadedModels: [], activeTaskCount: 0, systemResources: { memoryUsagePercent: 45, cpuUsagePercent: 30, gpuUsagePercent: 0 }, ...overrides };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
function mockControl(impl: DesktopPythonRuntimeClient["controlRuntime"] = async () => snapshot()) { return vi.fn<DesktopPythonRuntimeClient["controlRuntime"]>(impl); }
let root: Root, container: HTMLDivElement, view: UsePythonRuntimeFooterResult;
function Probe({ client, enabled = true, pending }: { client: DesktopPythonRuntimeClient; enabled?: boolean; pending?: Promise<void> }) {
  view = usePythonRuntimeFooter({ client, enabled });
  if (pending) throw pending;
  return <><output data-state>{view.statusLabel}</output><output data-error>{view.error}</output><output data-logs>{view.logs.map(x => x.message).join("|")}</output></>;
}
async function render(client: DesktopPythonRuntimeClient, enabled = true) {
  await act(async () => { root.render(<Probe client={client} enabled={enabled} />); });
}
beforeEach(() => { vi.useFakeTimers(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); });

describe("owned Python runtime controls", () => {
  it("keeps an old ready read from overwriting a later Stop result", async () => {
    const read = deferred<Snapshot>(), control = deferred<Snapshot>();
    const client = { readStatus: vi.fn(() => read.promise), controlRuntime: mockControl(() => control.promise) };
    await render(client);
    let action!: Promise<void>;
    await act(async () => { action = view.onStop(); });
    expect(client.controlRuntime).toHaveBeenCalledExactlyOnceWith("stop");
    await act(async () => { control.resolve(snapshot({ supervisorStatus: "stopped", healthy: false })); await action; });
    expect(view.statusLabel).toBe("stopped");
    await act(async () => { read.resolve(snapshot()); });
    expect(view.statusLabel).toBe("stopped");
    expect(view.loading).toBe(false);
  });
  it("admits only one synchronous explicit control and never polls over it", async () => {
    const control = deferred<Snapshot>();
    const client = { readStatus: vi.fn(async () => snapshot()), controlRuntime: mockControl(() => control.promise) };
    await render(client);
    let actions!: Promise<void>[];
    await act(async () => { actions = [view.onStart(), view.onRestart(), view.onClearLogs()]; });
    expect(client.controlRuntime).toHaveBeenCalledExactlyOnceWith("start");
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(client.readStatus).toHaveBeenCalledTimes(1);
    await act(async () => { control.resolve(snapshot()); await Promise.all(actions); });
    expect(view.loading).toBe(false);
    await act(async () => { await view.onClearLogs(); });
    expect(client.controlRuntime.mock.calls.map(x => x[0])).toEqual(["start", "clear-logs"]);
  });
  it("retires old reads and control results after a committed client replacement", async () => {
    const oldRead = deferred<Snapshot>(), oldControl = deferred<Snapshot>();
    const a = { readStatus: vi.fn(() => oldRead.promise), controlRuntime: mockControl(() => oldControl.promise) };
    const b = { readStatus: vi.fn(async () => snapshot({ supervisorStatus: "stopped", healthy: false })), controlRuntime: mockControl(async () => snapshot()) };
    await render(a); const retired = view;
    let action!: Promise<void>;
    await act(async () => { action = view.onStart(); });
    await render(b);
    expect(view.statusLabel).toBe("stopped");
    await act(async () => { oldControl.resolve(snapshot()); oldRead.resolve(snapshot()); await action; await retired.onRestart(); });
    expect(view.statusLabel).toBe("stopped");
    expect(a.controlRuntime).toHaveBeenCalledTimes(1);
    expect(b.controlRuntime).not.toHaveBeenCalled();
  });
  it("does no read or control while disabled, including captured retired callbacks", async () => {
    const client = { readStatus: vi.fn(async () => snapshot()), controlRuntime: mockControl(async () => snapshot()) };
    await render(client, false);
    await act(async () => { await view.onStart(); await view.onRefresh(); });
    expect(client.readStatus).not.toHaveBeenCalled(); expect(client.controlRuntime).not.toHaveBeenCalled();
    await render(client); const retired = view;
    await render(client, false);
    await act(async () => { await retired.onRestart(); await view.onClearLogs(); await vi.advanceTimersByTimeAsync(25_000); });
    expect(client.controlRuntime).not.toHaveBeenCalled(); expect(client.readStatus).toHaveBeenCalledTimes(1);
    expect(view.statusLabel).toBe("unknown");
  });
  it("keeps the StrictMode current read and does not control on setup or cleanup", async () => {
    const old = deferred<Snapshot>();
    const client = { readStatus: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(snapshot()), controlRuntime: mockControl(async () => snapshot()) };
    await act(async () => { root.render(<StrictMode><Probe client={client} /></StrictMode>); });
    await act(async () => { old.resolve(snapshot({ supervisorStatus: "failed", healthy: false })); });
    await act(async () => { await view.onRefresh(); });
    expect(view.statusLabel).toBe("ready"); expect(client.controlRuntime).not.toHaveBeenCalled();
  });
  it("adopts changed earlier log entries even when length and last entry are equal", async () => {
    const last = { timestamp: "2026-10-28T00:00:01Z", level: "info" as const, message: "Current final entry." };
    const initial = snapshot({ logs: [{ ...last, message: "Old first entry." }, last] });
    const next = snapshot({ logs: [{ ...last, message: "Corrected first entry." }, last] });
    const client = { readStatus: vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(next), controlRuntime: mockControl(async () => next) };
    await render(client); await act(async () => { await view.onRefresh(); });
    expect(view.logs.map(x => x.message)).toEqual(["Corrected first entry.", "Current final entry."]);
  });
  it("prepares malformed consumed status inside the read boundary and recovers explicitly", async () => {
    const client = { readStatus: vi.fn().mockResolvedValueOnce({ ...snapshot(), capabilities: null }).mockResolvedValue(snapshot()), controlRuntime: mockControl(async () => snapshot()) };
    await render(client); expect(view.error).toBeTruthy(); expect(view.statusLabel).toBe("unknown");
    await act(async () => { await view.onRefresh(); });
    expect(view.statusLabel).toBe("ready"); expect(view.error).toBeUndefined();
  });
  it("renders the real control actions and fixed failure copy without starting a runtime implicitly", async () => {
    const client: DesktopPythonRuntimeClient = { readStatus: vi.fn(async () => snapshot()), controlRuntime: mockControl().mockRejectedValueOnce(new Error("token=synthetic-runtime-secret C:\\private\\worker.py")).mockResolvedValue(snapshot()) };
    await act(async () => { root.render(<PythonRuntimeFooter enabled client={client} />); });
    expect(client.controlRuntime).not.toHaveBeenCalled();
    const button = (text: string) => Array.from(container.querySelectorAll("button")).find(x => x.textContent === text)!;
    await act(async () => { button("Start").click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(container.textContent).not.toMatch(/synthetic-runtime-secret|private|worker\.py/);
    await act(async () => { button("Refresh").click(); });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    for (const text of ["Stop", "Restart", "Clear log"]) await act(async () => { button(text).click(); });
    expect(vi.mocked(client.controlRuntime).mock.calls.map(x => x[0])).toEqual(["start", "stop", "restart", "clear-logs"]);
    expect(container.querySelector('[aria-label="System resource tracker"]')?.textContent).toContain("45.0%");
  });
  it("announces an explicit pending control and releases its disabled buttons after the reply", async () => {
    const control = deferred<Snapshot>();
    const client = { readStatus: vi.fn(async () => snapshot()), controlRuntime: mockControl(() => control.promise) };
    await act(async () => { root.render(<PythonRuntimeFooter enabled client={client} />); });
    const start = Array.from(container.querySelectorAll("button")).find(x => x.textContent === "Start")!;
    await act(async () => { start.click(); });
    expect(container.querySelector("footer")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Waiting for the runtime response");
    expect(Array.from(container.querySelectorAll("button")).every(x => x.disabled)).toBe(true);
    await act(async () => { control.resolve(snapshot({ supervisorStatus: "starting", healthy: false })); });
    expect(container.querySelector("footer")?.getAttribute("aria-busy")).toBe("false");
    expect(start.disabled).toBe(false); expect(container.textContent).toContain("starting");
  });
  it("recovers a failed status read through the rendered Refresh without sending a control", async () => {
    const client = { readStatus: vi.fn().mockRejectedValueOnce(new Error("private-synthetic-path")).mockResolvedValue(snapshot()), controlRuntime: mockControl() };
    await act(async () => { root.render(<PythonRuntimeFooter enabled client={client} />); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Select Refresh");
    expect(container.textContent).not.toContain("private-synthetic-path");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(x => x.textContent === "Refresh")!.click(); });
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain("ready");
    expect(client.controlRuntime).not.toHaveBeenCalled();
  });
  it("does not retire the visible client when a replacement render suspends", async () => {
    const oldRead = deferred<Snapshot>();
    const a = { readStatus: vi.fn().mockReturnValueOnce(oldRead.promise).mockResolvedValue(snapshot()), controlRuntime: mockControl() };
    const b = { readStatus: vi.fn(async () => snapshot()), controlRuntime: mockControl() };
    await act(async () => { root.render(<Suspense fallback={<span>Pending</span>}><Probe client={a} /></Suspense>); });
    const visible = view;
    await act(async () => { startTransition(() => root.render(<Suspense fallback={<span>Pending</span>}><Probe client={b} pending={new Promise<void>(() => {})} /></Suspense>)); });
    expect(b.readStatus).not.toHaveBeenCalled();
    await act(async () => { oldRead.resolve(snapshot({ supervisorStatus: "stopped", healthy: false })); });
    expect(container.querySelector("[data-state]")?.textContent).toBe("stopped");
    await act(async () => { await visible.onRefresh(); });
    expect(a.readStatus).toHaveBeenCalledTimes(2); expect(b.readStatus).not.toHaveBeenCalled();
  });
  it("refuses captured callbacks after the controls unmount", async () => {
    const client = { readStatus: vi.fn(async () => snapshot()), controlRuntime: mockControl() };
    await render(client); const retired = view;
    await act(async () => { root.render(<p>Controls closed</p>); });
    await act(async () => { await retired.onStart(); await retired.onRefresh(); await vi.advanceTimersByTimeAsync(25_000); });
    expect(client.readStatus).toHaveBeenCalledTimes(1); expect(client.controlRuntime).not.toHaveBeenCalled();
  });
  it("blocks same-turn controls while an explicit Refresh owns a pending read", async () => {
    const read = deferred<Snapshot>();
    const client = { readStatus: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(read.promise), controlRuntime: mockControl() };
    await render(client); let refresh!: Promise<void>;
    await act(async () => { refresh = view.onRefresh(); await view.onStart(); await view.onStop(); await view.onClearLogs(); });
    expect(client.controlRuntime).not.toHaveBeenCalled();
    expect(view.loading).toBe(true);
    await act(async () => { read.resolve(snapshot()); await refresh; });
    await act(async () => { await view.onStop(); });
    expect(client.controlRuntime).toHaveBeenCalledExactlyOnceWith("stop");
  });
  it("joins a background resource read for foreground Refresh and includes its logs", async () => {
    const read = deferred<Snapshot>();
    const client = { readStatus: vi.fn().mockResolvedValueOnce(snapshot()).mockReturnValueOnce(read.promise), controlRuntime: mockControl() };
    await render(client);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    let refresh!: Promise<void>;
    await act(async () => { refresh = view.onRefresh(); await view.onRestart(); });
    expect(client.controlRuntime).not.toHaveBeenCalled(); expect(client.readStatus).toHaveBeenCalledTimes(2);
    expect(view.loading).toBe(true);
    await act(async () => { read.resolve(snapshot({ logs: [{ timestamp: "2026-10-28T00:00:00Z", level: "info", message: "Fresh status log." }] })); await refresh; });
    expect(view.logs.map(x => x.message)).toEqual(["Fresh status log."]); expect(view.loading).toBe(false);
  });
  it.each(["resolve", "reject"] as const)("retains an invalidated physical read until %s, then issues one fresh foreground read", async outcome => {
    const old = deferred<Snapshot>();
    const current = snapshot({ supervisorStatus: "stopped", healthy: false, logs: [{ timestamp: "2026-10-28T00:00:00Z", level: "info", message: "Current stopped status." }] });
    const client = { readStatus: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(current), controlRuntime: mockControl(async () => current) };
    await render(client);
    await act(async () => { await view.onStop(); await vi.advanceTimersByTimeAsync(25_000); });
    expect(view.statusLabel).toBe("stopped"); expect(client.readStatus).toHaveBeenCalledTimes(1);
    let refresh!: Promise<void>;
    await act(async () => { refresh = view.onRefresh(); await vi.advanceTimersByTimeAsync(25_000); });
    expect(view.loading).toBe(true); expect(client.readStatus).toHaveBeenCalledTimes(1);
    expect(client.controlRuntime).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === "resolve") old.resolve(snapshot()); else old.reject(new Error("private-retired-read-error"));
      await refresh;
    });
    expect(client.readStatus).toHaveBeenCalledTimes(2);
    expect(view.statusLabel).toBe("stopped"); expect(view.loading).toBe(false); expect(view.error).toBeUndefined();
    expect(view.logs.map(x => x.message)).toEqual(["Current stopped status."]);
    expect(container.textContent).not.toContain("private-retired-read-error");
  });
});
