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
  async function renderWithStatus(status: unknown, extra: Record<string, unknown> = {}) { useThinClientSecurityMock.mockReturnValue({ status, loading: false, refreshStatus: vi.fn().mockResolvedValue(true), ...extra }); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); await act(async () => root?.render(<SecurityStatusPanel />)); }

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

  it("announces loading without claiming an unknown listener uses HTTP", async () => {
    await renderWithStatus(undefined, { loading: true });
    expect(container?.querySelector('[role="status"]')?.textContent).toContain("Checking security status");
    expect(container?.textContent).not.toContain("HTTP only");
    expect(Array.from(container!.querySelectorAll("p")).some(value => value.textContent === "HTTPS required: No")).toBe(false);
    expect(container?.textContent).toContain("HTTPS required: Not available");
    expect(container?.textContent).not.toContain("Pair this device");
  });

  it("shows fixed read-failure guidance and an explicit retry", async () => {
    const refreshStatus = vi.fn().mockResolvedValue(true);
    await renderWithStatus(undefined, { error: { message: "synthetic-private-error" }, refreshStatus });
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain("Could not read security status. Refresh status to try again.");
    expect(container?.textContent).not.toContain("synthetic-private-error");
    expect(container?.textContent).not.toContain("HTTP only");
    const button = Array.from(container!.querySelectorAll("button")).find(value => value.textContent === "Refresh status");
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(refreshStatus).toHaveBeenCalledTimes(1);
  });

  it("shows known forbidden guidance without adding unmounted pairing or admin controls", async () => {
    await renderWithStatus({ mode: "lan-https-token", httpsEnabled: true, httpsRequired: true }, {
      error: { status: 403, code: "security.forbidden", message: "synthetic-private-denial" },
      guidance: "This paired device does not have permission for this action.",
    });
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain("does not have permission");
    expect(container?.textContent).not.toContain("synthetic-private-denial");
    expect(container?.querySelector("form")).toBeNull();
    expect(container?.querySelector('input[type="password"]')).toBeNull();
  });
});
