import { describe, expect, it } from "../../testing/node-test";

import {
  normalizeTransformExecutionSummary,
  normalizeTransformKind,
} from ".";

describe("transform contracts", () => {
  it("normalizes transform kind and stage vocabulary", () => {
    expect(normalizeTransformKind(" Parsing ")).toBe("parsing");
  });

  it("normalizes transform summaries with input/output artifact references", () => {
    const summary = normalizeTransformExecutionSummary({
      record: {
        specification: {
          definitionId: " parse-json-lines ",
          kind: " parsing ",
          stage: " derivation ",
        },
        inputs: [{ key: " staging/raw/events.ndjson " }],
        outputs: [{ key: " derived/structured/events.parquet " }],
      },
      inputCount: 1,
      outputCount: 1,
    });

    expect(summary).toEqual({
      record: {
        executionId: undefined,
        specification: {
          definitionId: "parse-json-lines",
          kind: "parsing",
          stage: "derivation",
          name: undefined,
          version: undefined,
        },
        inputs: [{ key: "staging/raw/events.ndjson", label: undefined }],
        outputs: [{ key: "derived/structured/events.parquet", label: undefined }],
        startedAt: undefined,
        completedAt: undefined,
      },
      inputCount: 1,
      outputCount: 1,
    });
  });
});
