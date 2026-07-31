import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AssetResourceBackedView } from "../../../../contracts/asset";
import {
  createUnsupportedAssetResourceBackedViewProvider,
  type AssetResourceBackedViewListQuery,
  type AssetResourceBackedViewListResult,
  type AssetResourceBackedViewProvider,
  type AssetResourceBackedViewProviderDiagnostic,
} from "../asset-resource-backed-view-provider.port";

const view: AssetResourceBackedView = {
  viewId: "view.port.test",
  viewKind: "artifact",
  assetType: "data-source",
  assetFamily: "resource-backed",
  displayName: "Port Test View",
  lifecycleStatus: "draft",
};

describe("AssetResourceBackedViewProvider port", () => {
  it("supports structured list results with items, nextCursor, and diagnostics", async () => {
    const provider: AssetResourceBackedViewProvider = {
      providerId: "port-test-provider",
      async listResourceBackedViews(): Promise<AssetResourceBackedViewListResult> {
        return {
          items: [view],
          nextCursor: "cursor.next",
          diagnostics: [{ severity: "info", code: "provider-note", message: "Provider note.", providerId: "port-test-provider" }],
        };
      },
      async readResourceBackedView(viewId) {
        return viewId === view.viewId ? view : undefined;
      },
    };

    const result = await provider.listResourceBackedViews();
    assert.deepEqual(result.items, [view]);
    assert.equal(result.nextCursor, "cursor.next");
    assert.equal(result.diagnostics?.[0]?.code, "provider-note");
  });

  it("diagnostics are structured and do not require raw errors", () => {
    const diagnostic: AssetResourceBackedViewProviderDiagnostic = {
      severity: "warning",
      code: "resource-backed-view-provider-unavailable",
      message: "Provider is unavailable.",
      providerId: "provider.one",
      sourceKind: "artifact",
      metadata: { failureKind: "unavailable" },
    };

    assert.equal("error" in diagnostic, false);
    assert.equal("stack" in diagnostic, false);
    assert.equal(diagnostic.metadata?.failureKind, "unavailable");
  });

  it("unsupported provider returns an empty result plus an info diagnostic", async () => {
    const provider = createUnsupportedAssetResourceBackedViewProvider({ providerId: "dataset-provider", sourceKind: "dataset" });

    assert.deepEqual(await provider.listResourceBackedViews(), {
      items: [],
      diagnostics: [
        {
          severity: "info",
          code: "resource-backed-view-provider-unsupported",
          message: "Resource-backed views for this source are not wired.",
          providerId: "dataset-provider",
          sourceKind: "dataset",
        },
      ],
    });
    assert.equal(await provider.readResourceBackedView("missing"), undefined);
  });

  it("query shape supports filters and pagination without transport-specific fields", () => {
    const query: AssetResourceBackedViewListQuery = {
      searchText: "dataset",
      assetTypes: ["dataset"],
      assetFamilies: ["resource-backed"],
      lifecycleStatuses: ["published"],
      viewKinds: ["dataset"],
      limit: 25,
      cursor: "provider.cursor",
    };

    assert.deepEqual(Object.keys(query).sort(), [
      "assetFamilies",
      "assetTypes",
      "cursor",
      "lifecycleStatuses",
      "limit",
      "searchText",
      "viewKinds",
    ]);
    assert.equal("headers" in query, false);
    assert.equal("channel" in query, false);
    assert.equal("url" in query, false);
  });

  it("port module does not import adapters, hosts, transport, UI, runtime, storage, or persistence", () => {
    const source = readFileSync("modules/application/ports/asset/asset-resource-backed-view-provider.port.ts", "utf8");

    assert.doesNotMatch(source, /adapters|hosts|api-express|ipc-electron|electron|express|preload|renderer|thin-client|runtime|storage|persistence/i);
    assert.doesNotMatch(source, /node:fs|node:path|fetch\(|readFile|readdir|scan/i);
  });
});
