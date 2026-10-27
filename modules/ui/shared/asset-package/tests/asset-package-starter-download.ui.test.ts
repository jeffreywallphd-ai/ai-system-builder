// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSET_PACKAGE_MEDIA_TYPE,
  ASSET_PACKAGE_STARTER_FILENAME,
} from "../../../../contracts/asset-package";
import { downloadAssetPackageStarter } from "../AssetPackageManager";

describe("asset package starter download", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the canonical starter and releases its object URL", () => {
    let clickedAnchor: HTMLAnchorElement | undefined;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function capture(this: HTMLAnchorElement) {
        clickedAnchor = this;
      });
    const createObjectURL = vi.fn(() => "blob:asset-package-starter");
    const revokeObjectURL = vi.fn();
    const scheduleCleanup = vi.fn((cleanup: () => void) => cleanup());

    downloadAssetPackageStarter({
      document,
      url: { createObjectURL, revokeObjectURL },
      scheduleCleanup,
    });

    expect(click).toHaveBeenCalledOnce();
    expect(clickedAnchor?.download).toBe(ASSET_PACKAGE_STARTER_FILENAME);
    expect(clickedAnchor?.href).toBe("blob:asset-package-starter");
    expect(clickedAnchor?.isConnected).toBe(false);
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe(ASSET_PACKAGE_MEDIA_TYPE);
    expect(blob?.size).toBeGreaterThan(0);
    expect(scheduleCleanup).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset-package-starter");
  });
});


