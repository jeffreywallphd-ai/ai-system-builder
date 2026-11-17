import { describe, it, expect } from "../../../testing/node-test";
import { normalizeDatasetPreparationMemoryShortfall } from "..";

describe("public model memory shortfalls", () => {
  const value = { resource: "ram", requiredBytes: 3.5 * 1024 ** 3, availableBytes: 3.25 * 1024 ** 3, allowedOverflowBytes: 0 };
  it("keeps exact numeric facts and discards private fields", () => {
    expect(normalizeDatasetPreparationMemoryShortfall({ ...value, path: "private-fixture", raw: "hidden" })).toEqual(value);
  });
  it("denies malformed, contradictory and nonfinite facts", () => {
    for (const input of [null, [], "private", { ...value, resource: "command" },
      { ...value, requiredBytes: NaN }, { ...value, availableBytes: Infinity },
      { ...value, availableBytes: -1 }, { ...value, requiredBytes: 1.5 },
      { ...value, requiredBytes: 1024 ** 5 + 1 }, { ...value, availableBytes: true },
      { ...value, allowedOverflowBytes: 1024 ** 3 },
      { ...value, resource: "vram", allowedOverflowBytes: 1 }]) {
      expect(normalizeDatasetPreparationMemoryShortfall(input)).toBeUndefined();
    }
  });
});
