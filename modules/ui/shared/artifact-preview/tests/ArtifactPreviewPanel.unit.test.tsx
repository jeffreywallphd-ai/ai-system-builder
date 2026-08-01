import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "../../../../testing/node-test";
import { ArtifactPreviewPanel } from "../ArtifactPreviewPanel";

describe("ArtifactPreviewPanel", () => {
  it("shows a rasterized PDF first page without embedding active PDF content", () => {
    const html = renderToStaticMarkup(
      <ArtifactPreviewPanel
        preview={{
          status: "ready",
          title: "PDF preview",
          descriptor: {
            storageKey: "uploads/report.pdf",
            kind: "pdf",
            fileTypeLabel: "PDF",
          },
          mediaUrl: "blob:first-page-image",
        }}
      />,
    );
    expect(html).toContain("artifact-preview__pdf-page");
    expect(html).toContain("First page of uploads/report.pdf");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<object");
    expect(html).not.toContain("<embed");
  });
});
