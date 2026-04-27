import { describe, expect, it } from "../../testing/node-test";

import {
  ARTIFACT_KINDS,
  normalizeArtifactDescriptor,
  normalizeArtifactKind,
} from ".";

describe("artifact contracts", () => {
  it("normalizes and constrains artifact kind vocabulary", () => {
    expect(ARTIFACT_KINDS).toEqual(["raw-staged", "transformed", "materialized"]);
    expect(normalizeArtifactKind(" transformed ")).toBe("transformed");
  });

  it("normalizes artifact descriptors with format/provenance metadata", () => {
    const descriptor = normalizeArtifactDescriptor({
      key: " staging/raw/customer-data.csv ",
      kind: " raw-staged ",
      name: " customers.csv ",
      format: {
        mediaType: " text/csv ",
      },
      provenance: {
        sourceKind: " Upload ",
        sourceId: " intake-44 ",
        parentArtifacts: [{ key: " staging/raw/import-1 " }],
      },
    });

    expect(descriptor).toMatchObject({
      key: "staging/raw/customer-data.csv",
      kind: "raw-staged",
      name: "customers.csv",
      format: {
        mediaType: "text/csv",
        encoding: undefined,
        extension: undefined,
      },
      provenance: {
        sourceKind: "upload",
        sourceId: "intake-44",
        parentArtifacts: [{ key: "staging/raw/import-1", label: undefined }],
        transform: undefined,
      },
    });
  });
});
