import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));
vi.mock("../secureFetch", () => ({ secureFetch: secureFetchMock }));

import { createSecurityApiClient } from "../securityApiClient";
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("securityApiClient", () => {

  it("uses public fetch for unauthenticated status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { mode: "disabled-dev", httpsEnabled: false, httpsRequired: false, authRequired: false, pairingEnabled: false } }) });
    vi.stubGlobal("fetch", fetchMock);
    await createSecurityApiClient().getSecurityStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(secureFetchMock).not.toHaveBeenCalled();
  });

  it("uses secureFetch for authenticated status", async () => {
    vi.stubGlobal("fetch", vi.fn());
    secureFetchMock.mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { mode: "lan-https-token", httpsEnabled: true, httpsRequired: true, authRequired: true, pairingEnabled: true, currentPrincipal: { deviceId: "d1" } } }) });
    await createSecurityApiClient().getSecurityStatus({ includeAuth: true });
    expect(secureFetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns tls certificate metadata when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { mode: "disabled-dev", httpsEnabled: true, httpsRequired: false, authRequired: false, pairingEnabled: false, tls: { mode: "auto-self-signed", source: "generated", certificateDirectory: "/tmp/tls", certificatePath: "/tmp/tls/cert.pem", hosts: ["localhost"], expiresAt: "2030-01-01T00:00:00.000Z" } } }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createSecurityApiClient().getSecurityStatus();
    expect(result.tls?.mode).toBe("auto-self-signed");
    expect(result.tls?.source).toBe("generated");
    expect(result.tls?.hosts).toEqual(["localhost"]);
    expect(result.tls).not.toHaveProperty("certificateDirectory");
    expect(result.tls).not.toHaveProperty("certificatePath");
  });

  it("supports missing tls metadata for backward compatibility", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { mode: "disabled-dev", httpsEnabled: false, httpsRequired: false, authRequired: false, pairingEnabled: false } }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createSecurityApiClient().getSecurityStatus();
    expect(result.tls).toBeUndefined();
  });

  it.each([401, 403])("preserves canonical server operation and HTTP %s without copying private error details", async status => {
    const operation = status === 401 ? "security.invalid-token" : "security.forbidden";
    secureFetchMock.mockResolvedValueOnce({ status, json: async () => ({ ok: false, error: { operation, code: status === 401 ? "unauthorized" : "forbidden", message: "synthetic-private-payload", details: { value: "synthetic-private-detail" }, endpoint: "synthetic-private-endpoint" } }) });
    const error = await createSecurityApiClient().getSecurityStatus({ includeAuth: true }).catch(value => value);
    expect(error).toMatchObject({ status, code: operation });
    expect(JSON.stringify(error)).not.toContain("synthetic-private");
    expect(error).not.toHaveProperty("details");
    expect(error).not.toHaveProperty("endpoint");
  });

  it.each([null, {}, { mode: "unknown" }, { mode: "disabled-dev", httpsEnabled: "true" }])("refuses malformed successful status %j", async value => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value }) }));
    await expect(createSecurityApiClient().getSecurityStatus()).rejects.toMatchObject({ message: "Could not read security status. Refresh status to try again." });
  });

  it("does not admit a successful envelope from a denied HTTP response", async () => {
    secureFetchMock.mockResolvedValueOnce({ status: 403, json: async () => ({ ok: true, value: { mode: "disabled-dev", httpsEnabled: false, httpsRequired: false, authRequired: false, pairingEnabled: false } }) });
    await expect(createSecurityApiClient().getSecurityStatus({ includeAuth: true })).rejects.toMatchObject({ status: 403 });
  });

  it("copies only known managed principal and TLS fields into a fresh view", async () => {
    const value = { mode: "oidc-bearer", httpsEnabled: true, httpsRequired: true, authRequired: true, pairingEnabled: false,
      currentPrincipal: { principalId: "synthetic-principal", kind: "user", displayName: "Synthetic user", roles: ["synthetic-role"], externalIdentity: { private: "synthetic-private" } },
      tls: { mode: "auto-local-ca", source: "generated", hosts: ["localhost"], privateKey: "synthetic-private", localCa: { available: true, downloadUrl: "/api/security/tls/local-ca.pem", trustInstalled: false } }, private: "synthetic-private" };
    secureFetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true, value }) });
    const result = await createSecurityApiClient().getSecurityStatus({ includeAuth: true });
    expect(result.mode).toBe("oidc-bearer"); expect(result.currentPrincipal).toEqual({ principalId: "synthetic-principal", kind: "user", displayName: "Synthetic user" });
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
    value.tls.hosts.push("substituted"); value.currentPrincipal.displayName = "substituted";
    expect(result.tls?.hosts).toEqual(["localhost"]); expect(result.currentPrincipal?.displayName).toBe("Synthetic user");
  });

  it.each(["javascript:synthetic", "https://untrusted.invalid/certificate", "//untrusted.invalid/certificate"])("refuses an unapproved certificate link %s", async downloadUrl => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { mode: "disabled-dev", httpsEnabled: true, httpsRequired: false, authRequired: false, pairingEnabled: false, tls: { localCa: { available: true, downloadUrl } } } }) }));
    await expect(createSecurityApiClient().getSecurityStatus()).rejects.toMatchObject({ message: "Could not read security status. Refresh status to try again." });
  });

  it("retains HTTP denial when its body cannot be decoded", async () => {
    secureFetchMock.mockResolvedValueOnce({ status: 401, json: async () => { throw new Error("synthetic-private-response"); } });
    const error = await createSecurityApiClient().getSecurityStatus({ includeAuth: true }).catch(value => value);
    expect(error).toMatchObject({ status: 401 }); expect(JSON.stringify(error)).not.toContain("synthetic-private");
  });

  it("returns fixed diagnostics for network failure without endpoint or supplier details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic-private-network-error")));
    await expect(createSecurityApiClient().getSecurityStatus()).rejects.toEqual({ message: "Could not read security status. Refresh status to try again." });
  });

  it("keeps pairing bytes on the existing intended path while dropping unknown response fields", async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { bearerToken: "synthetic-issued-token", deviceId: "synthetic-device", private: "synthetic-private" } }) });
    vi.stubGlobal("fetch", fetch);
    expect(await createSecurityApiClient().completePairing({ pairingCode: "synthetic-code", deviceName: "Synthetic device", requestedScopes: ["artifact:read"] })).toEqual({ bearerToken: "synthetic-issued-token", deviceId: "synthetic-device" });
    expect(fetch).toHaveBeenCalledWith("/api/security/pairing/complete", expect.objectContaining({ method: "POST", body: JSON.stringify({ pairingCode: "synthetic-code", deviceName: "Synthetic device", requestedScopes: ["artifact:read"] }) }));
    expect(secureFetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "synthetic token\r\n", { private: "synthetic" }])("rejects malformed pairing credentials %j", async bearerToken => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { bearerToken } }) }));
    await expect(createSecurityApiClient().completePairing({ pairingCode: "synthetic-code" })).rejects.toEqual({ message: "Could not pair this device. Try again." });
  });
});


it("uses secureFetch for mode changes and never retries denied mutations publicly",async()=>{
 const publicFetch=vi.fn();vi.stubGlobal('fetch',publicFetch);
 secureFetchMock.mockResolvedValueOnce({status:200,json:async()=>({ok:true,value:{mode:'disabled-dev'}})});
 expect(await createSecurityApiClient().setDevSecurityMode('disabled-dev')).toEqual({mode:'disabled-dev'});
 expect(secureFetchMock).toHaveBeenCalledWith('/api/security/dev-mode',expect.objectContaining({method:'POST',body:JSON.stringify({mode:'disabled-dev'})}));
 for(const status of [401,403]) {
  secureFetchMock.mockResolvedValueOnce({status,json:async()=>({ok:false,error:{operation:'security.forbidden',code:'unauthorized',message:'Forbidden.'}})});
  await expect(createSecurityApiClient().setDevSecurityMode('disabled-dev')).rejects.toMatchObject({status});
 }
 expect(publicFetch).not.toHaveBeenCalled();
});
