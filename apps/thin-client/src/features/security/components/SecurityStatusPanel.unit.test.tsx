// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useThinClientSecurityMock } = vi.hoisted(() => ({ useThinClientSecurityMock: vi.fn() }));
vi.mock("../hooks/useThinClientSecurity", () => ({ useThinClientSecurity: useThinClientSecurityMock }));
import { SecurityStatusPanel } from "./SecurityStatusPanel";

describe("SecurityStatusPanel", () => {
  let root: Root | undefined; let container: HTMLDivElement | undefined;
  afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); vi.resetAllMocks(); });
  async function renderWithStatus(status: any) { useThinClientSecurityMock.mockReturnValue({ status }); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); await act(async () => root?.render(<SecurityStatusPanel />)); }

  it("shows both self-signed and local-ca examples", async () => {
    await renderWithStatus({ mode: "disabled-dev", httpsEnabled: true, httpsRequired: false, tls: { mode: "auto-self-signed", source: "generated" }, requiresRestartToChangeTransportSecurity: true });
    expect(container?.textContent).toContain("auto-self-signed");
    expect(container?.textContent).toContain("auto-local-ca");
    expect(container?.textContent).toContain("requires restarting dev:server");
  });

  it("shows local-ca trust warning and no private key content", async () => {
    await renderWithStatus({ mode: "lan-https-token", httpsEnabled: true, httpsRequired: true, tls: { mode: "auto-local-ca", source: "generated", localCa: { available: true, downloadUrl: "/api/security/tls/local-ca.pem" } } });
    expect(container?.textContent).toContain("No automatic trust-store installation is performed");
    expect(container?.innerHTML).toContain("/api/security/tls/local-ca.pem");
    expect(container?.textContent).not.toContain("PRIVATE KEY");
  });
});
