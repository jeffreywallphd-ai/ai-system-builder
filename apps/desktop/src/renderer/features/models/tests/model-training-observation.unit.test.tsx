// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useModelTrainingFeature } from "../hooks/useModelTrainingFeature";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let container: HTMLDivElement | undefined;
beforeEach(() => { (window as any).desktopApi = {}; });
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); sessionStorage.clear(); root = undefined; });

function Probe({ client, workspaceId }: { client: any; workspaceId: string }) {
  const view = useModelTrainingFeature(client, workspaceId);
  return <output>{view.result?.runId ?? "none"}:{view.message}</output>;
}
function mount(client: any, workspaceId: string) {
  container ??= document.createElement("div"); document.body.appendChild(container);
  root ??= createRoot(container);
  return <Probe client={client} workspaceId={workspaceId} />;
}

it("reopens a saved task identity into explicit review without publishing a model", async () => {
  sessionStorage.setItem("ai-system-builder.training-task.v1:workspace-a", "run-a");
  const client = { listModels: vi.fn(async () => []), readModelTrainingStatus: vi.fn(async () => ({ runId: "run-a", status: "succeeded", reviewPending: true })), saveModelTraining: vi.fn() };
  const probe = mount(client, "workspace-a"); await act(async () => { root!.render(probe); });
  expect(container!.textContent).toContain("run-a:Training completed. Save or discard");
  expect(client.readModelTrainingStatus).toHaveBeenCalledWith({ runId: "run-a", workspaceId: "workspace-a" });
  expect(client.saveModelTraining).not.toHaveBeenCalled();
});

it("does not publish a late task reply or reuse its ID in another workspace", async () => {
  sessionStorage.setItem("ai-system-builder.training-task.v1:workspace-a", "run-a");
  let release!: (value: any) => void;
  const pending = new Promise((resolve) => { release = resolve; });
  const client = { listModels: vi.fn(async () => []), readModelTrainingStatus: vi.fn(() => pending) };
  const a = mount(client, "workspace-a"); await act(async () => { root!.render(a); });
  const b = mount(client, "workspace-b"); await act(async () => { root!.render(b); });
  await act(async () => { release({ runId: "run-a", status: "succeeded", reviewPending: true }); await Promise.resolve(); });
  expect(container!.textContent).not.toContain("run-a");
  expect(client.readModelTrainingStatus.mock.calls.every(([request]) => request.workspaceId === "workspace-a")).toBe(true);
});
