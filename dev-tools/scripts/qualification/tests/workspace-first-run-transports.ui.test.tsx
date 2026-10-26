// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ActiveWorkspaceProvider as DesktopProvider, useActiveWorkspace as useDesktopWorkspace } from "../../../../apps/desktop/src/renderer/features/workspace/hooks/useActiveWorkspace";
import { WorkspaceSwitcher as DesktopSwitcher } from "../../../../apps/desktop/src/renderer/features/workspace/components/WorkspaceSwitcher";
import { WorkspaceGate as DesktopGate } from "../../../../apps/desktop/src/renderer/features/workspace/components/WorkspaceGate";
import { ActiveWorkspaceProvider as BrowserProvider, useActiveWorkspace as useBrowserWorkspace } from "../../../../apps/thin-client/src/features/workspace/hooks/useActiveWorkspace";
import { WorkspaceSwitcher as BrowserSwitcher } from "../../../../apps/thin-client/src/features/workspace/components/WorkspaceSwitcher";
import { WorkspaceGate as BrowserGate } from "../../../../apps/thin-client/src/features/workspace/components/WorkspaceGate";
import { createDesktopPreloadApi } from "../../../../apps/desktop/src/preload/exposedApi";
import { registerWorkspaceIpc } from "../../../../modules/adapters/transport/ipc-electron/workspace/registerWorkspaceIpc";
import { registerWorkspaceApiRoutes } from "../../../../modules/adapters/transport/api-express/workspace/registerWorkspaceApiRoutes";
import type { IpcMainHandleListener, IpcMainHandlePort } from "../../../../modules/adapters/transport/ipc-electron/ipcMainHandlePort";
import { createLocalWorkspaceRepository } from "../../../../modules/adapters/persistence/workspace/createLocalWorkspaceRepository";
import { createLocalWorkspaceSelectionRepository } from "../../../../modules/adapters/persistence/workspace/createLocalWorkspaceSelectionRepository";
import { createLocalWorkspaceSystemPackActivationRepository } from "../../../../modules/adapters/persistence/workspace/createLocalWorkspaceSystemPackActivationRepository";
import { CreateWorkspaceUseCase } from "../../../../modules/application/use-cases/workspace/create-workspace.use-case";
import { createOrganizationId } from "../../../../modules/contracts/organization";
import type { ActiveWorkspaceSelection } from "../../../../modules/contracts/workspace";
import { DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL } from "../../../../modules/contracts/ipc";

type Host = "desktop" | "browser";
const organizationId = createOrganizationId("organization.workspace-ui-fixture");
const TOKEN_KEY = "ai-system-builder.paired-device-token", TOKEN = "synthetic-workspace-loopback-only";
const PRIVATE = "synthetic-private-selection-store-error";
const variants = { desktop: { Provider: DesktopProvider, Switcher: DesktopSwitcher, Gate: DesktopGate, useWorkspace: useDesktopWorkspace }, browser: { Provider: BrowserProvider, Switcher: BrowserSwitcher, Gate: BrowserGate, useWorkspace: useBrowserWorkspace } };
let root: Root | undefined, container: HTMLDivElement | undefined, directory: string | undefined, server: Server | undefined;
let identity: { dev: bigint; ino: bigint } | undefined, oldToken: string | null;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
let oldApi: PropertyDescriptor | undefined;
let repositories: ReturnType<typeof stores>, context: ReturnType<typeof useDesktopWorkspace>;
let createCalls = 0, createRequests = 0, transportCalls = 0, selectionFailure = false, creationFailure = false;
let selectionValue: unknown = undefined;
let createGate: Promise<void> | undefined, releaseCreate: (() => void) | undefined;
const flights = new Set<Promise<unknown>>(), fetchFlights = new Set<Promise<Response>>(), childReads: string[] = [];

