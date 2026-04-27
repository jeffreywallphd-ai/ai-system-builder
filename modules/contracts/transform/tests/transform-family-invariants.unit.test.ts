import { describe, expect, it } from "../../../testing/node-test";

import * as transformContracts from "..";

describe("transform family invariants", () => {
  it("exports only transform-family surfaces from the family barrel", () => {
    expect(Object.keys(transformContracts).sort()).toEqual([
      "TRANSFORM_KINDS",
      "TRANSFORM_STAGES",
      "isTransformKind",
      "isTransformStage",
      "normalizeTransformExecutionSummary",
      "normalizeTransformKind",
      "normalizeTransformRecord",
      "normalizeTransformReference",
      "normalizeTransformSpecification",
      "normalizeTransformStage",
    ]);
  });
});