import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssetPackageManager, type AssetPackageClient } from "../AssetPackageManager";
import { serializeAssetPackageStarter, type AssetPackageInspectionSummary, type AssetPackageRecord } from "../../../../contracts/asset-package";
import { NotificationTestHarness, readNotificationMessages } from "../../notifications/tests/NotificationTestHarness";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const packageRoots: Root[] = [];
afterEach(async () => {
  for (const root of packageRoots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});
function packageDeferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const inertPackageBytes = new TextEncoder().encode(serializeAssetPackageStarter());
function packageRecord(workspaceId = "workspace-a", recordId = "package.current", status: AssetPackageRecord["status"] = "installed"): AssetPackageRecord {
  return { recordId, workspaceId: workspaceId as never, packageId: "tests.account-widgets", version: "1.0.0", displayName: "Account widgets", packageDigest: `sha256:${"a".repeat(64)}` as AssetPackageRecord["packageDigest"],
    artifact: { artifactId: "inert-package-artifact", digest: `sha256:${"a".repeat(64)}` as AssetPackageRecord["packageDigest"], mediaType: ASSET_PACKAGE_MEDIA_TYPE, sizeBytes: inertPackageBytes.length },
    status, definitionCount: 2, implementationCount: 1, requestedCapabilities: [], revision: 1, createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z" };
}
function packageInspection(workspaceId = "workspace-a", capabilities: readonly string[] = []): AssetPackageInspectionSummary {
  return { inspectionId: "inspection.current", workspaceId: workspaceId as never, packageDigest: `sha256:${"a".repeat(64)}` as AssetPackageRecord["packageDigest"], packageId: "tests.account-widgets", version: "1.0.0", displayName: "Account widgets",
    definitionCount: 2, implementationCount: 1, entryCount: 4, expandedSizeBytes: inertPackageBytes.length, requestedCapabilities: capabilities, supportedDeploymentProfiles: [],
    signatureStatus: "unverified", provenanceStatus: "verified", sbomStatus: "verified", conflicts: [], issues: [], eligibleForAdmission: true, inspectedAt: "2026-10-27T00:00:00Z" };
}
function packageClient(overrides: Partial<AssetPackageClient> = {}): AssetPackageClient {
  const pending = new Promise<never>(() => {});
  return { list: async () => ({ ok: true, value: [] }), inspect: () => pending, admit: () => pending, activate: () => pending, disable: () => pending, rollback: () => pending, ...overrides };
}
function packageButton(panel: HTMLElement, name: string) {
  const button = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === name);
  if (!button) throw new Error(`Missing package control: ${name}`);
  return button;
}
async function mountPackage(client: AssetPackageClient, workspaceId = "workspace-a") {
  const panel = document.createElement("div"); document.body.append(panel); const root = createRoot(panel); packageRoots.push(root);
  const render = async (scope = workspaceId, source = client) => act(async () => root.render(createElement(NotificationTestHarness, { children: createElement(AssetPackageManager, { workspaceId: scope, client: source }) })));
  await render(); return { panel, root, render };
}
async function choosePackage(panel: HTMLElement, bytes: Promise<ArrayBuffer> = Promise.resolve(inertPackageBytes.slice().buffer)) {
  const file = new File([inertPackageBytes], ASSET_PACKAGE_STARTER_FILENAME, { type: ASSET_PACKAGE_MEDIA_TYPE });
  Object.defineProperty(file, "arrayBuffer", { value: () => bytes });
  const input = panel.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

describe("Package UI session and retry regressions", () => {
  it("admits one activation before busy rendering", async () => {
    const pending = packageDeferred(); let calls = 0;
    const client = packageClient({ list: async () => ({ ok: true, value: [packageRecord()] }), activate: () => { calls++; return pending.promise; } });
    const { panel } = await mountPackage(client);
    try { await act(async () => { const button = packageButton(panel, "Activate"); button.click(); button.click(); }); expect(calls).toBe(1); }
    finally { await act(async () => pending.resolve({ ok: true, value: packageRecord("workspace-a", "package.current", "active") })); }
  });

  it("keeps a former workspace install reply out of the current list", async () => {
    const pending = packageDeferred(); const client = packageClient({ inspect: async () => ({ ok: true, value: packageInspection() }), admit: () => pending.promise });
    const { panel, render } = await mountPackage(client); await choosePackage(panel);
    await act(async () => packageButton(panel, "Install package").click()); await render("workspace-b");
    await act(async () => pending.resolve({ ok: true, value: packageRecord() }));
    expect(panel.querySelector(".asset-package-manager__records")).toBeNull(); expect(panel.textContent).not.toContain("Account widgets");
    expect(readNotificationMessages(panel)).toEqual([]);
  });

  it("offers an explicit retry after the installed list is refused", async () => {
    let calls = 0; const client = packageClient({ list: async () => ++calls === 1 ? { ok: false, error: { code: "temporarily-unavailable", message: "Installed packages are unavailable." } } : { ok: true, value: [] } });
    const { panel } = await mountPackage(client);
    await act(async () => packageButton(panel, "Retry loading installed packages").click());
    expect(calls).toBe(2); expect(panel.textContent).toContain("No packages installed");
    expect(readNotificationMessages(panel)).toEqual(["Installed packages are unavailable."]);
  });

  it("does not dispatch inspection after a held file read loses its workspace", async () => {
    const bytes = packageDeferred<ArrayBuffer>(); let calls = 0;
    const client = packageClient({ inspect: async () => { calls++; return { ok: true, value: packageInspection() }; } });
    const { panel, render } = await mountPackage(client); await choosePackage(panel, bytes.promise); await render("workspace-b");
    await act(async () => bytes.resolve(inertPackageBytes.slice().buffer));
    expect(calls).toBe(0); expect(panel.textContent).not.toContain("Account widgets");
  });

  it("does not let an older initial list erase an accepted installation", async () => {
    const list = packageDeferred(); const client = packageClient({ list: () => list.promise, inspect: async () => ({ ok: true, value: packageInspection() }), admit: async () => ({ ok: true, value: packageRecord() }) });
    const { panel } = await mountPackage(client); await choosePackage(panel); await act(async () => packageButton(panel, "Install package").click());
    await act(async () => list.resolve({ ok: true, value: [] }));
    expect(panel.querySelector(".asset-package-manager__records")?.textContent).toContain("Account widgets");
  });

  it("refuses a foreign workspace installation acknowledgement", async () => {
    const client = packageClient({ inspect: async () => ({ ok: true, value: packageInspection() }), admit: async () => ({ ok: true, value: packageRecord("workspace-b") }) });
    const { panel } = await mountPackage(client); await choosePackage(panel); await act(async () => packageButton(panel, "Install package").click());
    expect(panel.querySelector(".asset-package-manager__records")).toBeNull();
    expect(packageButton(panel, "Install package").disabled).toBe(false);
  });
});


function packageRow(panel: HTMLElement, name: string) {
  const row = [...panel.querySelectorAll<HTMLLIElement>(".asset-package-manager__records > li")].find(value => value.querySelector("strong")?.textContent === name);
  if (!row) throw new Error(`Missing package row: ${name}`);
  return row;
}
describe("Package explicit lifecycle and capability consent", () => {
  it("inspects exact inert bytes, approves every capability, installs, activates, disables and rolls back to the actual prior record", async () => {
    const previous = { ...packageRecord("workspace-a", "package.previous", "active"), displayName: "Account widgets v1" };
    let current: AssetPackageRecord = { ...packageRecord("workspace-a", "package.current"), version: "2.0.0", displayName: "Account widgets v2", artifact: { ...packageRecord().artifact, digest: `sha256:${"b".repeat(64)}` }, packageDigest: `sha256:${"b".repeat(64)}` as AssetPackageRecord["packageDigest"] };
    let records: AssetPackageRecord[] = [previous]; const calls: { operation: string; input: any }[] = [];
    const capabilities = ["artifact.read", "artifact.write"];
    const client = packageClient({
      list: async () => ({ ok: true, value: structuredClone(records) }),
      inspect: async input => { calls.push({ operation: "inspect", input: { workspaceId: input.workspaceId, bytes: [...input.bytes] } }); return { ok: true, value: { ...packageInspection("workspace-a", capabilities), version: current.version, packageDigest: current.packageDigest, displayName: current.displayName } }; },
      admit: async input => { calls.push({ operation: "admit", input: structuredClone(input) }); records = [...records, current]; return { ok: true, value: structuredClone(current) }; },
      activate: async input => { calls.push({ operation: "activate", input: structuredClone(input) }); records = records.map(record => record.recordId === previous.recordId ? { ...record, status: "disabled", revision: 2 } : { ...record, status: "active", previousActiveRecordId: previous.recordId, revision: 2 }); current = records.find(record => record.recordId === current.recordId)!; return { ok: true, value: structuredClone(current) }; },
      disable: async input => { calls.push({ operation: "disable", input: structuredClone(input) }); records = records.map(record => record.recordId === current.recordId ? { ...record, status: "disabled", revision: 3 } : record); current = records.find(record => record.recordId === current.recordId)!; return { ok: true, value: structuredClone(current) }; },
      rollback: async input => { calls.push({ operation: "rollback", input: structuredClone(input) }); records = records.map(record => record.recordId === previous.recordId ? { ...record, status: "active", revision: 3 } : record); return { ok: true, value: structuredClone(records.find(record => record.recordId === previous.recordId)!) }; },
    });
    const { panel } = await mountPackage(client); await choosePackage(panel);
    expect(calls).toEqual([{ operation: "inspect", input: { workspaceId: "workspace-a", bytes: [...inertPackageBytes] } }]);
    expect(packageButton(panel, "Install package").disabled).toBe(true);
    const checkboxes = [...panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]; expect(checkboxes).toHaveLength(2);
    await act(async () => checkboxes[0].click()); expect(packageButton(panel, "Install package").disabled).toBe(true);
    await act(async () => checkboxes[1].click()); expect(packageButton(panel, "Install package").disabled).toBe(false);
    await act(async () => { const install = packageButton(panel, "Install package"); install.click(); install.click(); });
    expect(calls.filter(value => value.operation === "admit")).toEqual([{ operation: "admit", input: { workspaceId: "workspace-a", inspectionId: "inspection.current", packageDigest: current.packageDigest, approvalScope: "workspace", approvedCapabilities: capabilities } }]);
    expect(calls.some(value => value.operation === "activate")).toBe(false); expect(packageRow(panel, current.displayName).textContent).toContain("INSTALLED");
    await act(async () => packageButton(packageRow(panel, current.displayName), "Activate").click());
    expect(packageRow(panel, current.displayName).textContent).toContain("ACTIVE"); expect(packageRow(panel, previous.displayName).textContent).toContain("DISABLED");
    await act(async () => packageButton(packageRow(panel, current.displayName), "Disable").click());
    expect(packageRow(panel, current.displayName).textContent).toContain("DISABLED");
    await act(async () => packageButton(packageRow(panel, current.displayName), "Rollback").click());
    expect(packageRow(panel, previous.displayName).textContent).toContain("ACTIVE"); expect(packageRow(panel, current.displayName).textContent).toContain("DISABLED");
    expect(calls.filter(value => ["activate", "disable", "rollback"].includes(value.operation))).toEqual(["activate", "disable", "rollback"].map(operation => ({ operation, input: { workspaceId: "workspace-a", recordId: "package.current" } })));
    expect(records.find(record => record.recordId === previous.recordId)?.packageDigest).toBe(previous.packageDigest);
    expect(readNotificationMessages(panel).join(" ")).not.toContain("synthetic-private");
  });

  for (const status of ["quarantined", "inspected", "rejected"] as const) it(`does not offer an enabled activation for ${status} content`, async () => {
    let calls = 0; const client = packageClient({ list: async () => ({ ok: true, value: [packageRecord("workspace-a", "package.current", status)] }), activate: async () => { calls++; return { ok: true, value: packageRecord("workspace-a", "package.current", "active") }; } });
    const { panel } = await mountPackage(client); expect(packageButton(panel, "Activate").disabled).toBe(true);
    await act(async () => packageButton(panel, "Activate").click()); expect(calls).toBe(0);
  });

  it("keeps an ineligible inspection uninstalled even after all capability checkboxes are selected", async () => {
    let calls = 0; const client = packageClient({ inspect: async () => ({ ok: true, value: { ...packageInspection("workspace-a", ["artifact.read"]), eligibleForAdmission: false } }), admit: async () => { calls++; return { ok: true, value: packageRecord() }; } });
    const { panel } = await mountPackage(client); await choosePackage(panel); await act(async () => panel.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(packageButton(panel, "Install package").disabled).toBe(true); await act(async () => packageButton(panel, "Install package").click()); expect(calls).toBe(0);
  });
});


const packageOperations = ["inspect", "admit", "activate", "disable", "rollback"] as const;
function packageOperationRecords(operation: typeof packageOperations[number]) {
  const target: AssetPackageRecord = { ...packageRecord("workspace-a", "package.current", operation === "disable" ? "active" : "installed"), displayName: "Current package", previousActiveRecordId: operation === "rollback" ? "package.previous" : undefined };
  const previous: AssetPackageRecord = { ...packageRecord("workspace-a", "package.previous", "disabled"), displayName: "Previous package", version: "0.9.0", packageDigest: `sha256:${"c".repeat(64)}` as AssetPackageRecord["packageDigest"] };
  return { target, previous };
}
async function startPackageOperation(panel: HTMLElement, operation: typeof packageOperations[number], targetName = "Current package") {
  if (operation === "inspect") return choosePackage(panel);
  if (operation === "admit") { await choosePackage(panel); return act(async () => packageButton(panel, "Install package").click()); }
  await act(async () => packageButton(packageRow(panel, targetName), operation[0].toUpperCase() + operation.slice(1)).click());
}
describe("Package action and list failure recovery", () => {
  for (const operation of packageOperations) for (const failure of ["throw", "reject"] as const) it(`releases ${operation} after ${failure} and permits an explicit corrective retry`, async () => {
    const { target, previous } = packageOperationRecords(operation); let calls = 0; let records: AssetPackageRecord[] = [target, previous];
    const resultValue = operation === "inspect" ? packageInspection() : operation === "rollback" ? { ...previous, status: "active" as const } : { ...target, status: operation === "disable" ? "disabled" as const : operation === "activate" ? "active" as const : "installed" as const };
    const client = packageClient({ list: async () => ({ ok: true, value: operation === "admit" || operation === "inspect" ? [] : records }), inspect: async () => ({ ok: true, value: packageInspection() }),
      [operation]: () => {
        calls++; if (calls === 1) { const error = new Error("synthetic-private-package-adapter-detail"); if (failure === "throw") throw error; return Promise.reject(error); }
        if (operation !== "inspect") records = records.map(record => record.recordId === (resultValue as AssetPackageRecord).recordId ? resultValue as AssetPackageRecord : record);
        return Promise.resolve({ ok: true, value: resultValue });
      },
    });
    const { panel } = await mountPackage(client); await startPackageOperation(panel, operation);
    expect(calls).toBe(1); expect(panel.querySelector(".asset-package-manager")!.getAttribute("aria-busy")).toBe("false");
    expect(panel.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(false);
    expect(readNotificationMessages(panel).join(" ")).not.toContain("synthetic-private-package-adapter-detail"); expect(readNotificationMessages(panel).length).toBeGreaterThan(0);
    if (operation !== "inspect") await act(async () => packageButton(panel, "Refresh installed packages").click());
    if (operation === "admit") await act(async () => packageButton(panel, "Install package").click()); else await startPackageOperation(panel, operation);
    expect(calls).toBe(2); expect(panel.querySelector(".asset-package-manager")!.getAttribute("aria-busy")).toBe("false");
  });

  for (const failure of ["throw", "reject"] as const) it(`releases an initial ${failure} list and admits one explicit retry`, async () => {
    const pending = packageDeferred(); let calls = 0;
    const client = packageClient({ list: () => {
      calls++; if (calls === 1) { const error = new Error("synthetic-private-package-list-detail"); if (failure === "throw") throw error; return Promise.reject(error); }
      return pending.promise;
    } });
    const { panel } = await mountPackage(client); expect(panel.textContent).not.toContain("Loading installed packages"); expect(readNotificationMessages(panel).join(" ")).not.toContain("synthetic-private-package-list-detail");
    await act(async () => { const retry = packageButton(panel, "Retry loading installed packages"); retry.click(); retry.click(); });
    expect(calls).toBe(2); await act(async () => pending.resolve({ ok: true, value: [] }));
    expect(panel.textContent).toContain("No packages installed"); expect(panel.querySelector(".asset-package-manager")!.getAttribute("aria-busy")).toBe("false");
  });

  it("retains the accepted action result when refresh fails, then retries only the list", async () => {
    let lists = 0, activations = 0; const installed = packageRecord(), active = { ...installed, status: "active" as const, revision: 2 };
    const client = packageClient({ list: async () => { lists++; if (lists === 2) throw new Error("synthetic-private-post-action-list"); return { ok: true, value: [lists === 1 ? installed : active] }; },
      activate: async () => { activations++; return { ok: true, value: active }; } });
    const { panel } = await mountPackage(client); await act(async () => packageButton(panel, "Activate").click());
    expect(packageRow(panel, installed.displayName).textContent).toContain("ACTIVE"); expect(readNotificationMessages(panel).join(" ")).toContain("was updated");
    expect(readNotificationMessages(panel).join(" ")).not.toContain("synthetic-private-post-action-list");
    await act(async () => packageButton(panel, "Retry loading installed packages").click()); expect(lists).toBe(3); expect(activations).toBe(1);
    expect(packageRow(panel, installed.displayName).textContent).toContain("ACTIVE");
  });
});


describe("Package rendered-summary and list consistency", () => {
  for (const field of ["supportedDeploymentProfiles", "issues", "conflicts", "packageId", "version"] as const) it(`denies an eligible summary missing ${field} before publishing it to the renderer`, async () => {
    const malformed = packageInspection(); delete (malformed as unknown as Record<string, unknown>)[field];
    const client = packageClient({ inspect: async () => ({ ok: true, value: malformed }) });
    const { panel } = await mountPackage(client); await choosePackage(panel);
    expect(packageButton(panel, "Install package").disabled).toBe(true);
    expect(panel.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(false);
    expect(readNotificationMessages(panel).join(" ")).toContain("could not be read or inspected");
  });

  it("still displays an ineligible inspection without optional package identity", async () => {
    const summary = { ...packageInspection(), eligibleForAdmission: false, packageId: undefined, version: undefined, issues: [{ severity: "error" as const, code: "invalid-manifest", message: "The manifest needs a valid package identity." }] };
    const { panel } = await mountPackage(packageClient({ inspect: async () => ({ ok: true, value: summary }) })); await choosePackage(panel);
    expect(panel.textContent).toContain("The manifest needs a valid package identity."); expect(packageButton(panel, "Install package").disabled).toBe(true);
  });

  it("refreshes an initially pending list after installation and retains another existing package", async () => {
    const pending = packageDeferred(); let lists = 0;
    const existing = { ...packageRecord("workspace-a", "package.other"), packageId: "tests.other", displayName: "Existing separate package" }, installed = packageRecord();
    const client = packageClient({ list: async () => ++lists === 1 ? pending.promise : { ok: true, value: [existing, installed] }, inspect: async () => ({ ok: true, value: packageInspection() }), admit: async () => ({ ok: true, value: installed }) });
    const { panel } = await mountPackage(client); await choosePackage(panel); await act(async () => packageButton(panel, "Install package").click());
    expect(lists).toBe(2); expect(packageRow(panel, existing.displayName)).toBeTruthy(); expect(packageRow(panel, installed.displayName)).toBeTruthy();
    await act(async () => pending.resolve({ ok: true, value: [existing] }));
    expect(packageRow(panel, existing.displayName)).toBeTruthy(); expect(packageRow(panel, installed.displayName)).toBeTruthy();
  });

  it("does not claim the unknown initial catalogue is empty after installation refusal", async () => {
    const pending = packageDeferred(); let lists = 0; const existing = { ...packageRecord(), displayName: "Already installed package" };
    const client = packageClient({ list: async () => ++lists === 1 ? pending.promise : { ok: true, value: [existing] }, inspect: async () => ({ ok: true, value: packageInspection() }), admit: async () => ({ ok: false, error: { code: "admission-refused", message: "Package installation was refused." } }) });
    const { panel } = await mountPackage(client); await choosePackage(panel); await act(async () => packageButton(panel, "Install package").click());
    expect(panel.textContent).not.toContain("No packages installed");
    await act(async () => packageButton(panel, "Retry loading installed packages").click());
    expect(packageRow(panel, existing.displayName)).toBeTruthy();
    await act(async () => pending.resolve({ ok: true, value: [] })); expect(packageRow(panel, existing.displayName)).toBeTruthy();
  });

  for (const variant of ["missing", "earlier-revision", "same-revision-wrong-status", "different-digest", "different-version"] as const) it(`preserves the accepted activation when refresh returns ${variant} target`, async () => {
    const installed = packageRecord(), active = { ...installed, status: "active" as const, revision: 2 }; let lists = 0;
    const stale = variant === "missing" ? [] : [{ ...active,
      ...(variant === "earlier-revision" ? { status: "installed" as const, revision: 1 } : {}),
      ...(variant === "same-revision-wrong-status" ? { status: "installed" as const } : {}),
      ...(variant === "different-digest" ? { packageDigest: `sha256:${"c".repeat(64)}` as AssetPackageRecord["packageDigest"] } : {}),
      ...(variant === "different-version" ? { version: "9.0.0" } : {}),
    }];
    const client = packageClient({ list: async () => ({ ok: true, value: ++lists === 1 ? [installed] : lists === 2 ? stale : [active] }), activate: async () => ({ ok: true, value: active }) });
    const { panel } = await mountPackage(client); await act(async () => packageButton(panel, "Activate").click());
    expect(packageRow(panel, installed.displayName).textContent).toContain("ACTIVE");
    expect(readNotificationMessages(panel).join(" ")).toContain("could not be refreshed");
    await act(async () => packageButton(panel, "Retry loading installed packages").click());
    expect(packageRow(panel, installed.displayName).textContent).toContain("ACTIVE"); expect(lists).toBe(3);
  });

  it("accepts a genuinely newer server revision instead of forcing an old activation snapshot", async () => {
    const installed = packageRecord(), active = { ...installed, status: "active" as const, revision: 2 }, later = { ...installed, status: "disabled" as const, revision: 3 }; let lists = 0;
    const client = packageClient({ list: async () => ({ ok: true, value: ++lists === 1 ? [installed] : [later] }), activate: async () => ({ ok: true, value: active }) });
    const { panel } = await mountPackage(client); await act(async () => packageButton(panel, "Activate").click());
    expect(packageRow(panel, installed.displayName).textContent).toContain("DISABLED");
    expect(readNotificationMessages(panel).join(" ")).not.toContain("could not be refreshed");
  });
});


describe("Package delayed action ownership", () => {
  for (const operation of packageOperations) for (const replacement of ["workspace", "client", "unmount"] as const) for (const outcome of ["accepted", "rejected"] as const) {
    it(`ignores ${outcome} ${operation} after ${replacement} replacement`, async () => {
      const pending = packageDeferred(); const { target, previous } = packageOperationRecords(operation);
      const records = operation === "admit" || operation === "inspect" ? [] : [target, previous];
      const client = packageClient({ list: async workspaceId => ({ ok: true, value: workspaceId === "workspace-a" ? records : [] }), inspect: async () => ({ ok: true, value: packageInspection() }), [operation]: () => pending.promise });
      const mounted = await mountPackage(client); await startPackageOperation(mounted.panel, operation);
      if (replacement === "unmount") { await act(async () => mounted.root.unmount()); packageRoots.splice(packageRoots.indexOf(mounted.root), 1); }
      else await mounted.render(replacement === "workspace" ? "workspace-b" : "workspace-a", replacement === "client" ? packageClient() : client);
      const result = operation === "inspect" ? packageInspection() : operation === "rollback" ? { ...previous, status: "active" as const } : { ...target, status: operation === "disable" ? "disabled" as const : operation === "activate" ? "active" as const : "installed" as const };
      await act(async () => outcome === "accepted" ? pending.resolve({ ok: true, value: result }) : pending.reject(new Error("synthetic-obsolete-package-error")));
      expect(mounted.panel.querySelector(".asset-package-manager__records")).toBeNull(); expect(mounted.panel.textContent).not.toContain("Current package"); expect(mounted.panel.textContent).not.toContain("Previous package");
      expect(readNotificationMessages(mounted.panel)).toEqual([]);
      if (replacement !== "unmount") {
        expect(mounted.panel.querySelector(".asset-package-manager")!.getAttribute("aria-busy")).toBe("false");
        expect(mounted.panel.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(false); expect(packageButton(mounted.panel, "Install package").disabled).toBe(true);
      }
    });
  }

  for (const replacement of ["workspace", "client", "unmount"] as const) for (const outcome of ["accepted", "rejected"] as const) {
    it(`ignores ${outcome} pending list after ${replacement} replacement`, async () => {
      const pending = packageDeferred(); const client = packageClient({ list: workspaceId => workspaceId === "workspace-a" ? pending.promise : Promise.resolve({ ok: true, value: [] }) });
      const mounted = await mountPackage(client);
      if (replacement === "unmount") { await act(async () => mounted.root.unmount()); packageRoots.splice(packageRoots.indexOf(mounted.root), 1); }
      else await mounted.render(replacement === "workspace" ? "workspace-b" : "workspace-a", replacement === "client" ? packageClient() : client);
      await act(async () => outcome === "accepted" ? pending.resolve({ ok: true, value: [packageRecord()] }) : pending.reject(new Error("synthetic-obsolete-list-error")));
      expect(mounted.panel.querySelector(".asset-package-manager__records")).toBeNull(); expect(readNotificationMessages(mounted.panel)).toEqual([]);
      if (replacement !== "unmount") expect(mounted.panel.querySelector(".asset-package-manager")!.getAttribute("aria-busy")).toBe("false");
    });
  }
});

describe("Package acknowledgement identity denials", () => {
  const variants = ["workspace", "record", "package", "version", "digest", "status", "revision"] as const;
  for (const operation of ["admit", "activate", "disable", "rollback"] as const) for (const variant of variants) {
    if (operation === "admit" && variant === "record") continue;
    it(`denies ${operation} response with wrong ${variant}`, async () => {
      const { target, previous } = packageOperationRecords(operation);
      const original = operation === "rollback" ? previous : target;
      const invalid = { ...original, status: operation === "admit" ? "installed" as const : operation === "disable" ? "disabled" as const : "active" as const,
        ...(variant === "workspace" ? { workspaceId: "workspace-b" as never } : {}),
        ...(variant === "record" ? { recordId: "package.foreign" } : {}),
        ...(variant === "package" ? { packageId: "tests.foreign" } : {}),
        ...(variant === "version" ? { version: "9.0.0" } : {}),
        ...(variant === "digest" ? { packageDigest: `sha256:${"f".repeat(64)}` as AssetPackageRecord["packageDigest"] } : {}),
        ...(variant === "status" ? { status: "quarantined" as const } : {}),
        ...(variant === "revision" ? { revision: 0 } : {}),
      };
      const client = packageClient({ list: async () => ({ ok: true, value: operation === "admit" ? [] : [target, previous] }), inspect: async () => ({ ok: true, value: packageInspection() }), [operation]: async () => ({ ok: true, value: invalid }) });
      const { panel } = await mountPackage(client); await startPackageOperation(panel, operation);
      expect(panel.querySelector(".asset-package-manager")!.getAttribute("aria-busy")).toBe("false");
      expect(readNotificationMessages(panel).join(" ")).not.toContain("is now"); expect(readNotificationMessages(panel).join(" ")).not.toContain("is installed");
      expect(readNotificationMessages(panel).length).toBeGreaterThan(0);
      if (operation === "admit") expect(panel.querySelector(".asset-package-manager__records")).toBeNull();
      else {
        expect(packageRow(panel, target.displayName).textContent).toContain(target.status.toUpperCase());
        expect(packageRow(panel, previous.displayName).textContent).toContain(previous.status.toUpperCase());
      }
    });
  }

  it("denies foreign and duplicate records in a full list without rendering their authority", async () => {
    let lists = 0; const own = packageRecord(), foreign = packageRecord("workspace-b");
    const client = packageClient({ list: async () => ({ ok: true, value: ++lists === 1 ? [foreign] : lists === 2 ? [own, own] : [own] }) });
    const { panel } = await mountPackage(client); expect(panel.querySelector(".asset-package-manager__records")).toBeNull();
    await act(async () => packageButton(panel, "Retry loading installed packages").click()); expect(panel.querySelector(".asset-package-manager__records")).toBeNull();
    await act(async () => packageButton(panel, "Retry loading installed packages").click()); expect(packageRow(panel, own.displayName)).toBeTruthy();
  });
});
