import { describe, expect, it } from "vitest";

import { toHtmlFileAcceptAttribute } from "../hooks/toHtmlFileAcceptAttribute";

describe("thin-client toHtmlFileAcceptAttribute", () => {
  it("formats accepted extensions and media types for html file inputs", () => {
    expect(
      toHtmlFileAcceptAttribute({
        acceptedExtensions: [".doc", ".docx"],
        acceptedMediaTypes: [
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
      }),
    ).toBe(".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
});
