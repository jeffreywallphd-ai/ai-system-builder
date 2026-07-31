import { beforeEach, describe, expect, it, vi } from "vitest";

const { secureFetchMock } = vi.hoisted(() => ({ secureFetchMock: vi.fn() }));
vi.mock("../secureFetch", () => ({ secureFetch: secureFetchMock }));

import { createSecurityApiClient } from "../securityApiClient";

describe("securityApiClient", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uses public fetch for unauthenticated status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { mode: "disabled-dev" } }) });
    vi.stubGlobal("fetch", fetchMock);
    await createSecurityApiClient().getSecurityStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(secureFetchMock).not.toHaveBeenCalled();
  });

  it("uses secureFetch for authenticated status", async () => {
    vi.stubGlobal("fetch", vi.fn());
    secureFetchMock.mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { mode: "lan-https-token", currentPrincipal: { deviceId: "d1" } } }) });
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
  });

  it("supports missing tls metadata for backward compatibility", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ ok: true, value: { mode: "disabled-dev", httpsEnabled: false, httpsRequired: false, authRequired: false, pairingEnabled: false } }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createSecurityApiClient().getSecurityStatus();
    expect(result.tls).toBeUndefined();
  });
});