// Real mounted forms/switchers/gates/default clients, actual IPC contracts or
// loopback routes, creation use case and new JSON repositories. Invoke, URL
// resolution and access middleware are fixtures. No physical host, sender-policy,
// production auth/SQLite or native-file qualification follows.
function stores() { const options = { rootDirectory: directory! }; return { workspaces: createLocalWorkspaceRepository(options), selection: createLocalWorkspaceSelectionRepository(options), activation: createLocalWorkspaceSystemPackActivationRepository(options) }; }
async function unmount() { if (root) await act(async () => root!.unmount()); root = undefined; container?.remove(); container = undefined; }
afterEach(async () => {
  try { await unmount(); await act(async () => { releaseCreate?.(); await Promise.allSettled([...flights, ...fetchFlights]); }); }
  finally {
    try {
      if (server) { const owned = server; await new Promise<void>((resolve, reject) => owned.close(error => error ? reject(error) : resolve())); expect(owned.listening).toBe(false); server = undefined; }
      if (directory) {
        const owned = directory, info = await lstat(owned, { bigint: true });
        expect({ dev: info.dev, ino: info.ino }).toEqual(identity); expect(info.isDirectory()).toBe(true); expect(info.isSymbolicLink()).toBe(false);
        expect(await realpath(owned)).toBe(owned); expect(path.dirname(owned)).toBe(await realpath(tmpdir()));
        let count = 0, size = 0;
        async function inspect(parent: string) { for (const name of await readdir(parent)) { const child = path.join(parent, name), current = await lstat(child); expect(++count).toBeLessThanOrEqual(128); expect(current.isSymbolicLink()).toBe(false); if (current.isDirectory()) await inspect(child); else { expect(current.isFile()).toBe(true); size += current.size; expect(size).toBeLessThanOrEqual(1024 * 1024); } } }
        await inspect(owned); await rm(owned, { recursive: true });
      }
    } finally {
      for (const [name, value] of descriptors) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); }
      if (oldApi) Object.defineProperty(window, "desktopApi", oldApi); else Reflect.deleteProperty(window, "desktopApi");
      if (oldToken === null) localStorage.removeItem(TOKEN_KEY); else if (oldToken !== undefined) localStorage.setItem(TOKEN_KEY, oldToken);
      descriptors.clear(); directory = undefined; identity = undefined; createGate = undefined; releaseCreate = undefined; flights.clear(); fetchFlights.clear(); childReads.length = 0; createCalls = createRequests = transportCalls = 0; selectionFailure = creationFailure = false; selectionValue = undefined; vi.restoreAllMocks();
    }
  }
});
function replaceGlobal(name: string, value: unknown) { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
async function compose(host: Host) {
  oldApi = Object.getOwnPropertyDescriptor(window, "desktopApi"); oldToken = localStorage.getItem(TOKEN_KEY);
  replaceGlobal("IS_REACT_ACT_ENVIRONMENT", true); replaceGlobal("FormData", window.FormData);
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "workspace-first-run-ui-")); const info = await lstat(directory, { bigint: true }); expect(info.ino).not.toBe(0n); identity = { dev: info.dev, ino: info.ino };
  repositories = stores();
  const read = repositories.selection.readActiveWorkspaceSelection.bind(repositories.selection);
  // Deliberately malformed port values test the actual success envelope, preload/
  // route and default renderer client. The real stored selection is untouched.
  vi.spyOn(repositories.selection, "readActiveWorkspaceSelection").mockImplementation(async () => { if (selectionFailure) throw new Error(PRIVATE); if (selectionValue !== undefined) return selectionValue as ActiveWorkspaceSelection; return read(); });
  const create = new CreateWorkspaceUseCase({ workspaceRepository: repositories.workspaces, workspaceSelectionRepository: repositories.selection, systemPackActivationRepository: repositories.activation, organizationId });
  const execute = create.execute.bind(create);
  vi.spyOn(create, "execute").mockImplementation(input => {
    expect(++createCalls).toBeLessThanOrEqual(4);
    const flight = (async () => { await createGate; if (creationFailure) throw new Error(PRIVATE); return execute(input); })(); flights.add(flight); void flight.then(() => flights.delete(flight), () => flights.delete(flight)); return flight;
  });
  if (host === "desktop") {
    const handlers = new Map<string, IpcMainHandleListener>();
    const ipcMain: IpcMainHandlePort = { handle<TRequest, TResponse>(channel: string, listener: IpcMainHandleListener<TRequest, TResponse>) { expect(handlers.has(channel)).toBe(false); handlers.set(channel, (event, request) => listener(event, request as TRequest)); } };
    registerWorkspaceIpc({ ipcMain, workspaceRepository: repositories.workspaces, workspaceSelectionRepository: repositories.selection, createWorkspaceUseCase: create });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: async (channel, request) => { expect(++transportCalls).toBeLessThanOrEqual(128); if (channel === DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL.value) createRequests++; const handler = handlers.get(channel); expect(Boolean(handler)).toBe(true); return handler!(Object.freeze({ inProcessFixture: true }), request); } } });
    const bridge: Pick<NonNullable<typeof window.desktopApi>, "listWorkspaces" | "createWorkspace" | "readActiveWorkspaceSelection" | "saveActiveWorkspaceSelection" | "clearActiveWorkspaceSelection"> = { listWorkspaces: api.listWorkspaces, createWorkspace: api.createWorkspace, readActiveWorkspaceSelection: api.readActiveWorkspaceSelection, saveActiveWorkspaceSelection: api.saveActiveWorkspaceSelection, clearActiveWorkspaceSelection: api.clearActiveWorkspaceSelection };
    Object.defineProperty(window, "desktopApi", { configurable: true, writable: true, value: bridge });
  } else {
    localStorage.setItem(TOKEN_KEY, TOKEN); const app = express(); app.use(express.json({ limit: "16kb", strict: true }));
    app.use((request, response, next) => { if (++transportCalls > 128) { response.status(429).json({ ok: false }); return; } if (request.headers.authorization !== `Bearer ${TOKEN}`) { response.status(401).json({ ok: false, error: { code: "unauthenticated", message: "Synthetic access denied." } }); return; } next(); });
    registerWorkspaceApiRoutes({ app, workspaceRepository: repositories.workspaces, workspaceSelectionRepository: repositories.selection, createWorkspaceUseCase: create });
    server = createServer(app); await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned workspace listener did not start.");
    const origin = `http://127.0.0.1:${address.port}`, originalFetch = globalThis.fetch;
    replaceGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input !== "string" || !/^\/api\/workspaces(?:\/active-selection(?:\/clear)?)?$/.test(input)) throw new Error("Unexpected workspace fixture URL.");
      if (input === "/api/workspaces" && init?.method === "POST") createRequests++;
      const flight = originalFetch(new URL(input, origin), init); fetchFlights.add(flight); void flight.then(() => fetchFlights.delete(flight), () => fetchFlights.delete(flight)); return flight;
    });
  }
}
function Surface({ host }: { host: Host }) {
  const variant = variants[host]; context = variant.useWorkspace(); const { Switcher, Gate } = variant;
  return <><output data-readiness>{context.status}</output><Switcher /><Gate pageLabel="Models">{workspace => <OwnedFeature workspaceId={workspace.id} />}</Gate></>;
}
function OwnedFeature({ workspaceId }: { workspaceId: string }) { useEffect(() => { childReads.push(workspaceId); }, [workspaceId]); return <p data-owned-feature>{workspaceId}</p>; }
async function mount(host: Host) { if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); } const { Provider } = variants[host]; await act(async () => root!.render(<Provider><Surface host={host} /></Provider>)); await settled(() => container!.querySelector("[data-readiness]")?.textContent !== "loading"); }
async function settled(predicate: () => boolean) { await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); expect(predicate()).toBe(true); }, { timeout: 2000, interval: 10 }); }
function button(name: string) { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === name); expect(Boolean(found)).toBe(true); return found!; }
async function name(value: string) { const input = document.querySelector<HTMLInputElement>('input[name="workspaceName"]')!; expect(Boolean(input)).toBe(true); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function records() { let result!: Awaited<ReturnType<typeof repositories.workspaces.listWorkspaces>>; await act(async () => { result = await repositories.workspaces.listWorkspaces(); }); return result; }

for (const host of ["desktop", "browser"] as const) {
  it(`${host}: creates two explicit workspaces, selects exact identity and reopens durable selection`, async () => {
    await compose(host); await mount(host); expect(context.status).toBe("missing"); expect(childReads).toEqual([]);
    await act(async () => button("Create workspace").click()); expect(document.querySelector('[role="alert"]')?.textContent).toBe("Enter a workspace name."); expect(createCalls).toBe(0);
    await name("  Support workspace  "); await act(async () => button("Create workspace").click()); await settled(() => context.status === "ready"); const first = (await records())[0]!;
    expect(first).toMatchObject({ displayName: "Support workspace", organizationId, settings: { defaultIncludeSystemFoundationAssets: true } }); expect(context.activeWorkspaceId).toBe(first.workspaceId);
    expect(await repositories.activation.listWorkspaceSystemPackActivations(first.workspaceId)).toMatchObject([{ packId: "system.foundation", sourceKind: "system", sourceLayer: "system-default", trustStatus: "system-trusted", status: "active" }]);
    await act(async () => button("Create new workspace").click()); await name("Invoice workspace"); await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await act(async () => button("Create workspace").click()); await settled(() => context.activeWorkspaceId !== first.workspaceId);
    const listed = await records(); expect(listed).toHaveLength(2); const second = listed.find(value => value.workspaceId !== first.workspaceId)!; expect(second).toMatchObject({ displayName: "Invoice workspace", settings: { defaultIncludeSystemFoundationAssets: false } }); expect(await repositories.activation.listWorkspaceSystemPackActivations(second.workspaceId)).toHaveLength(0);
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="Select workspace"]')!; await act(async () => { select.value = first.workspaceId; select.dispatchEvent(new Event("change", { bubbles: true })); }); await act(async () => button("Change workspace").click()); await settled(() => context.activeWorkspaceId === first.workspaceId);
    // Clear is the existing context API, not a product UI control invented by this test.
    await act(async () => context.clearActiveWorkspace()); expect(context.status).toBe("missing"); expect(document.querySelector("[data-owned-feature]")).toBeNull(); expect(await stores().selection.readActiveWorkspaceSelection()).toEqual({});
    await act(async () => button("Select Invoice workspace").click()); await settled(() => context.activeWorkspaceId === second.workspaceId);
    await unmount(); const reopened = stores(); expect((await reopened.workspaces.listWorkspaces()).map(value => value.workspaceId)).toEqual(listed.map(value => value.workspaceId)); expect((await reopened.selection.readActiveWorkspaceSelection()).workspaceId).toBe(second.workspaceId);
    await mount(host); expect(context.activeWorkspaceId).toBe(second.workspaceId); expect(document.querySelector("[data-owned-feature]")?.textContent).toBe(second.workspaceId); expect(createCalls).toBe(2); expect(document.body.textContent).not.toContain(directory!);
  });
  it(`${host}: admits only one pending creation before React updates the submit control`, async () => {
    await compose(host); await mount(host); await name("Single pending workspace"); createGate = new Promise(resolve => { releaseCreate = resolve; });
    await act(async () => { const submit = button("Create workspace"); submit.click(); submit.click(); }); expect(createRequests).toBe(1); expect(button("Create workspace").disabled).toBe(true); await settled(() => createCalls === 1); expect(await records()).toHaveLength(0);
    expect(document.querySelector("form")?.getAttribute("aria-busy")).toBe("true"); expect(document.querySelector<HTMLInputElement>('input[name="workspaceName"]')!.disabled).toBe(true); expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    await act(async () => { releaseCreate!(); await Promise.all([...flights]); }); await settled(() => context.status === "ready"); expect(await records()).toHaveLength(1);
  });
  it(`${host}: shows failed selection reads as an error and never mounts workspace-owned content`, async () => {
    await compose(host); selectionFailure = true; await mount(host); expect(context.status).toBe("error"); expect(document.body.textContent).toContain("Workspace could not be loaded."); expect(document.body.textContent).not.toContain(PRIVATE); expect(childReads).toEqual([]); expect(createCalls).toBe(0); expect(await records()).toHaveLength(0);
    selectionFailure = false; await act(async () => context.refreshWorkspaces()); expect(context.status).toBe("missing"); expect(context.error).toBeUndefined(); expect(childReads).toEqual([]);
  });
  it(`${host}: retains the entered name after a refused create and releases admission for an explicit retry`, async () => {
    await compose(host); await mount(host); await name("Retry workspace"); creationFailure = true;
    await act(async () => button("Create workspace").click()); await settled(() => document.querySelector('[role="alert"]')?.textContent === "Workspace could not be created.");
    expect(button("Create workspace").disabled).toBe(false); expect(document.querySelector<HTMLInputElement>('input[name="workspaceName"]')?.value).toBe("Retry workspace"); expect(await records()).toHaveLength(0); expect(childReads).toEqual([]); expect(document.body.textContent).not.toContain(PRIVATE);
    creationFailure = false; await act(async () => button("Create workspace").click()); await settled(() => context.status === "ready"); expect(createRequests).toBe(2); expect(await records()).toHaveLength(1); expect(context.activeWorkspace?.displayName).toBe("Retry workspace");
  });
  it.each([
    ["array", []], ["empty identity", { workspaceId: "" }],
    ["whitespace identity", { workspaceId: " " }], ["path identity", { workspaceId: "../other" }],
    ["numeric identity", { workspaceId: 7 }], ["invalid optional timestamp", { selectedAt: 7 }],
    ["null", null],
  ])(`${host}: rejects a malformed successful selection: %s`, async (_label, value) => {
    await compose(host); selectionValue = value; await mount(host);
    expect(context.status).toBe("error"); expect(context.activeWorkspaceId).toBeUndefined(); expect(childReads).toEqual([]);
    expect(document.body.textContent).toContain("Workspace could not be loaded."); expect(createRequests).toBe(0); expect(await records()).toHaveLength(0);
    selectionValue = undefined; await act(async () => context.refreshWorkspaces()); expect(context.status).toBe("missing"); expect(context.error).toBeUndefined();
  });
  it(`${host}: preserves unavailable readiness for a valid selection whose workspace is absent`, async () => {
    await compose(host); selectionValue = { workspaceId: "workspace.absent", selectedAt: "2026-10-26T00:00:00.000Z" }; await mount(host);
    expect(context.status).toBe("unavailable"); expect(context.activeWorkspaceId).toBe("workspace.absent"); expect(context.error).toBe("This workspace is unavailable. Select or create another workspace."); expect(childReads).toEqual([]); expect(await records()).toHaveLength(0);
  });
}
