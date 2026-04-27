import { describe, expect, it } from "vitest";

import {
  decodeHtmlArtifactPreview,
  HTML_ARTIFACT_PREVIEW_MAX_CHARS,
} from "../helpers/htmlArtifactPreview";

describe("html artifact preview helper", () => {
  it("decodes utf-8 bytes and truncates to configured preview size", () => {
    const longHtml = `<html>${"a".repeat(HTML_ARTIFACT_PREVIEW_MAX_CHARS + 25)}</html>`;
    const preview = decodeHtmlArtifactPreview(new TextEncoder().encode(longHtml));

    expect(preview.length).toBe(HTML_ARTIFACT_PREVIEW_MAX_CHARS);
    expect(preview.startsWith("<html>")).toBe(true);
  });
});
