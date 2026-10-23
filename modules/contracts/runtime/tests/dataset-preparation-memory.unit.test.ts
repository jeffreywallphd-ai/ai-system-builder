import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DATASET_PREPARATION_OFFLOAD_CAPABILITY,
  DATASET_PREPARATION_OFFLOAD_PROFILE,
  normalizeDatasetPreparationMemoryMode,
  resolveDatasetPreparationMemoryProfile,
  supportsDatasetPreparationOffload,
  isDatasetPreparationOffloadAvailable,
} from "../dataset-preparation-memory";

describe("explicit local-model memory profile", () => {
  it("requires current capability evidence and denies stale or future snapshots", () => {
    const now = Date.parse("2026-10-22T04:00:00Z");
    const snapshot = { schemaVersion: "1" as const, capturedAt: new Date(now).toISOString(), decoderAvailable: false, schemaSupported: true, offloadAvailable: true };
    assert.equal(isDatasetPreparationOffloadAvailable(snapshot, now), true);
    assert.equal(isDatasetPreparationOffloadAvailable({ ...snapshot, offloadAvailable: false }, now), false);
    assert.equal(isDatasetPreparationOffloadAvailable(snapshot, now + 300_001), false);
    assert.equal(isDatasetPreparationOffloadAvailable(snapshot, now - 30_001), false);
    assert.equal(isDatasetPreparationOffloadAvailable({ ...snapshot, capturedAt: "invalid" }, now), false);
  });
  it("preserves omitted and explicit standard loading without offload limits", () => {
    for (const value of [undefined, "standard"]) {
      assert.equal(normalizeDatasetPreparationMemoryMode(value), "standard");
      assert.equal(resolveDatasetPreparationMemoryProfile(value), undefined);
    }
  });

  it("resolves the exact opt-in profile to immutable finite placement limits", () => {
    const profile = resolveDatasetPreparationMemoryProfile("offload-v1");
    assert.ok(profile);
    assert.equal(profile, DATASET_PREPARATION_OFFLOAD_PROFILE);
    assert.equal(profile.maximumCpuWeightBytes, 1024 ** 3);
    assert.equal(profile.maximumAcceleratorWeightBytes, 2 * 1024 ** 3);
    assert.equal(profile.maximumOwnedStagingBytes, 12 * 1024 ** 3);
    assert.equal(Object.isFrozen(profile), true);
  });

  it("denies malformed, unknown or caller-supplied budget profiles", () => {
    for (const value of [null, "", "auto", "offload-v2", true, 1, [], { mode: "offload-v1" }, { maximumCpuWeightBytes: Infinity }]) {
      assert.throws(() => normalizeDatasetPreparationMemoryMode(value), /Unsupported/);
      assert.throws(() => resolveDatasetPreparationMemoryProfile(value), /Unsupported/);
    }
  });

  it("requires the exact advertised version rather than generic runtime readiness", () => {
    for (const capabilities of [undefined, null, {}, "dataset-preparation.offload-v1", [], ["dataset-preparation"], ["dataset-preparation.offload-v2"], ["dataset-preparation.offload-v1 "]]) {
      assert.equal(supportsDatasetPreparationOffload(capabilities), false);
    }
    assert.equal(supportsDatasetPreparationOffload(["dataset-preparation", DATASET_PREPARATION_OFFLOAD_CAPABILITY]), true);
  });
});
