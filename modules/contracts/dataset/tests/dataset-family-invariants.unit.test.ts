import { describe, expect, it } from "../../../testing/node-test";

import * as datasetContracts from "..";

describe("dataset family invariants", () => {
  it("exports only dataset-family surfaces from the family barrel", () => {
    expect(Object.keys(datasetContracts).sort()).toEqual([
      "DATASET_REVIEW_PAGE_SIZES",
      "groupDatasetVersionsForDisplay",
      "labelDatasetVersionGroup",
      "normalizeDatasetDescriptor",
      "normalizeDatasetId",
      "normalizeDatasetMaterializationDescriptor",
      "normalizeDatasetReference",
      "normalizeDatasetSchemaSummary",
      "normalizeDatasetVersionDigest",
      "normalizeDatasetVersionId",
      "normalizeDatasetVersionPublicationId",
      "normalizeDatasetVersionPublicationRecord",
      "normalizeDatasetVersionRecord",
    ]);
  });
});
