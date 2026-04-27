import { describe, expect, it } from "../../../testing/node-test";
import {
  classifyArtifactIntakeCandidate,
  createArtifactIntakeCandidate,
  createDefaultAcceptedArtifactUploadPolicy,
} from "..";

describe("artifact intake classification service", () => {
  it("classifies accepted image uploads into the image intake family", () => {
    const result = classifyArtifactIntakeCandidate(
      createArtifactIntakeCandidate({
        fileName: "cat.png",
        mediaType: "image/png",
        bytesLength: 4,
      }),
      createDefaultAcceptedArtifactUploadPolicy(),
    );

    expect(result).toEqual({
      accepted: true,
      artifactFamily: "image",
    });
  });

  it("classifies markdown, document, spreadsheet, and pdf types into dedicated families", () => {
    const policy = createDefaultAcceptedArtifactUploadPolicy();

    expect(
      classifyArtifactIntakeCandidate(
        createArtifactIntakeCandidate({
          fileName: "readme.md",
          mediaType: "text/markdown",
          bytesLength: 4,
        }),
        policy,
      ),
    ).toEqual({ accepted: true, artifactFamily: "markdown" });

    expect(
      classifyArtifactIntakeCandidate(
        createArtifactIntakeCandidate({
          fileName: "report.docx",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytesLength: 4,
        }),
        policy,
      ),
    ).toEqual({ accepted: true, artifactFamily: "document" });

    expect(
      classifyArtifactIntakeCandidate(
        createArtifactIntakeCandidate({
          fileName: "table.csv",
          mediaType: "text/csv",
          bytesLength: 4,
        }),
        policy,
      ),
    ).toEqual({ accepted: true, artifactFamily: "spreadsheet" });

    expect(
      classifyArtifactIntakeCandidate(
        createArtifactIntakeCandidate({
          fileName: "paper.pdf",
          mediaType: "application/pdf",
          bytesLength: 4,
        }),
        policy,
      ),
    ).toEqual({ accepted: true, artifactFamily: "pdf" });
  });

  it("classifies rejected uploads by intake family independently from lifecycle state", () => {
    const result = classifyArtifactIntakeCandidate(
      createArtifactIntakeCandidate({
        fileName: "archive.bin",
        mediaType: "application/octet-stream",
        bytesLength: 4,
      }),
      createDefaultAcceptedArtifactUploadPolicy(),
    );

    expect(result.accepted).toBe(false);
    expect(result.artifactFamily).toBe("binary");
    expect(result.reason).toContain("Artifact type is not accepted");
  });
});
