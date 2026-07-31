import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeConstrainedJsonDecodingPreference,
  normalizeDatasetPreparationGenerationCapacitySnapshot,
  resolveDatasetPreparationGenerationModelCapacity,
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
      5.75 * 1024 ** 3,
    );
    assert.equal(
      resolveDatasetPreparationGenerationModelEstimatedBytes(
        "Qwen/Qwen2.5-1.5B-Instruct",
      ),
      3 * 1024 ** 3,
    );
    assert.equal(
      resolveDatasetPreparationGenerationModelEstimatedBytes("another/model"),
      undefined,
    );
  });

  it("uses current available desktop memory to choose below 3B when needed", () => {
    const busyMachine = capacity({
      totalSystemMemoryBytes: 16 * GIBIBYTE,
      availableSystemMemoryBytes: 5 * GIBIBYTE,
      totalAcceleratorMemoryBytes: undefined,
    });

    assert.equal(
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: "auto",
        estimatedModelBytes: 5.75 * GIBIBYTE,
        capacity: busyMachine,
      }).reason,
      "capacity-insufficient",
    );
    assert.equal(
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: "auto",
        estimatedModelBytes: 3 * GIBIBYTE,
        capacity: busyMachine,
      }).reason,
      "capacity-sufficient-cpu",
    );
  });

  it("marks 7B insufficient but allows the next 3B preset on a 16 GiB CPU-only machine", () => {
    const constrainedMachine = capacity({
      totalSystemMemoryBytes: 16 * GIBIBYTE,
      totalAcceleratorMemoryBytes: undefined,
    });

    assert.equal(
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: "auto",
        estimatedModelBytes: 15 * GIBIBYTE,
        capacity: constrainedMachine,
      }).reason,
      "capacity-insufficient",
    );
    assert.equal(
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: "auto",
        estimatedModelBytes: 5.75 * GIBIBYTE,
        capacity: constrainedMachine,
      }).reason,
      "capacity-sufficient-cpu",
    );
  });

  it("permits only the selected bounded CPU memory overflow", () => {
    const moderatelyBusyMachine = capacity({
      totalSystemMemoryBytes: 16 * GIBIBYTE,
      availableSystemMemoryBytes: 7.5 * GIBIBYTE,
      totalAcceleratorMemoryBytes: undefined,
    });
    const heavilyBusyMachine = capacity({
      totalSystemMemoryBytes: 16 * GIBIBYTE,
      availableSystemMemoryBytes: 5 * GIBIBYTE,
      totalAcceleratorMemoryBytes: undefined,
    });

    assert.equal(
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: "auto",
        estimatedModelBytes: 5.75 * GIBIBYTE,
        memoryOverflowPolicy: "none",
        capacity: moderatelyBusyMachine,
      }).supported,
      false,
    );
    const limited = resolveDatasetPreparationGenerationModelCapacity({
      selectedDevice: "auto",
      estimatedModelBytes: 5.75 * GIBIBYTE,
      memoryOverflowPolicy: "limited",
      capacity: moderatelyBusyMachine,
    });
    assert.equal(limited.supported, true);
    assert.equal(limited.memoryOverflowRequired, true);
    assert.equal(limited.allowedMemoryOverflowBytes, GIBIBYTE);
    assert.equal(
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: "auto",
        estimatedModelBytes: 5.75 * GIBIBYTE,
        memoryOverflowPolicy: "limited",
        capacity: heavilyBusyMachine,
      }).supported,
      false,
    );
    assert.equal(
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: "auto",
        estimatedModelBytes: 5.75 * GIBIBYTE,
        memoryOverflowPolicy: "extended",
        capacity: heavilyBusyMachine,
      }).supported,
      true,
    );
    assert.equal(
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: "cuda",
        estimatedModelBytes: 5.75 * GIBIBYTE,
        memoryOverflowPolicy: "extended",
        capacity: capacity({ totalAcceleratorMemoryBytes: GIBIBYTE }),
      }).supported,
      false,
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
        availableSystemMemoryBytes: 5 * GIBIBYTE,
        hardwareName: "must-not-cross-the-boundary",
      }),
      {
        schemaVersion: "1",
        capturedAt: NOW,
        decoderAvailable: true,
        schemaSupported: true,
        logicalProcessorCount: 8,
        totalSystemMemoryBytes: 16 * GIBIBYTE,
        availableSystemMemoryBytes: 5 * GIBIBYTE,
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
    assert.equal(
      normalizeConstrainedJsonDecodingPreference(undefined),
      undefined,
    );
    assert.equal(normalizeConstrainedJsonDecodingPreference(false), false);
    assert.throws(() => normalizeConstrainedJsonDecodingPreference("yes"));
  });
});
