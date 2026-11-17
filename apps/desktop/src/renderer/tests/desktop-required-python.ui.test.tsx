// @vitest-environment node
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";

import { readDesktopStartupFailure } from "../../startupFailure";
import { createDesktopStartupController } from "../startup/desktopStartup";

it("keeps the shell inert and skips React when the host reports a required Python failure", async () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const fixture = new JSDOM(html);
  const document = fixture.window.document;
  const controller = createDesktopStartupController(document, {
    now: () => 0,
    setTimeout: vi.fn(() => 0),
    clearTimeout: vi.fn(),
    requestFrame: vi.fn(() => 0),
    cancelFrame: vi.fn(),
    reload: vi.fn(),
    motion: { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  try {
    const importApp = vi.fn(async () => {});
    await controller.start(importApp, readDesktopStartupFailure("?required-python=unsupported"));
    controller.ready();
    expect(importApp).not.toHaveBeenCalled();
    expect(document.getElementById("desktop-startup")).toMatchObject({ dataset: { state: "failed" }, hidden: false });
    expect(document.getElementById("root")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.getElementById("desktop-startup-reload")).toHaveProperty("hidden", true);
    expect(document.getElementById("desktop-startup-message")?.textContent).toMatch(/Python 3\.14.*reopen AI System Builder/);
    expect(readDesktopStartupFailure("?required-python=SYNTHETIC_PRIVATE_DETAIL")).toBeUndefined();
  } finally {
    controller.dispose();
    fixture.window.close();
  }
});
