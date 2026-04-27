import { describe, expect, it } from "../../../../testing/node-test";

import {
  derivePublishedBackingFromDetail,
  derivePublishedBackingVerificationPresentation,
} from "../artifactBrowserPublishView";

describe("artifactBrowserPublishView", () => {
  it("derives published backing from artifact detail metadata", () => {
    const detail = {
      locator: { storageKey: "uploads/cat.png" },
      metadata: {
        publishedBacking: {
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
          },
          verification: {
            exists: true,
            verifiedAt: "2026-04-18T00:00:00.000Z",
          },
        },
      },
    };

    expect(derivePublishedBackingFromDetail(detail)).toEqual(detail.metadata.publishedBacking);
  });

  it("maps verification states to user-friendly labels", () => {
    expect(derivePublishedBackingVerificationPresentation(undefined).statusLabel).toBe("Not yet verified");

    expect(derivePublishedBackingVerificationPresentation({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
      },
      verification: {
        exists: true,
        verifiedAt: "2026-04-18T00:00:00.000Z",
      },
    }).statusLabel).toBe("Remote backing verified");

    expect(derivePublishedBackingVerificationPresentation({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
      },
      verification: {
        exists: false,
        verifiedAt: "2026-04-18T00:00:00.000Z",
      },
    }).statusLabel).toBe("Remote backing missing");
  });
});
