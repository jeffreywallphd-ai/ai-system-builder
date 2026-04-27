import { describe, expect, it } from "../../../testing/node-test";

import {
  normalizeWebsiteHtmlAcquisitionMechanism,
  normalizeWebsiteHtmlCaptureMetadata,
  normalizeWebsiteIngestionMode,
  normalizeWebsiteIngestionResult,
  normalizeWebsiteIngestionTarget,
} from "..";

describe("website-ingestion domain", () => {
  it("normalizes and validates website ingestion modes", () => {
    expect(normalizeWebsiteIngestionMode(" Automatic ")).toBe("automatic");
    expect(normalizeWebsiteIngestionMode("rendered")).toBe("rendered");
    expect(() => normalizeWebsiteIngestionMode("basic")).toThrow(
      'Website ingestion mode must be one of automatic, rendered. Received "basic".',
    );
  });

  it("normalizes and validates acquisition mechanisms", () => {
    expect(normalizeWebsiteHtmlAcquisitionMechanism(" Simple-HTTP ")).toBe("simple-http");
    expect(normalizeWebsiteHtmlAcquisitionMechanism("rendered-browser")).toBe("rendered-browser");
    expect(() => normalizeWebsiteHtmlAcquisitionMechanism("automatic")).toThrow(
      'Website HTML acquisition mechanism must be one of simple-http, rendered-browser. Received "automatic".',
    );
  });

  it("normalizes targets and rejects empty urls", () => {
    expect(
      normalizeWebsiteIngestionTarget({
        url: " https://example.com/docs ",
        label: " Example Docs ",
      }),
    ).toEqual({
      url: "https://example.com/docs",
      label: "Example Docs",
    });

    expect(() => normalizeWebsiteIngestionTarget({ url: "   " })).toThrow(
      'Website ingestion target url must be a non-empty trimmed string. Received "   ".',
    );
  });

  it("normalizes html capture metadata for staged-artifact metadata compatibility", () => {
    const metadata = normalizeWebsiteHtmlCaptureMetadata({
      sourceUrl: " https://example.com/start ",
      resolvedUrl: " https://example.com/final ",
      retrievedAt: " 2026-04-19T00:00:00.000Z ",
      requestedMode: " rendered ",
      acquisitionMechanismUsed: " rendered-browser ",
      rendered: true,
      httpStatus: 200,
      contentTypeHeader: " text/html; charset=utf-8 ",
    });

    expect(metadata).toEqual({
      sourceUrl: "https://example.com/start",
      resolvedUrl: "https://example.com/final",
      retrievedAt: "2026-04-19T00:00:00.000Z",
      requestedMode: "rendered",
      acquisitionMechanismUsed: "rendered-browser",
      rendered: true,
      httpStatus: 200,
      contentTypeHeader: "text/html; charset=utf-8",
    });
  });

  it("normalizes single-item website ingestion summaries", () => {
    const item = normalizeWebsiteIngestionResult({
      target: {
        url: " https://example.com/page ",
      },
      resolvedUrl: " https://example.com/page ",
      acquisitionMechanismUsed: " simple-http ",
      warnings: [" used rendered fallback ", "   "],
    });

    expect(item).toMatchObject({
      target: {
        url: "https://example.com/page",
      },
      resolvedUrl: "https://example.com/page",
      acquisitionMechanismUsed: "simple-http",
      warnings: ["used rendered fallback"],
    });
  });
});
