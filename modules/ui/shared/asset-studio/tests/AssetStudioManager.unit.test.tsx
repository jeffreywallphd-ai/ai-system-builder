import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "../../../../testing/node-test";
import {
  AssetStudioManager,
  type AssetStudioClient,
} from "../AssetStudioManager";

describe("AssetStudioManager", () => {
  it("renders the shared ordered, review-first authoring experience", () => {
    const pending = new Promise<never>(() => undefined);
    const client: AssetStudioClient = {
      start: () => pending,
      propose: () => pending,
      review: () => pending,
      list: () => pending,
      createAssetDraft: () => pending,
      updateAssetDraft: () => pending,
      readAssetDraft: () => pending,
      listAssetDrafts: () => pending,
      reviewAssetDraft: () => pending,
      publishAssetDraft: () => pending,
      abandonAssetDraft: () => pending,
    };
    const html = renderToStaticMarkup(
      <AssetStudioManager workspaceId="workspace-a" client={client} />,
    );
    expect(html).toContain("Asset Studio");
    expect(html).toContain('aria-label="Asset Studio authoring steps"');
    expect(html).toContain("Choose the contract");
    expect(html).toContain("Plan and propose source");
    expect(html).toContain("Review and approve");
    expect(html).toContain("Build, test, and publish");
    expect(html).toContain(
      "Missing sandbox support remains a blocking, truthful state",
    );
  });
});
