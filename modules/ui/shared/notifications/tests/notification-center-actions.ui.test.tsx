// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationProvider, useNotificationCenter, type NotificationCenterApi } from "../NotificationProvider";
import { NotificationBell, NotificationViewport } from "../NotificationCenter";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, api: NotificationCenterApi;
function Probe() { api = useNotificationCenter(); return null; }
const button = (label: string) => Array.from(container.querySelectorAll("button")).find(x => x.textContent === label)!;
const bell = () => container.querySelector<HTMLButtonElement>("#application-notification-bell")!;
const panel = () => container.querySelector<HTMLElement>('[role="dialog"]')!;
beforeEach(async () => {
  vi.useFakeTimers(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<NotificationProvider><Probe /><NotificationBell /><NotificationViewport /></NotificationProvider>); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); });

describe("rendered notification actions", () => {
  it("clears visible completed outcomes while retaining active tasks and other workspaces", async () => {
    await act(async () => {
      api.setActiveWorkspaceId("workspace-a");
      for (const family of ["downloads", "context", "training", "preparation", "images"]) api.upsertActivity({ id: `workspace-a:${family}:fixture`, workspaceId: "workspace-a", title: `${family} task`, status: "running", progress: { percent: 25 } });
      api.upsertActivity({ id: "workspace-a:done", workspaceId: "workspace-a", title: "Completed A", status: "succeeded" });
      api.upsertActivity({ id: "workspace-b:done", workspaceId: "workspace-b", title: "Completed B", status: "failed" });
      api.publish({ workspaceId: "workspace-a", message: "Saved A.", tone: "success" });
    });
    await act(async () => { bell().click(); });
    expect(panel().textContent).not.toContain("Completed B");
    expect(panel().querySelectorAll("progress")).toHaveLength(5);
    await act(async () => { button("Clear completed").click(); });
    expect(panel().querySelectorAll("li")).toHaveLength(5);
    expect(panel().textContent).not.toMatch(/Completed A|Saved A/);
    expect(api.state.records.some(x => x.id === "workspace-b:done")).toBe(true);
    expect(panel().querySelectorAll('li [aria-label="Dismiss notification"]')).toHaveLength(0);
    await act(async () => { api.upsertActivity({ id: "workspace-a:images:fixture", workspaceId: "workspace-a", title: "images task", status: "succeeded", progress: { percent: 100 } }); });
    const terminal = Array.from(panel().querySelectorAll("li")).find(x => x.textContent?.includes("images task"))!;
    await act(async () => { terminal.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click(); });
    expect(panel().querySelectorAll("li")).toHaveLength(4);
    await act(async () => { api.setActiveWorkspaceId("workspace-b"); });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { bell().click(); });
    expect(panel().textContent).toContain("Completed B"); expect(panel().textContent).not.toContain("context task");
  });
  it("marks only visible records read and restores focus after keyboard or outside dismissal", async () => {
    await act(async () => {
      api.setActiveWorkspaceId("workspace-a");
      api.publish({ message: "Global outcome." });
      api.publish({ workspaceId: "workspace-a", message: "A outcome." });
      api.publish({ workspaceId: "workspace-b", message: "B outcome." });
    });
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 2 unread");
    await act(async () => { bell().click(); });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close notifications");
    expect(api.state.records.find(x => x.message === "B outcome.")?.unread).toBe(true);
    await act(async () => { api.publish({ workspaceId: "workspace-a", message: "New A outcome." }); });
    expect(button("Mark all read").disabled).toBe(false);
    await act(async () => { button("Mark all read").click(); });
    expect(button("Mark all read").disabled).toBe(true);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.activeElement).toBe(bell()); expect(bell().getAttribute("aria-expanded")).toBe("false");
    await act(async () => { bell().click(); });
    await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(bell());
  });
  it("renders inert, sanitized messages and preserves terminal task status across late progress", async () => {
    await act(async () => {
      api.setActiveWorkspaceId("workspace-a");
      api.publish({ workspaceId: "workspace-a", message: "<img src=x onerror=bad()> token=synthetic-notification-key C:\\private\\file.txt", tone: "error" });
      api.upsertActivity({ id: "workspace-a:fixture", workspaceId: "workspace-a", title: "Preparation", status: "failed", message: "Needs attention." });
      api.upsertActivity({ id: "workspace-a:fixture", workspaceId: "workspace-a", title: "Preparation", status: "running", message: "Old running update." });
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toMatch(/synthetic-notification-key|private|file\.txt/);
    await act(async () => { bell().click(); });
    expect(panel().textContent).toContain("Needs attention."); expect(panel().textContent).not.toContain("Old running update.");
    await act(async () => { button("Clear completed").click(); });
    expect(panel().textContent).toContain("No notifications yet.");
  });
});
