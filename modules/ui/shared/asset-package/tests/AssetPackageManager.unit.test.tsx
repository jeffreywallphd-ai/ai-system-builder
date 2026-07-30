import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "../../../../testing/node-test";
import {
  AssetPackageManager,
  type AssetPackageClient,
} from "../AssetPackageManager";

describe("AssetPackageManager", () => {
  it("renders the non-executing package workflow with accessible ordered steps", () => {
    const pending = new Promise<never>(() => undefined);
    const client: AssetPackageClient = {
      inspect: () => pending,
      admit: () => pending,
      list: () => pending,
      activate: () => pending,
      disable: () => pending,
      rollback: () => pending,
    };

    const html = renderToStaticMarkup(
      <AssetPackageManager workspaceId="workspace-a" client={client} />,
    );

    expect(html).toContain("Import Assets");
    expect(html).not.toContain("Import asset packages");
    expect(html).toContain("without execution");
    expect(html).toContain("Download .aisb-package starter");
    expect(html).toContain("namespaced package ID and version");
    expect(html).toContain("SHA-256 digests");
    expect(html).toContain("SPDX SBOM");
    expect(html).toContain("separate explicit decisions");
    expect(html).toContain('aria-label="Asset import steps"');
    expect(html).toContain("Select and inspect");
    expect(html).toContain("Review trust and permissions");
    expect(html).toContain("Install for this workspace");
    expect(html).toContain(
      'accept=".aisb-package,application/vnd.ai-system-builder.package.v1+json"',
    );
    expect(html).toContain("Loading installed packages");
  });
});
