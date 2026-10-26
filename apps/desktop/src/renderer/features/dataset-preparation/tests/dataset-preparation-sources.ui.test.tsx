// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";
import { resetDatasetPreparationPageStateForTests, useDatasetPreparationFeature } from "../hooks/useDatasetPreparationFeature";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
let feature: ReturnType<typeof useDatasetPreparationFeature>;
afterEach(() => {
  act(() => root?.unmount()); container?.remove(); root = undefined;
  resetDatasetPreparationPageStateForTests(); delete window.desktopApi;
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const source = (id: string) => ({ artifactId: id, label: `${id}.jsonl`, storageKey: `uploads/${id}.jsonl`, mediaType: "application/x-ndjson" });
function Probe({ client, workspaceId }: { client: any; workspaceId: string }) {
  feature = useDatasetPreparationFeature({ client, workspaceId });
  return <output>{feature.sourceLoadStatus}:{feature.artifacts.map(item => item.label).join(",")}</output>;
}
async function render(client: any, workspaceId = "workspace-a", ui = false) {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(ui
    ? <DatasetPreparationFeature client={client} workspaceId={workspaceId} />
    : <Probe client={client} workspaceId={workspaceId} />));
}
it("shows truthful loading, safe failure, direct retry and successful empty in the real form", async () => {
  const first = deferred<any[]>();
  const client = { browseSourceArtifacts: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([]) };
  await render(client, "workspace-a", true);
  expect(container.textContent).toContain("Loading source files"); expect(container.textContent).not.toContain("No artifacts available yet");
  await act(async () => first.reject(new Error("private-token C:/private/source")));
  expect(container.textContent).toContain("Source files could not be loaded"); expect(container.textContent).not.toContain("private-token");
  expect(container.textContent).not.toContain("No artifacts available yet");
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Retry source files")!.click());
  expect(container.textContent).toContain("No artifacts available yet"); expect(client.browseSourceArtifacts).toHaveBeenCalledTimes(2);
});
it.each(["success", "failure"])("ignores late old workspace %s", async outcome => {
  const first = deferred<any[]>();
  const client = { browseSourceArtifacts: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([source("new")]) };
  await render(client); await render(client, "workspace-b");
  await act(async () => feature.onToggleArtifact("new"));
  await act(async () => outcome === "success" ? first.resolve([source("old")]) : first.reject(new Error("old private error")));
  expect(feature.sourceLoadStatus).toBe("ready"); expect(feature.artifacts.map(item => item.artifactId)).toEqual(["new"]);
  expect(feature.selectedArtifactIds).toEqual(["new"]); expect(feature.status.message ?? "").not.toContain("old private");
});
it("retires a replaced client in the same workspace", async () => {
  const first = deferred<any[]>(); await render({ browseSourceArtifacts: () => first.promise });
  await render({ browseSourceArtifacts: async () => [source("new")] });
  await act(async () => first.resolve([source("old")]));
  expect(feature.artifacts.map(item => item.artifactId)).toEqual(["new"]); expect(feature.sourceLoadStatus).toBe("ready");
});
it("keeps the newest same-scope retry and preserves selection after an older reply", async () => {
  const old = deferred<any[]>();
  const client = { browseSourceArtifacts: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue([source("new")]) };
  await render(client); await act(async () => feature.retrySourceArtifacts()); await act(async () => feature.onToggleArtifact("new"));
  await act(async () => old.resolve([source("old")])); expect(feature.selectedArtifactIds).toEqual(["new"]);
  expect(feature.artifacts.map(item => item.artifactId)).toEqual(["new"]);
});
it("denies dispatch while sources are unavailable and rejects malformed source values", async () => {
  const first = deferred<any[]>(), start = vi.fn();
  await render({ browseSourceArtifacts: () => first.promise, startPrepareTrainingDataset: start });
  await act(async () => feature.onSubmit({ preventDefault() {} } as any)); expect(start).not.toHaveBeenCalled();
  expect(feature.status.message).toContain("Wait for the current source files");
  await act(async () => first.resolve([null] as any)); expect(feature.sourceLoadStatus).toBe("failed"); expect(feature.artifacts).toEqual([]);
});
it("does not apply a pending reply after unmount", async () => {
  const first = deferred<any[]>(); await render({ browseSourceArtifacts: () => first.promise });
  await act(async () => root!.unmount()); root = undefined; await act(async () => first.reject(new Error("retired failure")));
});
