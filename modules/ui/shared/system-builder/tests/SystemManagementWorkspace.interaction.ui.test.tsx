// @vitest-environment jsdom
import { act, startTransition, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SystemBuilderManagementItem,
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import { SystemManagementWorkspace } from "../SystemManagementWorkspace";
import type { SystemBuilderClient } from "../SystemBuilderWorkspace";
import { NotificationTestHarness, readNotificationMessages } from "../../notifications/tests/NotificationTestHarness";

const passivePhase = vi.hoisted(() => ({paused: false, setups: [] as Array<() => void>, cleanups: [] as Array<() => void>}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {...actual, useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    actual.useEffect(() => {
      let cleanup: void | (() => void), cancelled = false;
      const setup = () => {if (!cancelled) cleanup = effect();};
      if (passivePhase.paused) passivePhase.setups.push(setup); else setup();
      return () => {
        cancelled = true;
        if (typeof cleanup === "function") {
          if (passivePhase.paused) passivePhase.cleanups.push(cleanup); else cleanup();
        }
      };
    }, dependencies);
  }};
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => {
    passivePhase.paused = false;
    while (passivePhase.cleanups.length) passivePhase.cleanups.shift()!();
    while (passivePhase.setups.length) passivePhase.setups.shift()!();
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
});

describe("SystemManagementWorkspace", () => {

  it("reports a rejected initial read through notifications and can retry", async () => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    vi.mocked(client.listManagement).mockRejectedValueOnce(new Error("synthetic transport details"));
    await renderWorkspace(client, vi.fn());
    await vi.waitFor(() => expect(readNotificationMessages(container!)).toContain("Could not load systems. Select Refresh to try again."));
    expect(readNotificationMessages(container!).join(" ")).not.toContain("synthetic transport details");
    await act(async () => button(container!, "Refresh").click());
    await vi.waitFor(() => expect(container?.textContent).toContain("Customer portal"));
  });

  it("does not append an old workspace page into the new workspace", async () => {
    const item = managementItem();
    const other = {...item, systemId: "system-other" as never, name: "Other workspace portal"};
    const late = {...item, systemId: "system-late" as never, name: "Obsolete page portal"};
    const client = systemClient({item, revision: systemRevision()});
    const first = await managementPage([item]);
    const page = {...first, value: {...first.value, totalCount: 2, nextCursor: "page-2"}};
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["listManagement"]>>>();
    vi.mocked(client.listManagement).mockImplementation(query => query.workspaceId === "workspace-b"
      ? managementPage([other]) : query.cursor ? held.promise : Promise.resolve(page));
    await renderWorkspace(client, vi.fn());
    await act(async () => button(container!, "Load more systems").click());
    try {
      await renderScope("workspace-b", client);
      await vi.waitFor(() => expect(container?.textContent).toContain(other.name));
      await act(async () => held.resolve(await managementPage([late])));
      expect(container?.textContent).not.toContain(late.name);
      expect(container?.textContent).toContain(other.name);
    } finally {held.resolve(first); await held.promise;}
  });

  it("admits only one clone command before the busy render", async () => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["clone"]>>>();
    vi.mocked(client.clone).mockReturnValue(held.promise);
    const changed = vi.fn();
    await renderWorkspace(client, vi.fn(), changed);
    await act(async () => button(container!, "Duplicate").click());
    const dialog = await dialogContaining("Duplicate Customer portal");
    const form = dialog.querySelector<HTMLFormElement>("form")!;
    try {
      await act(async () => {
        form.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
        form.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
      });
      expect(client.clone).toHaveBeenCalledTimes(1);
      await act(async () => held.resolve({ok: true, value: systemRecord(systemRevision())}));
      expect(changed).toHaveBeenCalledTimes(1);
      expect(readNotificationMessages(container!)).toContain("Customer portal copy was created as an unpublished system.");
    } finally {held.resolve({ok: true, value: systemRecord(systemRevision())}); await held.promise;}
  });

  it.each(["preview-revision", "preview-catalog", "archive", "restore", "clone"] as const)("recovers from a rejected %s request without losing retry", async (action) => {
    const item = managementItem({archived: action === "restore"});
    const client = systemClient({item, revision: systemRevision()});
    const method = action === "preview-revision" ? "readRevision" : action === "preview-catalog" ? "listComposerAssets" : action;
    vi.mocked(client[method]).mockRejectedValueOnce(new Error("synthetic transport details"));
    const changed = vi.fn();
    await renderWorkspace(client, vi.fn(), changed);
    let control: HTMLButtonElement, expected: string;
    if (action.startsWith("preview")) {
      control = button(container!, "Preview"); expected = "Could not open the system preview. Select Preview to try again.";
    } else if (action === "archive") {
      await act(async () => button(container!, "Delete").click());
      control = button(await dialogContaining("Delete Customer portal?"), "Delete system");
      expected = "Could not archive the system. Try Delete system again.";
    } else if (action === "clone") {
      await act(async () => button(container!, "Duplicate").click());
      control = button(await dialogContaining("Duplicate Customer portal"), "Duplicate system");
      expected = "Could not duplicate the system. Try Duplicate system again.";
    } else {control = button(container!, "Restore"); expected = "Could not restore the system. Select Restore to try again.";}
    await act(async () => control.click());
    await vi.waitFor(() => expect(readNotificationMessages(container!)).toContain(expected));
    expect(control.disabled).toBe(false);
    expect(readNotificationMessages(container!).join(" ")).not.toContain("synthetic transport details");
    expect(changed).not.toHaveBeenCalled();
    await act(async () => control.click());
    expect(client[method]).toHaveBeenCalledTimes(2);
    if (action.startsWith("preview")) expect((await dialogContaining("Preview: Customer portal")).textContent).toContain("does not execute backend logic");
    else expect(changed).toHaveBeenCalledTimes(1);
  });

  it("retries a failed page with its exact cursor and deduplicates returned systems", async () => {
    const item = managementItem(), added = {...item, systemId: "system-added" as never, name: "Intake service"};
    const client = systemClient({item, revision: systemRevision()});
    const first = await managementPage([item]);
    vi.mocked(client.listManagement).mockResolvedValueOnce({...first, value: {...first.value, totalCount: 2, nextCursor: "page-2"}})
      .mockRejectedValueOnce(new Error("synthetic paging details"))
      .mockResolvedValueOnce(await managementPage([item, added, added]));
    await renderWorkspace(client, vi.fn());
    await act(async () => button(container!, "Load more systems").click());
    await vi.waitFor(() => expect(readNotificationMessages(container!)).toContain("Could not load more systems. Try Load more systems again."));
    expect(button(container!, "Load more systems").disabled).toBe(false);
    await act(async () => button(container!, "Load more systems").click());
    expect(client.listManagement).toHaveBeenNthCalledWith(3, {workspaceId: "workspace-a", searchText: undefined, view: "active", sort: "updated-desc", cursor: "page-2", limit: 25});
    expect(container?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container?.textContent).toContain(added.name);
    expect(readNotificationMessages(container!).join(" ")).not.toContain("synthetic paging details");
  });

  it.each(["client", "search", "sort", "view"] as const)("rejects a held page after %s replacement", async (reason) => {
    const item = managementItem(), other = {...managementItem({archived: reason === "view"}), systemId: "other-system" as never, name: "Current filtered portal"};
    const late = {...item, systemId: "late-system" as never, name: "Obsolete filtered portal"};
    const client = systemClient({item, revision: systemRevision()});
    const first = await managementPage([item]), held = deferred<Awaited<ReturnType<SystemBuilderClient["listManagement"]>>>();
    let replaced = false;
    vi.mocked(client.listManagement).mockImplementation(query => query.cursor ? held.promise : replaced ? managementPage([other]) : Promise.resolve({...first, value: {...first.value, nextCursor: "next"}}));
    await renderWorkspace(client, vi.fn());
    await act(async () => button(container!, "Load more systems").click());
    try {
      replaced = true;
      if (reason === "client") await renderScope("workspace-a", systemClient({item: other, revision: systemRevision()}));
      else if (reason === "search") await searchFor("Current");
      else await act(async () => {
        const select = container!.querySelectorAll<HTMLSelectElement>("select")[reason === "view" ? 0 : 1]!;
        select.value = reason === "view" ? "archived" : "name-asc"; select.dispatchEvent(new Event("change", {bubbles: true}));
      });
      await vi.waitFor(() => expect(container?.textContent).toContain(other.name));
      await act(async () => held.resolve(await managementPage([late])));
      expect(container?.textContent).not.toContain(late.name);
      expect(container?.textContent).toContain(other.name);
      if (reason !== "client") expect(client.listManagement).toHaveBeenLastCalledWith(expect.objectContaining(reason === "search" ? {searchText: "Current"} : reason === "sort" ? {sort: "name-asc"} : {view: "archived"}));
    } finally {held.resolve(first); await held.promise;}
  });

  it.each(["workspace", "client", "query"] as const)("does not open a former preview after %s replacement", async (reason) => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["readRevision"]>>>();
    vi.mocked(client.readRevision).mockReturnValue(held.promise);
    await renderWorkspace(client, vi.fn());
    await act(async () => button(container!, "Preview").click());
    try {
      if (reason === "query") await act(async () => button(container!, "Refresh").click());
      else await renderScope(reason === "workspace" ? "workspace-b" : "workspace-a", reason === "client" ? systemClient({item: managementItem(), revision: systemRevision()}) : client);
      await vi.waitFor(() => expect(button(container!, "Preview").disabled).toBe(false));
      await act(async () => held.resolve({ok: true, value: systemRevision()}));
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(readNotificationMessages(container!)).toEqual([]);
    } finally {held.resolve({ok: true, value: systemRevision()}); await held.promise;}
  });

  it.each(["archive", "restore", "clone"] as const)("keeps a late %s acknowledgement out of the replacement workspace", async (action) => {
    const client = systemClient({item: managementItem({archived: action === "restore"}), revision: systemRevision()});
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["clone"]>>>();
    vi.mocked(client[action]).mockReturnValue(held.promise);
    const changed = vi.fn();
    await renderWorkspace(client, vi.fn(), changed);
    if (action === "archive") {await act(async () => button(container!, "Delete").click()); await act(async () => button(document.body, "Delete system").click());}
    else if (action === "clone") {await act(async () => button(container!, "Duplicate").click()); await act(async () => button(document.body, "Duplicate system").click());}
    else await act(async () => button(container!, "Restore").click());
    try {
      const other = {...managementItem(), systemId: "current-system" as never, name: "Current workspace system"};
      await renderScope("workspace-b", systemClient({item: other, revision: systemRevision()}));
      await act(async () => held.resolve({ok: true, value: systemRecord(systemRevision())}));
      expect(changed).not.toHaveBeenCalled();
      expect(readNotificationMessages(container!)).toEqual([]);
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(container?.textContent).toContain(other.name);
      expect(client[action]).toHaveBeenCalledWith(expect.objectContaining({workspaceId: "workspace-a"}));
    } finally {held.resolve({ok: true, value: systemRecord(systemRevision())}); await held.promise;}
  });

  it("does not describe a saved clone as failed when the refresh callback throws", async () => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    await renderWorkspace(client, vi.fn(), () => {throw new Error("synthetic refresh details");});
    await act(async () => button(container!, "Duplicate").click());
    await act(async () => button(await dialogContaining("Duplicate Customer portal"), "Duplicate system").click());
    expect(client.clone).toHaveBeenCalledTimes(1);
    expect(readNotificationMessages(container!)).toContain("Customer portal copy was created as an unpublished system.");
    expect(readNotificationMessages(container!)).toContain("The system was updated. Select Refresh to reload the list.");
    expect(readNotificationMessages(container!).join(" ")).not.toContain("Could not duplicate");
    expect(readNotificationMessages(container!).join(" ")).not.toContain("synthetic refresh details");
  });

  it("does not let an obsolete page failure clear a newer paging request", async () => {
    const item = managementItem(), current = {...item, systemId: "current-system" as never, name: "Filtered system"};
    const added = {...item, systemId: "current-added" as never, name: "Filtered second system"};
    const client = systemClient({item, revision: systemRevision()});
    const old = deferred<Awaited<ReturnType<SystemBuilderClient["listManagement"]>>>();
    const fresh = deferred<Awaited<ReturnType<SystemBuilderClient["listManagement"]>>>();
    vi.mocked(client.listManagement).mockImplementation(async query => {
      if (query.cursor) return query.searchText ? fresh.promise : old.promise;
      const page = await managementPage([query.searchText ? current : item]);
      return {...page, value: {...page.value, totalCount: 2, nextCursor: query.searchText ? "filtered-next" : "old-next"}};
    });
    await renderWorkspace(client, vi.fn());
    await act(async () => button(container!, "Load more systems").click());
    try {
      await searchFor("Filtered");
      await act(async () => button(container!, "Load more systems").click());
      await act(async () => old.reject(new Error("obsolete paging details")));
      expect(button(container!, "Loading…").disabled).toBe(true);
      expect(readNotificationMessages(container!)).toEqual([]);
      await act(async () => fresh.resolve(await managementPage([added])));
      expect(container?.textContent).toContain(current.name);
      expect(container?.textContent).toContain(added.name);
      expect(container?.textContent).not.toContain("Customer portal");
    } finally {old.resolve(await managementPage([])); fresh.resolve(await managementPage([])); await Promise.allSettled([old.promise, fresh.promise]);}
  });

  it("retains an accepted restore across a search change in the same workspace", async () => {
    const item = managementItem({archived: true}), current = {...managementItem(), systemId: "current-system" as never, name: "Filtered system"};
    const client = systemClient({item, revision: systemRevision()});
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["restore"]>>>();
    vi.mocked(client.restore).mockReturnValue(held.promise);
    vi.mocked(client.listManagement).mockImplementation(query => managementPage([query.searchText ? current : item]));
    const changed = vi.fn();
    await renderWorkspace(client, vi.fn(), changed);
    await act(async () => button(container!, "Restore").click());
    try {
      await searchFor("Filtered");
      expect(container?.textContent).toContain(current.name);
      await act(async () => held.resolve({ok: true, value: systemRecord(systemRevision())}));
      expect(changed).toHaveBeenCalledTimes(1);
      expect(client.restore).toHaveBeenCalledWith({workspaceId: "workspace-a", systemId: "system-1", expectedRevision: 4});
      expect(readNotificationMessages(container!)).toContain("Customer portal was restored to active systems.");
      expect(container?.textContent).toContain(current.name);
    } finally {held.resolve({ok: true, value: systemRecord(systemRevision())}); await held.promise;}
  });

  it.each(["clone", "archive"] as const)("keeps the accepted %s confirmation locked before busy state renders", async (action) => {
    const item = managementItem(), other = {...item, systemId: "system-other" as never, name: "Other portal"};
    const client = systemClient({item, revision: systemRevision()});
    vi.mocked(client.listManagement).mockImplementation(() => managementPage([item, other]));
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["clone"]>>>();
    vi.mocked(client[action]).mockReturnValue(held.promise);
    await renderWorkspace(client, vi.fn());
    await act(async () => button(container!, action === "archive" ? "Delete" : "Duplicate").click());
    const title = action === "archive" ? "Delete Customer portal?" : "Duplicate Customer portal";
    const dialog = await dialogContaining(title), cancel = button(dialog, "Cancel");
    const confirm = button(dialog, action === "archive" ? "Delete system" : "Duplicate system");
    const otherOpen = [...container!.querySelectorAll<HTMLButtonElement>("button")].filter(b => b.textContent?.trim() === (action === "archive" ? "Delete" : "Duplicate"))[1]!;
    try {
      await act(async () => {confirm.click(); cancel.click(); otherOpen.click();});
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(title);
      expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain(action === "archive" ? "Delete Other portal?" : "Duplicate Other portal");
      expect(client[action]).toHaveBeenCalledTimes(1);
      expect(button(document.body, "Cancel").disabled).toBe(true);
    } finally {await act(async () => held.resolve({ok: true, value: systemRecord(systemRevision())}));}
  });

  it("retires an old mutation at commit before passive cleanup runs", async () => {
    const client = systemClient({item: managementItem({archived: true}), revision: systemRevision()});
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["restore"]>>>(), changed = vi.fn();
    vi.mocked(client.restore).mockReturnValue(held.promise);
    await renderWorkspace(client, vi.fn(), changed);
    await act(async () => button(container!, "Restore").click());
    try {
      passivePhase.paused = true;
      await renderScope("workspace-b", systemClient({item: managementItem(), revision: systemRevision()}));
      expect(passivePhase.cleanups.length).toBeGreaterThan(0);
      await act(async () => held.resolve({ok: true, value: systemRecord(systemRevision())}));
      expect(changed).not.toHaveBeenCalled();
      expect(readNotificationMessages(container!)).toEqual([]);
    } finally {held.resolve({ok: true, value: systemRecord(systemRevision())}); await held.promise;}
  });

  it("retires an old preview at query commit before passive effects run", async () => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["readRevision"]>>>();
    vi.mocked(client.readRevision).mockReturnValue(held.promise);
    await renderWorkspace(client, vi.fn());
    await act(async () => button(container!, "Preview").click());
    try {
      passivePhase.paused = true;
      await act(async () => {const select = container!.querySelectorAll<HTMLSelectElement>("select")[1]!; select.value = "name-asc"; select.dispatchEvent(new Event("change", {bubbles: true}));});
      expect(passivePhase.setups.length).toBeGreaterThan(0);
      await act(async () => held.resolve({ok: true, value: systemRevision()}));
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    } finally {held.resolve({ok: true, value: systemRevision()}); await held.promise;}
  });

  it("keeps a committed pending clone when a client replacement render is abandoned", async () => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    const replacement = systemClient({item: managementItem(), revision: systemRevision()});
    const held = deferred<Awaited<ReturnType<SystemBuilderClient["clone"]>>>(), suspension = deferred<void>(), changed = vi.fn(), attempted = vi.fn();
    vi.mocked(client.clone).mockReturnValue(held.promise);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    const tree = (selected: SystemBuilderClient, pause: boolean) => <NotificationTestHarness><Suspense fallback={<p>Replacing owner</p>}>
      <SystemManagementWorkspace workspaceId="workspace-a" client={selected} onOpenInCompose={() => {}} onActiveSystemsChanged={changed} />
      <SuspendReplacement pause={pause} gate={suspension.promise} attempted={attempted}/>
    </Suspense></NotificationTestHarness>;
    await act(async () => root?.render(tree(client, false)));
    await act(async () => button(container!, "Duplicate").click());
    await act(async () => button(document.body, "Duplicate system").click());
    try {
      await act(async () => {startTransition(() => root?.render(tree(replacement, true)));});
      expect(attempted).toHaveBeenCalled();
      await act(async () => root?.render(tree(client, false)));
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain("Duplicate Customer portal");
      expect(client.clone).toHaveBeenCalledTimes(1);
      expect(replacement.listManagement).not.toHaveBeenCalled();
      await act(async () => held.resolve({ok: true, value: systemRecord(systemRevision())}));
      expect(changed).toHaveBeenCalledTimes(1);
      expect(readNotificationMessages(container!)).toContain("Customer portal copy was created as an unpublished system.");
    } finally {await act(async () => {held.resolve({ok: true, value: systemRecord(systemRevision())}); suspension.resolve();});}
  });

  it("does not dispatch an initial read after retirement before the first promise turn", async () => {
    const {flushSync} = await import("react-dom");
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => {
      flushSync(() => root?.render(<NotificationTestHarness><SystemManagementWorkspace workspaceId="workspace-a" client={client} onOpenInCompose={() => {}}/></NotificationTestHarness>));
      root?.unmount(); root = undefined;
    });
    expect(client.listManagement).not.toHaveBeenCalled();
  });

  it("does not dispatch preview reads after retirement before the first promise turn", async () => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    await renderWorkspace(client, vi.fn());
    await act(async () => {button(container!, "Preview").click(); root?.unmount(); root = undefined;});
    expect(client.readRevision).not.toHaveBeenCalled();
    expect(client.listComposerAssets).not.toHaveBeenCalled();
  });

  it("contains synchronous and parallel preview failures and permits retry", async () => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    vi.mocked(client.readRevision).mockImplementationOnce(() => {throw new Error("synthetic immediate details");});
    vi.mocked(client.listComposerAssets).mockRejectedValueOnce(new Error("synthetic parallel details"));
    await renderWorkspace(client, vi.fn());
    await act(async () => button(container!, "Preview").click());
    expect(client.readRevision).toHaveBeenCalledTimes(1);
    expect(client.listComposerAssets).toHaveBeenCalledTimes(1);
    expect(readNotificationMessages(container!)).toContain("Could not open the system preview. Select Preview to try again.");
    expect(readNotificationMessages(container!).join(" ")).not.toContain("synthetic");
    await act(async () => button(container!, "Preview").click());
    expect((await dialogContaining("Preview: Customer portal")).textContent).toContain("does not execute backend logic");
  });

  it("preserves an actionable typed revision denial and keeps archive retry available", async () => {
    const client = systemClient({item: managementItem(), revision: systemRevision()});
    vi.mocked(client.archive).mockResolvedValueOnce({ok: false, error: {code: "revision-conflict", message: "This system changed. Refresh its saved revision before trying again."}} as never);
    const changed = vi.fn();
    await renderWorkspace(client, vi.fn(), changed);
    await act(async () => button(container!, "Delete").click());
    const dialog = await dialogContaining("Delete Customer portal?");
    await act(async () => button(dialog, "Delete system").click());
    expect(changed).not.toHaveBeenCalled();
    expect(readNotificationMessages(container!)).toContain("This system changed. Refresh its saved revision before trying again.");
    expect(button(dialog, "Delete system").disabled).toBe(false);
    expect(client.archive).toHaveBeenCalledWith({workspaceId: "workspace-a", systemId: "system-1", expectedRevision: 4});
  });

  it("lists systems, previews the exact revision, and hands a system to Compose", async () => {
    const item = managementItem();
    const revision = systemRevision();
    const onOpenInCompose = vi.fn();
    const client = systemClient({ item, revision });

    await renderWorkspace(client, onOpenInCompose);

    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Customer portal"),
    );
    expect(container?.textContent).toContain("Published");
    expect(container?.textContent).toContain("2 assets · 1 releases");

    await act(async () => button(container!, "Preview").click());
    const previewDialog = await vi.waitFor(() => {
      const dialog =
        document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("Preview: Customer portal");
      return dialog!;
    });
    expect(client.readRevision).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      systemId: "system-1",
      revisionId: "revision-2",
    });
    expect(previewDialog.textContent).toContain(
      "does not execute backend logic",
    );

    await act(async () =>
      previewDialog
        .querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')
        ?.click(),
    );
    await act(async () => button(container!, "Open in Compose").click());
    expect(onOpenInCompose).toHaveBeenCalledWith("system-1");
  });

  it("duplicates and archive-deletes without discarding immutable history", async () => {
    const item = managementItem();
    const client = systemClient({ item, revision: systemRevision() });
    const onActiveSystemsChanged = vi.fn();

    await renderWorkspace(client, vi.fn(), onActiveSystemsChanged);
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Customer portal"),
    );

    await act(async () => button(container!, "Duplicate").click());
    const cloneDialog = await dialogContaining("Duplicate Customer portal");
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => button(cloneDialog, "Duplicate system").click());
    await vi.waitFor(() =>
      expect(client.clone).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        sourceSystemId: "system-1",
        name: "Customer portal copy",
      }),
    );
    expect(onActiveSystemsChanged).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(readNotificationMessages(container!)).toContain("Customer portal copy was created as an unpublished system."));
    expect(container?.textContent).not.toContain("Customer portal copy was created");
    await act(async () => button(container!, "Delete").click());
    const deleteDialog = await dialogContaining("Delete Customer portal?");
    expect(deleteDialog.textContent).toContain(
      "Immutable revisions and releases are retained",
    );
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => button(deleteDialog, "Delete system").click());

    await vi.waitFor(() =>
      expect(client.archive).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        systemId: "system-1",
        expectedRevision: 4,
      }),
    );
    expect(onActiveSystemsChanged).toHaveBeenCalledTimes(2);
    expect(readNotificationMessages(container!).some((message) => message.includes("can be restored from the Archived view"))).toBe(true);
    expect(container?.textContent).not.toContain("can be restored from the Archived view");
  });

  it("restores an archived system from the same management list", async () => {
    const item = managementItem({ archived: true });
    const client = systemClient({ item, revision: systemRevision() });
    const onActiveSystemsChanged = vi.fn();

    await renderWorkspace(client, vi.fn(), onActiveSystemsChanged);
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Archived"),
    );
    await act(async () => button(container!, "Restore").click());

    await vi.waitFor(() =>
      expect(client.restore).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        systemId: "system-1",
        expectedRevision: 4,
      }),
    );
    expect(onActiveSystemsChanged).toHaveBeenCalledOnce();
    expect(readNotificationMessages(container!)).toContain("Customer portal was restored to active systems.");
    expect(container?.textContent).not.toContain("Customer portal was restored to active systems");
  });
});

