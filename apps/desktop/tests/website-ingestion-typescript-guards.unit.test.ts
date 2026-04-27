import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../modules/testing/node-test";

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8").replace(/\r\n/g, "\n");
}

describe("website ingestion TypeScript regression guards", () => {
  it("keeps website ingestion metadata bridged to storage metadata contracts for webpack emit-safe typing", () => {
    const source = readSourceFile(
      "modules/application/use-cases/website-ingestion/website-ingestion.mappers.ts",
    );

    expect(source).toContain("StorageObjectMetadata");
    expect(source).toContain("StorageObjectMetadata\n  & WebsiteHtmlCaptureMetadata\n  & { artifactFamily: ArtifactFamily };");
  });

  it("keeps playwright adapter/loader on shared chromium types to prevent emit-blocking type drift", () => {
    const adapterSource = readSourceFile(
      "modules/adapters/ingestion/playwright/PlaywrightWebsiteHtmlAcquisitionAdapter.ts",
    );
    const loaderSource = readSourceFile(
      "modules/adapters/ingestion/playwright/loadPlaywrightChromiumLauncher.ts",
    );

    expect(adapterSource).toContain('import type { PlaywrightBrowser } from "./playwrightChromiumTypes";');
    expect(loaderSource).toContain('import type { PlaywrightChromiumLike } from "./playwrightChromiumTypes";');
    expect(adapterSource).not.toContain("interface PlaywrightBrowser");
  });
});
