import { describe, expect, it } from "../../testing/node-test";

import { normalizeDatasetDescriptor } from ".";

describe("dataset contracts", () => {
  it("normalizes dataset descriptors and materialization references", () => {
    const descriptor = normalizeDatasetDescriptor({
      id: " orders.curated.v1 ",
      name: " Orders Curated ",
      sourceArtifacts: [{ key: " derived/orders/normalized.parquet " }],
      transforms: [{ definitionId: " normalize-orders " }],
      schema: {
        fields: [
          {
            name: " order_id ",
            type: " string ",
          },
        ],
      },
      materializations: [
        {
          artifactKey: " dataset/orders/curated-v1.parquet ",
          format: " parquet ",
        },
      ],
    });

    expect(descriptor).toMatchObject({
      id: "orders.curated.v1",
      name: "Orders Curated",
      sourceArtifacts: [{ key: "derived/orders/normalized.parquet", label: undefined }],
      transforms: [{ definitionId: "normalize-orders", executionId: undefined }],
      schema: {
        fieldCount: undefined,
        fields: [
          {
            name: "order_id",
            type: "string",
          },
        ],
      },
      materializations: [
        {
          artifactKey: "dataset/orders/curated-v1.parquet",
          format: "parquet",
          rowCount: undefined,
          materializedAt: undefined,
        },
      ],
      createdAt: undefined,
    });
  });
});