async function renderWorkspace(
  client: SystemBuilderClient,
  onOpenInCompose: (systemId: string) => void,
  onActiveSystemsChanged?: () => void,
) {
  await renderScope("workspace-a", client, onOpenInCompose, onActiveSystemsChanged);
}

async function renderScope(workspaceId: string, client: SystemBuilderClient,
  onOpenInCompose: (systemId: string) => void = () => {}, onActiveSystemsChanged?: () => void) {
  if (!container) {container = document.createElement("div"); document.body.append(container); root = createRoot(container);}
  await act(async () => root?.render(<NotificationTestHarness><SystemManagementWorkspace
    workspaceId={workspaceId} client={client} onOpenInCompose={onOpenInCompose}
    onActiveSystemsChanged={onActiveSystemsChanged} /></NotificationTestHarness>));
}

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const match = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function dialogContaining(text: string): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const match = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).find((candidate) => candidate.textContent?.includes(text));
    expect(match).toBeDefined();
    return match!;
  });
}

function managementItem(
  overrides: { readonly archived?: boolean } = {},
): SystemBuilderManagementItem {
  const archived = overrides.archived ?? false;
  return {
    systemId: "system-1",
    name: "Customer portal",
    description: "Customer self-service system",
    designStatus: archived ? "archived" : "validated",
    archived,
    publicationStatus: "published",
    recordRevision: 4,
    currentRevisionId: "revision-2",
    assetCount: 2,
    releaseCount: 1,
    latestRelease: {
      releaseId: "release-1",
      systemRevisionId: "revision-2",
      approvedAt: "2026-07-17T12:00:00.000Z",
    },
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    actions: {
      canPreview: true,
      canOpenInCompose: !archived,
      canDelete: !archived,
      canRestore: archived,
      deleteStrategy: "archive",
    },
  } as unknown as SystemBuilderManagementItem;
}

