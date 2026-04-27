import { describe, expect, it } from "../../../testing/node-test";

import * as datasetContracts from "..";

describe("dataset family invariants", () => {
  it("exports only dataset-family surfaces from the family barrel", () => {
    expect(Object.keys(datasetContracts).sort()).toEqual([
      "normalizeDatasetDescriptor",
      "normalizeDatasetMaterializationDescriptor",
      "normalizeDatasetReference",
      "normalizeDatasetSchemaSummary",
    ]);
  });
});
