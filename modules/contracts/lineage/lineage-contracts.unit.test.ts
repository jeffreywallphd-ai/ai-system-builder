import { describe, expect, it } from "../../testing/node-test";

import { normalizeLineageRecord } from ".";

describe("lineage contracts", () => {
  it("normalizes lineage records for artifact-transform-dataset links", () => {
    const lineage = normalizeLineageRecord({
      nodes: [
        { id: " staged:orders ", kind: " artifact " },
        { id: " transform:normalize-orders ", kind: " transform " },
        { id: " dataset:orders-v1 ", kind: " dataset " },
      ],
      edges: [
        {
          kind: " transformed-by ",
          from: { id: " staged:orders ", kind: " artifact " },
          to: { id: " transform:normalize-orders ", kind: " transform " },
        },
        {
          kind: " produced ",
          from: { id: " transform:normalize-orders ", kind: " transform " },
          to: { id: " dataset:orders-v1 ", kind: " dataset " },
        },
      ],
    });

    expect(lineage).toEqual({
      nodes: [
        { id: "staged:orders", kind: "artifact", label: undefined },
        { id: "transform:normalize-orders", kind: "transform", label: undefined },
        { id: "dataset:orders-v1", kind: "dataset", label: undefined },
      ],
      edges: [
        {
          kind: "transformed-by",
          from: { id: "staged:orders", kind: "artifact", label: undefined },
          to: { id: "transform:normalize-orders", kind: "transform", label: undefined },
          recordedAt: undefined,
        },
        {
          kind: "produced",
          from: { id: "transform:normalize-orders", kind: "transform", label: undefined },
          to: { id: "dataset:orders-v1", kind: "dataset", label: undefined },
          recordedAt: undefined,
        },
      ],
    });
  });
});
