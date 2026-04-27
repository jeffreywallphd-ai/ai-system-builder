import { describe, expect, it } from "../../../testing/node-test";
import { createDefaultAcceptedArtifactUploadPolicy } from "..";

describe("createDefaultAcceptedArtifactUploadPolicy", () => {
  it("includes common document and tabular media types and extensions", () => {
    const policy = createDefaultAcceptedArtifactUploadPolicy();

    for (const mediaType of [
      "text/markdown",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]) {
      expect(policy.acceptedMediaTypes.includes(mediaType)).toBe(true);
    }

    for (const extension of [".md", ".pdf", ".doc", ".docx", ".csv", ".xls", ".xlsx"]) {
      expect(policy.acceptedExtensions.includes(extension)).toBe(true);
    }
  });
});
