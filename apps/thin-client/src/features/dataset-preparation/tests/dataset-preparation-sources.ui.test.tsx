// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createApiArtifactBrowserClient } from "../../artifact-browser/api/apiArtifactBrowserClient";
import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement;
const preparation = { start: vi.fn(), read: vi.fn(), cancel: vi.fn() };
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const source = (id: string) => ({ artifactId: id, originalName: `${id}.jsonl`, storageKey: `uploads/${id}.jsonl`, artifactFamily: "tabular", mediaType: "application/x-ndjson" });
async function render(client: any, workspaceId = "workspace-a") {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(<DatasetPreparationFeature workspaceId={workspaceId} artifactClient={client} preparationClient={preparation as any} />));
}
it("distinguishes pending, safe failed/retry, and successfully empty sources", async () => {
  const first = deferred<any[]>(), client = { browseArtifacts: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([]) };
  await render(client); expect(container.textContent).toContain("Loading source files"); expect(container.textContent).not.toContain("Add a compatible dataset");
  await act(async () => first.reject(new Error("private-token C:/private/source")));
  expect(container.textContent).toContain("Source files could not be loaded"); expect(container.textContent).not.toContain("private-token"); expect(container.textContent).not.toContain("Add a compatible dataset");
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Retry source files")!.click());
  expect(container.textContent).toContain("Add a compatible dataset"); expect(client.browseArtifacts).toHaveBeenCalledTimes(2);
});
it.each(["success", "failure"])("ignores replaced-client %s and preserves later source selection", async outcome => {
  const first = deferred<any[]>(); await render({ browseArtifacts: () => first.promise });
  await render({ browseArtifacts: async () => [source("new")] });
  const checkbox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.parentElement?.textContent?.includes("new.jsonl"))!;
  await act(async () => checkbox.click()); expect(checkbox.checked).toBe(true);
  await act(async () => outcome === "success" ? first.resolve([source("old")]) : first.reject(new Error("old private error")));
  expect(container.textContent).toContain("new.jsonl"); expect(container.textContent).not.toContain("old.jsonl"); expect(container.textContent).not.toContain("Source files could not be loaded"); expect(checkbox.checked).toBe(true);
});
it("retires a pending old workspace and denies start before current sources arrive", async () => {
  const first = deferred<any[]>(), second = deferred<any[]>();
  const client = { browseArtifacts: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
  await render(client); await render(client, "workspace-b");
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Run checks and prepare")!.click());
  expect(preparation.start).not.toHaveBeenCalled();
  await act(async () => first.resolve([source("old")])); expect(container.textContent).not.toContain("old.jsonl"); expect(container.textContent).toContain("Loading source files");
  await act(async () => second.resolve([source("new")])); expect(container.textContent).toContain("new.jsonl");
});
it("clears ready selected sources when the workspace changes, even if source IDs collide", async () => {
  const later = deferred<any[]>();
  const client = { browseArtifacts: vi.fn().mockResolvedValueOnce([source("same")]).mockReturnValueOnce(later.promise) };
  await render(client);
  const checkbox = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.parentElement?.textContent?.includes("same.jsonl"))!;
  await act(async () => checkbox.click()); expect(checkbox.checked).toBe(true);
  await render(client, "workspace-b"); expect(container.textContent).toContain("Loading source files");
  await act(async () => later.resolve([source("same")]));
  const next = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.parentElement?.textContent?.includes("same.jsonl"))!;
  expect(next.checked).toBe(false);
});
it.each(["synchronous", "malformed"])("contains %s source failure and does not crash the form", async mode => {
  await render({ browseArtifacts: () => { if (mode === "synchronous") throw new Error("private detail"); return Promise.resolve([null]); } });
  expect(container.textContent).toContain("Source files could not be loaded"); expect(container.textContent).not.toContain("private detail");
});
it("ignores a late rejection after unmount", async () => {
  const first = deferred<any[]>(); await render({ browseArtifacts: () => first.promise }); await act(async () => root!.unmount()); root = undefined;
  await act(async () => first.reject(new Error("retired private failure")));
});

it("recovers a malformed successful HTTP source response through the real client and retry control", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true, value: { items: "private-wire-detail" } }) })
    .mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true, value: { items: [] } }) });
  vi.stubGlobal("fetch", fetchMock);
  await render(createApiArtifactBrowserClient());
  expect(container.textContent).toContain("Source files could not be loaded");
  expect(container.textContent).not.toContain("Add a compatible dataset");
  expect(container.textContent).not.toContain("private-wire-detail");
  expect(preparation.start).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Retry source files")!.click());
  expect(container.textContent).toContain("Add a compatible dataset");
  expect(container.textContent).not.toContain("Source files could not be loaded");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(init.body).workspaceId).toBe("workspace-a");
});
