import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, testDouble } from "../../../testing/node-test";

import { loadPlaywrightChromiumLauncher } from "../playwright/loadPlaywrightChromiumLauncher";

describe("playwright loader", () => {
  it("keeps playwright loading out of adapter-level dynamic import usage", () => {
    const adapterSource = readFileSync(
      resolve("modules/adapters/ingestion/playwright/PlaywrightWebsiteHtmlAcquisitionAdapter.ts"),
      "utf8",
    );

    expect(adapterSource.includes('import("playwright")')).toBe(false);
    expect(adapterSource).toContain("loadPlaywrightChromiumLauncher");
  });

  it("throws a clear optional-dependency error when playwright is not installed", () => {
    const loadModule = testDouble.fn(() => {
      const error = new Error("Cannot find module 'playwright'") as Error & { code?: string };
      error.code = "MODULE_NOT_FOUND";
      throw error;
    });

    expect(() => loadPlaywrightChromiumLauncher(loadModule)).toThrow(
      "requires the optional 'playwright' dependency",
    );
    expect(loadModule).toHaveBeenCalledWith("playwright");
  });

  it("returns chromium.launch from the loaded playwright module", async () => {
    const launch = testDouble.fn(async () => ({
      newPage: async () => ({
        goto: async () => ({ status: () => 200 }),
        content: async () => "<html></html>",
      }),
      close: async () => undefined,
    }));
    const loadModule = testDouble.fn(() => ({
      chromium: { launch },
    }));

    const launchChromium = loadPlaywrightChromiumLauncher(loadModule);
    const browser = await launchChromium({ headless: true });

    expect(loadModule).toHaveBeenCalledWith("playwright");
    expect(launch).toHaveBeenCalledWith({ headless: true });
    expect(typeof browser.close).toBe("function");
  });
});