function systemRevision(): SystemBuilderRevision {
  return {
    revisionId: "revision-2",
    systemId: "system-1",
    targetWorkspaceId: "workspace-a",
    revisionNumber: 2,
    composition: {
      compositionId: "system-1.composition",
      compositionType: "system",
      displayName: "Customer portal",
      version: "0.2.0",
      lifecycleStatus: "validated",
      rootInstanceRefs: [],
      instanceRefs: [],
      bindingRefs: [],
      provenance: { sourceKind: "human-authored" },
    },
    instances: [],
    bindings: [],
    placements: [],
    validationIssues: [],
    createdAt: "2026-07-18T12:00:00.000Z",
    createdBy: "person-1",
  } as unknown as SystemBuilderRevision;
}

function managementPage(items: readonly SystemBuilderManagementItem[]) {
  return Promise.resolve({
    ok: true as const,
    value: {
      items,
      totalCount: items.length,
      query: {
        view: "active" as const,
        sort: "updated-desc" as const,
        limit: 25,
      },
    },
  });
}

function systemClient({
  item,
  revision,
}: {
  readonly item: SystemBuilderManagementItem;
  readonly revision: SystemBuilderRevision;
}): SystemBuilderClient {
  const record = systemRecord(revision);
  return {
    listManagement: vi.fn(() => managementPage([item])),
    readRevision: vi.fn().mockResolvedValue({ ok: true, value: revision }),
    listComposerAssets: vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [], totalCount: 0 },
    }),
    archive: vi.fn().mockResolvedValue({ ok: true, value: record }),
    restore: vi.fn().mockResolvedValue({ ok: true, value: record }),
    clone: vi.fn().mockResolvedValue({ ok: true, value: record }),
    list: vi.fn(),
    listTemplates: vi.fn(),
    createFromTemplate: vi.fn(),
    create: vi.fn(),
    saveRevision: vi.fn(),
    listRevisions: vi.fn(),
  } as unknown as SystemBuilderClient;
}

function systemRecord(revision: SystemBuilderRevision): SystemBuilderRecord {
  return {
    systemId: "system-copy",
    targetWorkspaceId: "workspace-a",
    name: "Customer portal copy",
    status: "draft",
    revision: 1,
    currentRevisionId: "revision-copy-1",
    composition: revision.composition,
    createdAt: "2026-07-18T13:00:00.000Z",
    updatedAt: "2026-07-18T13:00:00.000Z",
    createdBy: "person-1",
    updatedBy: "person-1",
  } as unknown as SystemBuilderRecord;
}

async function searchFor(value: string) {
  const input = container!.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", {bubbles: true}));});
  await act(async () => {input.closest("form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));});
}

function SuspendReplacement({pause, gate, attempted}: {pause: boolean; gate: Promise<void>; attempted: () => void}) {
  if (pause) {attempted(); throw gate;}
  return null;
}
