import { describe, it, expect } from "../../../../testing/node-test";
import { getDatasetPreparationMemoryFailureMessage } from "../datasetPreparationMemoryMessage";

describe("memory admission notification copy", () => {
  it("rounds upward and subtracts already permitted overflow", () => {
    const message = getDatasetPreparationMemoryFailureMessage({ resource: "ram", requiredBytes: 5 * 1024 ** 3, availableBytes: 3.25 * 1024 ** 3 - 1, allowedOverflowBytes: 1024 ** 3 });
    expect(message).toContain("Free at least 769 MiB of RAM");
    expect(message).toContain("available memory can change");
  });
  it("names GPU and combined memory accurately", () => {
    const value = { requiredBytes: 1024 ** 3, availableBytes: 0, allowedOverflowBytes: 0 };
    expect(getDatasetPreparationMemoryFailureMessage({ ...value, resource: "vram" })).toContain("1024 MiB of GPU memory (VRAM)");
    expect(getDatasetPreparationMemoryFailureMessage({ ...value, resource: "combined" })).toContain("combined RAM/GPU memory");
  });
  it("never renders private fields or invents a measurement", () => {
    const message = getDatasetPreparationMemoryFailureMessage({ resource: "ram", requiredBytes: "secret-fixture", path: "private-fixture" });
    expect(message).not.toContain("private"); expect(message).not.toContain("secret"); expect(message).not.toContain("MiB");
    expect(message).toContain("smaller");
  });
});
