import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeConstrainedJsonDecodingPreference,
  normalizeDatasetPreparationGenerationCapacitySnapshot,
  resolveDatasetPreparationGenerationModelEstimatedBytes,
  resolveDatasetPreparationConstrainedJson,
  type DatasetPreparationGenerationCapacitySnapshot,
} from "../dataset-preparation-constrained-json";

const GIBIBYTE = 1024 ** 3;
const NOW = "2026-07-30T20:00:00.000Z";

const capacity = (
  overrides: Partial<DatasetPreparationGenerationCapacitySnapshot> = {},
): DatasetPreparationGenerationCapacitySnapshot => ({
  schemaVersion: "1",
  capturedAt: NOW,
  decoderAvailable: true,
  schemaSupported: true,
  logicalProcessorCount: 12,
  totalSystemMemoryBytes: 32 * GIBIBYTE,
  totalAcceleratorMemoryBytes: 16 * GIBIBYTE,
  ...overrides,
});

describe("dataset preparation constrained JSON recommendation", () => {
  it("uses conservative estimates only for known built-in generation models", () => {
    assert.equal(
      resolveDatasetPreparationGenerationModelEstimatedBytes(
        "Qwen/Qwen2.5-7B-Instruct",
      ),
      15 * 1024 ** 3,
    );
    assert.equal(
      resolveDatasetPreparationGenerationModelEstimatedBytes(
        "Qwen/Qwen2.5-3B-Instruct",
      ),
      7 * 1024 ** 3,
    );
    assert.equal(
      resolveDatasetPreparationGenerationModelEstimatedBytes(
        "another/model",
      ),
      undefined,
    );
  });
  it("checks an untouched preference on a sufficient accelerator profile", () => {
    const resolution = resolveDatasetPreparationConstrainedJson({
      selectedDevice: "auto",
      estimatedModelBytes: 8 * GIBIBYTE,
      capacity: capacity(),
      now: NOW,
    });

    assert.deepEqual(resolution, {
      enabled: true,
      source: "adaptive",
      recommended: true,
      recommendationReason: "recommended-cuda",
    });
  });

  it("uses stable CPU capacity and a processor floor for CPU-only profiles", () => {
    const sufficient = resolveDatasetPreparationConstrainedJson({
      selectedDevice: "cpu",
      estimatedModelBytes: 8 * GIBIBYTE,
      capacity: capacity({ totalAcceleratorMemoryBytes: undefined }),
      now: NOW,
    });
    const constrained = resolveDatasetPreparationConstrainedJson({
      selectedDevice: "cpu",
      estimatedModelBytes: 8 * GIBIBYTE,
      capacity: capacity({
        totalAcceleratorMemoryBytes: undefined,
        logicalProcessorCount: 4,
      }),
      now: NOW,
    });

    assert.equal(sufficient.enabled, true);
    assert.equal(sufficient.recommendationReason, "recommended-cpu");
    assert.equal(constrained.enabled, false);
    assert.equal(constrained.recommendationReason, "capacity-insufficient");
  });

  it("fails safe for missing, stale, unsupported, and incomplete facts", () => {
    const cases = [
      {
        capacity: undefined,
        reason: "snapshot-missing",
      },
      {
        capacity: capacity({ capturedAt: "2026-07-30T19:00:00.000Z" }),
        reason: "snapshot-stale",
      },
      {
        capacity: capacity({ decoderAvailable: false }),
        reason: "decoder-unavailable",
      },
      {
        capacity: capacity({ schemaSupported: false }),
        reason: "schema-unsupported",
      },
    ] as const;

    for (const item of cases) {
      const resolution = resolveDatasetPreparationConstrainedJson({
        selectedDevice: "auto",
        estimatedModelBytes: 8 * GIBIBYTE,
        capacity: item.capacity,
        now: NOW,
      });
      assert.equal(resolution.enabled, false);
      assert.equal(resolution.recommendationReason, item.reason);
    }
  });

  it("preserves an explicit user choice even when it differs from the recommendation", () => {
    const explicitOff = resolveDatasetPreparationConstrainedJson({
      preference: false,
      selectedDevice: "auto",
      estimatedModelBytes: 8 * GIBIBYTE,
      capacity: capacity(),
      now: NOW,
    });
    const explicitOn = resolveDatasetPreparationConstrainedJson({
      preference: true,
      selectedDevice: "cpu",
      estimatedModelBytes: 8 * GIBIBYTE,
      capacity: capacity({ decoderAvailable: false }),
      now: NOW,
    });

    assert.equal(explicitOff.enabled, false);
    assert.equal(explicitOff.source, "explicit");
    assert.equal(explicitOff.recommended, true);
    assert.equal(explicitOn.enabled, true);
    assert.equal(explicitOn.source, "explicit");
    assert.equal(explicitOn.recommended, false);
  });

  it("normalizes bounded non-identifying capacity facts and rejects invalid preferences", () => {
    assert.deepEqual(
      normalizeDatasetPreparationGenerationCapacitySnapshot({
        schemaVersion: "1",
        capturedAt: NOW,
        decoderAvailable: true,
        schemaSupported: true,
        logicalProcessorCount: 8,
        totalSystemMemoryBytes: 16 * GIBIBYTE,
        hardwareName: "must-not-cross-the-boundary",
      }),
      {
        schemaVersion: "1",
        capturedAt: NOW,
        decoderAvailable: true,
        schemaSupported: true,
        logicalProcessorCount: 8,
        totalSystemMemoryBytes: 16 * GIBIBYTE,
      },
    );
    assert.equal(
      normalizeDatasetPreparationGenerationCapacitySnapshot({
        schemaVersion: "1",
        capturedAt: "invalid",
        decoderAvailable: true,
        schemaSupported: true,
      }),
      undefined,
    );
    assert.equal(normalizeConstrainedJsonDecodingPreference(undefined), undefined);
    assert.equal(normalizeConstrainedJsonDecodingPreference(false), false);
    assert.throws(() => normalizeConstrainedJsonDecodingPreference("yes"));
  });
});
