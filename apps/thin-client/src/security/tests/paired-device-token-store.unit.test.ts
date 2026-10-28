import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairedDeviceTokenStore } from "../pairedDeviceTokenStore";
import { secureFetch } from "../secureFetch";

beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
describe("private pairing read ownership", () => {
  it("preserves ordinary set, read and clear", () => {
    expect(pairedDeviceTokenStore.hasToken()).toBe(false);
    pairedDeviceTokenStore.setToken("synthetic-first-token");
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-first-token");
    expect(pairedDeviceTokenStore.hasToken()).toBe(true);
    pairedDeviceTokenStore.clearToken(); expect(pairedDeviceTokenStore.getToken()).toBeNull();
  });
  it("clears only the token captured for the failed request", () => {
    pairedDeviceTokenStore.setToken("synthetic-first-token");
    const request = pairedDeviceTokenStore.captureToken();
    expect(request.hasToken).toBe(true); expect(request.isCurrent()).toBe(true);
    expect(request.clearIfCurrent()).toBe(true); expect(request.isCurrent()).toBe(false);
    expect(request.clearIfCurrent()).toBe(false); expect(pairedDeviceTokenStore.hasToken()).toBe(false);
  });
  it("retains a replacement token and exposes no token in its comparison handle", () => {
    pairedDeviceTokenStore.setToken("synthetic-first-token"); const request = pairedDeviceTokenStore.captureToken();
    pairedDeviceTokenStore.setToken("synthetic-newer-token");
    expect(request.isCurrent()).toBe(false); expect(request.clearIfCurrent()).toBe(false);
    expect(pairedDeviceTokenStore.getToken()).toBe("synthetic-newer-token");
    expect(JSON.stringify(request)).not.toContain("synthetic-");
  });
  it("cannot claim token-clear authority from an empty capture", () => {
    const request = pairedDeviceTokenStore.captureToken();
    expect(request.readable).toBe(true); expect(request.isCurrent()).toBe(true);
    pairedDeviceTokenStore.setToken("synthetic-newer-token");
    expect(request.hasToken).toBe(false); expect(request.isCurrent()).toBe(false);
    expect(request.clearIfCurrent()).toBe(false); expect(pairedDeviceTokenStore.hasToken()).toBe(true);
  });
  it("treats absent or blocked read storage as no readable credential", () => {
    for (const storage of [undefined, { getItem: () => { throw new Error("synthetic-private-storage-error"); } }]) {
      vi.stubGlobal("localStorage", storage);
      expect(pairedDeviceTokenStore.getToken()).toBeNull(); expect(pairedDeviceTokenStore.hasToken()).toBe(false);
      const request = pairedDeviceTokenStore.captureToken();
      expect(request.readable).toBe(false); expect(request.isCurrent()).toBe(false);
      expect(request.clearIfCurrent()).toBe(false);
    }
  });
  it("preserves the actual thin-client secureFetch header and fails closed on blocked storage", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch); pairedDeviceTokenStore.setToken("synthetic-header-token");
    await secureFetch("/api/security/status", { method: "GET" });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer synthetic-header-token");
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("synthetic-private-storage-error"); } });
    await secureFetch("/api/security/status", { method: "GET" });
    expect(new Headers(fetch.mock.calls[1][1]?.headers).has("Authorization")).toBe(false);
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get("x-client-source")).toBe("thin-client");
  });
});
