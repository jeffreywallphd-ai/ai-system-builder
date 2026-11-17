import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairedDeviceTokenStore } from "../../../../security/pairedDeviceTokenStore";
import { STATUS_FAILURE } from "../../../../security/securityErrors";
import type { SecurityStatusResult } from "../../../../security/securityApiClient";
import { useThinClientSecurity } from "../useThinClientSecurity";
import { SecurityStatusPanel } from "../../components/SecurityStatusPanel";

const { api } = vi.hoisted(() => ({ api: { getSecurityStatus: vi.fn(), completePairing: vi.fn(), setDevSecurityMode: vi.fn(), getDevSecurityMode: vi.fn() } }));
vi.mock("../../../../security/securityApiClient", () => ({ createSecurityApiClient: () => api }));
const publicStatus: SecurityStatusResult = { mode: "lan-https-token", httpsEnabled: true, httpsRequired: true, authRequired: true, pairingEnabled: true };
function held<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let root: Root | undefined, container: HTMLDivElement | undefined, current: ReturnType<typeof useThinClientSecurity>;
let devMode: "disabled-dev" | "lan-token-enforced" = "lan-token-enforced";
function Probe() {
  current = useThinClientSecurity();
  return <><output>{current.uiState}</output><p>{current.error?.message}</p><p>{current.devSecurityModeUpdateError}</p><p>{current.devSecurityModeUpdateSuccess}</p></>;
}
async function mount(panel = false, strict = false) {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  const child = panel ? <SecurityStatusPanel /> : <Probe />;
  await act(async () => root!.render(strict ? <StrictMode>{child}</StrictMode> : child));
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); devMode = "lan-token-enforced";
  api.getSecurityStatus.mockImplementation(async (options?: { includeAuth?: boolean }) => ({ ...publicStatus, devSecurityEnforcementMode: devMode,
    ...(options?.includeAuth ? { currentPrincipal: { deviceId: "synthetic-device" } } : {}) }));
  api.completePairing.mockResolvedValue({ bearerToken: "synthetic-issued-token" });
  api.setDevSecurityMode.mockImplementation(async mode => { devMode = mode; return { mode }; });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined; container = undefined; vi.unstubAllGlobals(); localStorage.clear(); });

