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
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
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
          bytes: new TextEncoder().encode("# Read me"),
        }),
        policy,
      ),
    ).toEqual({ accepted: true, artifactFamily: "markdown" });

    expect(
      classifyArtifactIntakeCandidate(
        createArtifactIntakeCandidate({
          fileName: "report.docx",
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        }),
        policy,
      ),
    ).toEqual({ accepted: true, artifactFamily: "document" });

    expect(
      classifyArtifactIntakeCandidate(
        createArtifactIntakeCandidate({
          fileName: "table.csv",
          mediaType: "text/csv",
          bytes: new TextEncoder().encode("name,value\nalpha,1"),
        }),
        policy,
      ),
    ).toEqual({ accepted: true, artifactFamily: "spreadsheet" });

    expect(
      classifyArtifactIntakeCandidate(
        createArtifactIntakeCandidate({
          fileName: "paper.pdf",
          mediaType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.7"),
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
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
      createDefaultAcceptedArtifactUploadPolicy(),
    );

    expect(result.accepted).toBe(false);
    expect(result.artifactFamily).toBe("binary");
    expect(result.reason).toContain("Artifact type is not accepted");
  });

  it("rejects accepted media types paired with misleading extensions", () => {
    const result = classifyArtifactIntakeCandidate(
      createArtifactIntakeCandidate({
        fileName: "payload.txt",
        mediaType: "image/png",
        bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
      createDefaultAcceptedArtifactUploadPolicy(),
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("do not agree");
  });

  it("rejects content whose signature does not match the coherent name and media type", () => {
    const result = classifyArtifactIntakeCandidate(
      createArtifactIntakeCandidate({
        fileName: "payload.png",
        mediaType: "image/png",
        bytes: new TextEncoder().encode("not a png"),
      }),
      createDefaultAcceptedArtifactUploadPolicy(),
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("content does not match");
  });
});
