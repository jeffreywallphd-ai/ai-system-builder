import { describe, expect, it } from "vitest";

import { toHtmlFileAcceptAttribute } from "../hooks/toHtmlFileAcceptAttribute";

describe("desktop toHtmlFileAcceptAttribute", () => {
  it("formats accepted extensions and media types for html file inputs", () => {
    expect(
      toHtmlFileAcceptAttribute({
        acceptedExtensions: [".md", ".pdf"],
        acceptedMediaTypes: ["text/markdown", "application/pdf"],
      }),
    ).toBe(".md,.pdf,text/markdown,application/pdf");
  });
});