describe("current Security view recovery", () => {
  it("retries a real mounted failure through the read client without a mutation", async () => {
    api.getSecurityStatus.mockRejectedValueOnce(new Error("synthetic-private-read-error"));
    await mount(true);
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(STATUS_FAILURE);
    expect(container!.textContent).not.toContain("synthetic-private"); expect(container!.textContent).not.toContain("HTTP only");
    await act(async () => (container!.querySelector("button") as HTMLButtonElement).click());
    expect(container!.querySelector('[role="alert"]')).toBeNull();
    expect(container!.textContent).toContain("HTTPS enabled");
    expect(api.getSecurityStatus).toHaveBeenCalledTimes(2); expect(api.completePairing).not.toHaveBeenCalled(); expect(api.setDevSecurityMode).not.toHaveBeenCalled();
  });
  it("admits one read while status is pending and recovers a later explicit retry", async () => {
    const pending = held<SecurityStatusResult>(); api.getSecurityStatus.mockReturnValueOnce(pending.promise); await mount();
    await act(async () => { expect(await current.refreshStatus()).toBe(false); expect(await current.refreshStatus()).toBe(false); });
    expect(api.getSecurityStatus).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(false)); expect(current.loading).toBe(false); expect(current.error?.message).toBe(STATUS_FAILURE);
    await act(async () => { expect(await current.refreshStatus()).toBe(true); }); expect(current.uiState).toBe("unpaired");
  });
  it.each(["resolve", "reject"] as const)("does not let an old authenticated read %s adopt a new token", async outcome => {
    pairedDeviceTokenStore.setToken("synthetic-first-token"); const pending = held<SecurityStatusResult>();
    api.getSecurityStatus.mockResolvedValueOnce(publicStatus).mockReturnValueOnce(pending.promise); await mount();
    pairedDeviceTokenStore.setToken("synthetic-newer-token");
    await act(async () => outcome === "resolve" ? pending.resolve({ ...publicStatus, currentPrincipal: { deviceId: "synthetic-old-device" } })
      : pending.reject({ status: 401, code: "security.invalid-token", message: "synthetic-private-error" }));
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-newer-token");
    expect(current.status?.currentPrincipal).toBeUndefined(); expect(current.error?.message).toContain("saved connection changed");
    await act(async () => { expect(await current.refreshStatus()).toBe(true); }); expect(current.uiState).toBe("paired");
  });
  it("clears the exact invalid token but retains a forbidden one", async () => {
    pairedDeviceTokenStore.setToken("synthetic-first-token");
    api.getSecurityStatus.mockResolvedValueOnce(publicStatus).mockRejectedValueOnce({ status: 401, code: "security.revoked-token", message: "synthetic-private-error" });
    await mount(); expect(pairedDeviceTokenStore.hasToken()).toBe(false); expect(current.uiState).toBe("token-invalid");
    pairedDeviceTokenStore.setToken("synthetic-newer-token");
    api.getSecurityStatus.mockResolvedValueOnce(publicStatus).mockRejectedValueOnce({ status: 403, code: "security.forbidden", message: "synthetic-private-error" });
    await act(async () => current.refreshStatus()); expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-newer-token"); expect(current.uiState).toBe("unauthorized");
    expect(container!.textContent).not.toContain("synthetic-private");
  });
  it("retires pending reads and retained callbacks on unmount", async () => {
    pairedDeviceTokenStore.setToken("synthetic-first-token"); const pending = held<SecurityStatusResult>();
    api.getSecurityStatus.mockResolvedValueOnce(publicStatus).mockReturnValueOnce(pending.promise); await mount(); const retired = current;
    await act(async () => root!.unmount()); root = undefined;
    pairedDeviceTokenStore.setToken("synthetic-newer-token"); pending.reject({ status: 401, code: "security.invalid-token" });
    await act(async () => Promise.resolve());
    expect(await retired.refreshStatus()).toBe(false); expect(await retired.completePairing("synthetic-code")).toBe(false);
    expect(await retired.setDevSecurityEnforcementMode("disabled-dev")).toBe(false); expect(retired.clearLocalPairing()).toBe(false);
    expect(api.getSecurityStatus).toHaveBeenCalledTimes(2); expect(api.completePairing).not.toHaveBeenCalled(); expect(api.setDevSecurityMode).not.toHaveBeenCalled();
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-newer-token");
  });
  it("keeps the replayed StrictMode read when the first lease later fails", async () => {
    const first = held<SecurityStatusResult>(); api.getSecurityStatus.mockReturnValueOnce(first.promise); await mount(false, true);
    expect(current.uiState).toBe("unpaired"); expect(api.getSecurityStatus).toHaveBeenCalledTimes(2);
    await act(async () => first.reject(new Error("synthetic-retired-read")));
    expect(current.error).toBeUndefined(); expect(current.loading).toBe(false);
  });
  it("admits one helper action and refuses competing same-turn mutation", async () => {
    await mount(); const pending = held<{ bearerToken: string }>(); api.completePairing.mockReturnValueOnce(pending.promise); let result!: Promise<boolean>;
    await act(async () => { result = current.completePairing("synthetic-code", "Synthetic device"); expect(await current.completePairing("duplicate")).toBe(false);
      expect(await current.setDevSecurityEnforcementMode("disabled-dev")).toBe(false); expect(current.clearLocalPairing()).toBe(false); });
    expect(api.completePairing).toHaveBeenCalledTimes(1); expect(api.setDevSecurityMode).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ bearerToken: "synthetic-issued-token" }); expect(await result).toBe(true); });
    expect(current.uiState).toBe("paired"); expect(current.pairingBusy).toBe(false);
  });
  it.each(["replace", "unmount"] as const)("does not install a pending pairing after %s", async change => {
    await mount(); const pending = held<{ bearerToken: string }>(); api.completePairing.mockReturnValueOnce(pending.promise); let result!: Promise<boolean>;
    await act(async () => { result = current.completePairing("synthetic-code"); });
    if (change === "unmount") { await act(async () => root!.unmount()); root = undefined; }
    pairedDeviceTokenStore.setToken("synthetic-newer-token");
    await act(async () => { pending.resolve({ bearerToken: "synthetic-stale-token" }); expect(await result).toBe(false); });
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-newer-token");
  });
  it("does not report pairing success after a failed readback and permits explicit retry", async () => {
    await mount(); api.getSecurityStatus.mockRejectedValueOnce(new Error("synthetic-private-readback"));
    await act(async () => { expect(await current.completePairing("synthetic-code")).toBe(false); });
    expect(current.error?.message).toBe(STATUS_FAILURE); expect(current.pairingBusy).toBe(false);
    await act(async () => { expect(await current.refreshStatus()).toBe(true); }); expect(current.uiState).toBe("paired");
  });
  it("does not report mode-change success after failed readback or denial", async () => {
    await mount(); api.getSecurityStatus.mockRejectedValueOnce(new Error("synthetic-private-readback"));
    await act(async () => { expect(await current.setDevSecurityEnforcementMode("disabled-dev")).toBe(false); });
    expect(current.devSecurityModeUpdateSuccess).toBeUndefined(); expect(current.actionBusy).toBe(false);
    api.setDevSecurityMode.mockRejectedValueOnce(new Error("synthetic-private-mode-error"));
    await act(async () => { expect(await current.setDevSecurityEnforcementMode("disabled-dev")).toBe(false); });
    expect(current.devSecurityModeUpdateError).toBe("Could not update security mode. Try again."); expect(container!.textContent).not.toContain("synthetic-private");
    await act(async () => { expect(await current.setDevSecurityEnforcementMode("disabled-dev")).toBe(true); });
    expect(current.devSecurityModeUpdateSuccess).toBe("Dev security enforcement updated.");
  });
  it("clearing pairing retires a pending read without deleting a later replacement", async () => {
    pairedDeviceTokenStore.setToken("synthetic-first-token"); const pending = held<SecurityStatusResult>();
    api.getSecurityStatus.mockResolvedValueOnce(publicStatus).mockReturnValueOnce(pending.promise); await mount();
    await act(async () => { expect(current.clearLocalPairing()).toBe(true); });
    pairedDeviceTokenStore.setToken("synthetic-newer-token");
    await act(async () => pending.reject({ status: 401, code: "security.invalid-token" }));
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-newer-token"); expect(current.loading).toBe(false);
  });
  it("handles unreadable browser storage without crashing the mounted panel", async () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("synthetic-private-storage-error"); } });
    await mount(true); expect(container!.textContent).toContain("HTTPS enabled");
    expect(container!.textContent).not.toContain("synthetic-private"); expect(api.getSecurityStatus).toHaveBeenCalledTimes(1);
  });

  it("does not announce mode success for a foreign acknowledgement", async () => {
    await mount(); api.setDevSecurityMode.mockResolvedValueOnce({ mode: "lan-token-enforced" });
    await act(async () => { expect(await current.setDevSecurityEnforcementMode("disabled-dev")).toBe(false); });
    expect(current.devSecurityModeUpdateSuccess).toBeUndefined(); expect(api.getSecurityStatus).toHaveBeenCalledTimes(1);
  });

  it("does not install malformed pairing or expose a failed storage write", async () => {
    await mount(); api.completePairing.mockResolvedValueOnce({ bearerToken: undefined });
    await act(async () => { expect(await current.completePairing("synthetic-code")).toBe(false); });
    expect(pairedDeviceTokenStore.hasToken()).toBe(false);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("synthetic-private-write-error"); } });
    await act(async () => { expect(await current.completePairing("synthetic-code")).toBe(false); });
    expect(current.pairingBusy).toBe(false); expect(current.error?.message).toBe("Could not pair this device. Try again.");
    expect(container!.textContent).not.toContain("synthetic-private");
  });

  it("keeps clear-storage failure explicit and sanitized", async () => {
    await mount(); vi.stubGlobal("localStorage", { getItem: () => "synthetic-still-stored", removeItem: () => { throw new Error("synthetic-private-clear-error"); } });
    await act(async () => { expect(current.clearLocalPairing()).toBe(false); });
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-still-stored");
    expect(current.error?.message).toBe("Could not clear the saved pairing. Try again.");
    expect(container!.textContent).not.toContain("synthetic-private");
  });

  it.each(["absent", "read-blocked"] as const)("refuses pairing before dispatch when storage is %s", async state => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", state === "absent" ? undefined : {
      getItem: () => { throw new Error("synthetic-private-read-error"); }, setItem,
    });
    await mount();
    await act(async () => { expect(await current.completePairing("synthetic-code")).toBe(false); });
    expect(api.completePairing).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled();
    expect(current.error?.message).toBe("Could not pair this device. Try again.");
    expect(current.pairingBusy).toBe(false);
    vi.unstubAllGlobals();
    await act(async () => { expect(await current.completePairing("synthetic-code")).toBe(true); });
    expect(current.uiState).toBe("paired");
  });

  it("does not report success for a write that cannot be observed and never rolls back unknown data", async () => {
    const removeItem = vi.fn(); vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem });
    await mount();
    await act(async () => { expect(await current.completePairing("synthetic-code")).toBe(false); });
    expect(current.error?.message).toBe("Could not pair this device. Try again."); expect(removeItem).not.toHaveBeenCalled();
  });

  it("does not attribute a replacement connection's readback to the original pairing", async () => {
    await mount(); const readback = held<SecurityStatusResult>(); api.getSecurityStatus.mockReturnValueOnce(readback.promise);
    let paired!: Promise<boolean>;
    await act(async () => { paired = current.completePairing("synthetic-code"); await Promise.resolve(); });
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-issued-token");
    pairedDeviceTokenStore.setToken("synthetic-newer-token");
    await act(async () => { readback.resolve(publicStatus); expect(await paired).toBe(false); });
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-newer-token");
    expect(current.error?.message).toContain("saved connection changed");
  });

  it("does not announce a mode change that the current readback does not confirm", async () => {
    await mount(); api.getSecurityStatus.mockResolvedValueOnce({ ...publicStatus, devSecurityEnforcementMode: "lan-token-enforced" });
    await act(async () => { expect(await current.setDevSecurityEnforcementMode("disabled-dev")).toBe(false); });
    expect(current.devSecurityModeUpdateSuccess).toBeUndefined();
    expect(current.devSecurityModeUpdateError).toBe("Could not update security mode. Try again.");
  });

  it("does not remove another writer's value after an unconfirmed pairing write", async () => {
    let stored = "synthetic-first-token"; const removeItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem: () => { stored = "synthetic-external-token"; }, removeItem });
    await mount();
    await act(async () => { expect(await current.completePairing("synthetic-code")).toBe(false); });
    expect(stored).toBe("synthetic-external-token"); expect(removeItem).not.toHaveBeenCalled();
  });

  it("does not let a pending read erase a pairing-storage refusal", async () => {
    const pending = held<SecurityStatusResult>(); api.getSecurityStatus.mockReturnValueOnce(pending.promise);
    vi.stubGlobal("localStorage", undefined); await mount();
    await act(async () => { expect(await current.completePairing("synthetic-code")).toBe(false); });
    expect(current.loading).toBe(false);
    await act(async () => pending.resolve(publicStatus));
    expect(current.error?.message).toBe("Could not pair this device. Try again.");
    expect(api.completePairing).not.toHaveBeenCalled();
  });
});
