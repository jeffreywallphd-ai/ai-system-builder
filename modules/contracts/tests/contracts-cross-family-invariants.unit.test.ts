import { describe, expect, expectTypeOf, it } from "../../testing/node-test";

import { createApiRequest } from "../api";
import type { ContractBoundaryContext } from "../shared";
import {
  normalizeArtifactBrowseSuccessValue,
  normalizeArtifactContentReadSuccessValue,
  normalizeArtifactReadSuccessValue,
} from "../artifact-browser";
import {
  createIpcChannel,
  createIpcRequest,
  parseIpcChannelValue,
} from "../ipc";
import {
  LOG_LEVELS,
  LOG_VERBOSITIES,
  resolveLogVerbosity,
} from "../logging";
import {
  createPersistenceOperationForRecord,
  createPersistenceRecordReference,
  createPersistenceSuccessResult,
  normalizePersistenceOperation,
} from "../persistence";
import {
  createRuntimeExecutionDiagnostic,
  mapRuntimeDiagnosticToStructuredLogEvent,
  normalizeRuntimeOperation,
} from "../runtime";
import {
  createStoreArtifactRequest,
  createStoreArtifactSuccessResult,
  createStoreArtifactInRepoRequest,
  normalizeStorageArtifactKey,
  normalizeStorageKind,
  normalizeStorageBackingReference,
} from "../storage";
import { createStagedArtifactDescriptorFromStorageObjectDescriptor } from "../ingestion";
import { normalizeTransformRecord } from "../transform";
import { normalizeDatasetDescriptor } from "../dataset";
import { normalizeLineageRecord } from "../lineage";
import {
  createTransportOperation,
  createTransportRequest,
  normalizeTransportOperation,
} from "../transport";

describe("contracts cross-family invariants", () => {
  it("keeps operation identity normalization aligned across transport, runtime, and persistence", () => {
    const rawOperation = " Workspace.Create ";

    const transportOperation = normalizeTransportOperation(rawOperation);
    const runtimeOperation = normalizeRuntimeOperation(rawOperation);
    const persistenceOperation = normalizePersistenceOperation(rawOperation);

    expect(transportOperation).toBe("workspace.create");
    expect(runtimeOperation).toBe("workspace.create");
    expect(persistenceOperation).toBe("workspace.create");
    expect(createTransportOperation("workspace", "create")).toBe(transportOperation);
  });

  it("keeps api and ipc request envelopes as transport specializations, not parallel systems", () => {
    const operation = createTransportOperation("workspace", "create");
    const payload = { name: "alpha" };
    const options = {
      requestId: "req-801",
      correlationId: "corr-801",
      metadata: { source: "contracts-invariant-test" },
    };

    const transportRequest = createTransportRequest(operation, payload, options);
    const apiRequest = createApiRequest(operation, payload, options);
    const ipcChannel = createIpcChannel(operation, "request");
    const ipcRequest = createIpcRequest(ipcChannel, payload, options);
    const parsedChannel = parseIpcChannelValue(ipcChannel.value);

    expect(apiRequest).toEqual(transportRequest);
    expect(ipcRequest).toEqual({
      ...transportRequest,
      channel: "ipc.workspace.create.request",
    });
    expect(parsedChannel).toEqual({
      operation,
      kind: "request",
      value: "ipc.workspace.create.request",
    });
  });

  it("keeps runtime diagnostics as runtime.* events that map directly into shared logging contracts", () => {
    const runtimeDiagnostic = createRuntimeExecutionDiagnostic({
      timestamp: "2026-04-14T12:00:00.000Z",
      level: "info",
      verbosity: resolveLogVerbosity(" VERBOSE "),
      event: " Runtime.Execution.Completed ",
      message: "Runtime execution completed",
      component: "runtime-adapter",
      operation: "workspace.create",
      outcome: "success",
    });

    const structuredLogEvent = mapRuntimeDiagnosticToStructuredLogEvent(
      runtimeDiagnostic,
      {
        host: "server",
        requestId: "req-802",
        correlationId: "corr-802",
      },
    );

    expect(runtimeDiagnostic.event).toBe("runtime.execution.completed");
    expect(LOG_LEVELS).toContain(structuredLogEvent.level);
    expect(LOG_VERBOSITIES).toContain(structuredLogEvent.verbosity);
    expect(structuredLogEvent).toMatchObject({
      event: "runtime.execution.completed",
      operation: "workspace.create",
      requestId: "req-802",
      correlationId: "corr-802",
      host: "server",
    });
  });

  it("keeps repo-storage request contracts payload-only while context flows at application boundaries", () => {
    expectTypeOf<ReturnType<typeof createStoreArtifactInRepoRequest>>().not.toExtend<ContractBoundaryContext>();

    const repoRequest = createStoreArtifactInRepoRequest(new Uint8Array([1]), {
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "images/a.png",
      },
    });

    expect("requestId" in repoRequest).toBe(false);
    expect("correlationId" in repoRequest).toBe(false);
  });

  it("keeps persistence record semantics distinct from storage key semantics", () => {
    const persistenceOperation = createPersistenceOperationForRecord(
      "workspace",
      "update",
    );
    const record = createPersistenceRecordReference("workspace", "ws-42");
    const persistenceResult = createPersistenceSuccessResult(
      persistenceOperation,
      {
        updated: true,
      },
      {
        record,
      },
    );

    const storageKey = normalizeStorageArtifactKey(
      " workspace/ws-42/snapshots/state.json ",
    );
    const storageRequest = createStoreArtifactRequest(
      new Uint8Array([1, 2, 3]),
      {
        descriptor: {
          key: storageKey,
        },
      },
    );

    expect(persistenceResult).toMatchObject({
      operation: "workspace.update",
      record: {
        recordType: "workspace",
        id: "ws-42",
      },
    });
    expect("descriptor" in persistenceResult).toBe(false);
    expect(storageRequest).toMatchObject({
      descriptor: {
        key: "workspace/ws-42/snapshots/state.json",
      },
    });
    expect("operation" in storageRequest).toBe(false);
    expect("record" in storageRequest).toBe(false);
  });

  it("keeps ingestion staged-artifact descriptors aligned to storage descriptors without transport coupling", () => {
    const storageRequest = createStoreArtifactRequest(
      new Uint8Array([1, 2, 3]),
      {
        descriptor: {
          key: " staging/uploads/image-9 ",
          mediaType: "image/png",
          sizeBytes: 3,
        },
      },
    );

    const stagedDescriptor = createStagedArtifactDescriptorFromStorageObjectDescriptor(
      {
        key: storageRequest.descriptor.key ?? "staging/uploads/image-9",
        mediaType: storageRequest.descriptor.mediaType,
        sizeBytes: storageRequest.descriptor.sizeBytes,
      },
      {
        sourceKind: "upload",
        originalName: "image-9.png",
      },
    );

    expect(stagedDescriptor).toMatchObject({
      sourceKind: "upload",
      originalName: "image-9.png",
      storage: {
        key: "staging/uploads/image-9",
        mediaType: "image/png",
        sizeBytes: 3,
      },
    });
    expect("operation" in stagedDescriptor).toBe(false);
    expect("channel" in stagedDescriptor).toBe(false);
  });

  it("keeps artifact-browser read models aligned to storage and ingestion semantics without becoming filesystem browsing", () => {
    const stored = createStoreArtifactSuccessResult({
      key: " staged/images/image-33 ",
      mediaType: "image/png",
      sizeBytes: 3,
    });
    const stagedDescriptor = createStagedArtifactDescriptorFromStorageObjectDescriptor(
      stored.value,
      {
        sourceKind: "upload",
        originalName: "image-33.png",
      },
    );

    const browse = normalizeArtifactBrowseSuccessValue({
      items: [
        {
          artifactId: stagedDescriptor.storage.key,
          storageKey: stagedDescriptor.storage.key,
          artifactFamily: "image",
          mediaType: stagedDescriptor.storage.mediaType,
          sizeBytes: stagedDescriptor.storage.sizeBytes,
          sourceKind: stagedDescriptor.sourceKind,
          originalName: stagedDescriptor.originalName,
        },
      ],
    });
    const detail = normalizeArtifactReadSuccessValue({
      artifact: {
        locator: {
          storageKey: stagedDescriptor.storage.key,
        },
        artifactFamily: "image",
        mediaType: stagedDescriptor.storage.mediaType,
        sizeBytes: stagedDescriptor.storage.sizeBytes,
        sourceKind: stagedDescriptor.sourceKind,
      },
    });
    const content = normalizeArtifactContentReadSuccessValue({
      content: {
        locator: {
          storageKey: stagedDescriptor.storage.key,
        },
        mediaType: stagedDescriptor.storage.mediaType,
        sizeBytes: stagedDescriptor.storage.sizeBytes,
        availability: "available",
        retrieval: "inline",
      },
    });

    expect(browse.items[0].storageKey).toBe("staged/images/image-33");
    expect(detail.artifact.locator.storageKey).toBe("staged/images/image-33");
    expect(content.content.locator.storageKey).toBe("staged/images/image-33");
    expect("path" in browse.items[0]).toBe(false);
    expect("path" in detail.artifact.locator).toBe(false);
    expect("content" in browse.items[0]).toBe(false);
    expect("content" in detail.artifact).toBe(false);
    expect("bytes" in content.content).toBe(false);
    expect(content.content).toMatchObject({
      mediaType: "image/png",
      sizeBytes: 3,
      availability: "available",
      retrieval: "inline",
    });
  });

  it("keeps transform, dataset, and lineage contracts aligned around typed references", () => {
    const transformRecord = normalizeTransformRecord({
      specification: {
        definitionId: " normalize-orders ",
        kind: " normalizatioN ",
        stage: " derivation ",
      },
      inputs: [{ key: " staging/orders/raw.jsonl " }],
      outputs: [{ key: " derived/orders/normalized.parquet " }],
    });

    const datasetDescriptor = normalizeDatasetDescriptor({
      id: "orders.v1",
      sourceArtifacts: transformRecord.outputs,
      transforms: [{ definitionId: transformRecord.specification.definitionId }],
      materializations: [
        {
          artifactKey: " dataset/orders/orders.v1.parquet ",
          format: " parquet ",
        },
      ],
    });

    const lineage = normalizeLineageRecord({
      nodes: [
        { id: transformRecord.outputs[0].key, kind: "artifact" },
        { id: transformRecord.specification.definitionId, kind: "transform" },
        { id: datasetDescriptor.id, kind: "dataset" },
      ],
      edges: [
        {
          kind: "derived-from",
          from: { id: transformRecord.inputs[0].key, kind: "artifact" },
          to: { id: transformRecord.outputs[0].key, kind: "artifact" },
        },
        {
          kind: "produced",
          from: { id: transformRecord.specification.definitionId, kind: "transform" },
          to: { id: datasetDescriptor.id, kind: "dataset" },
        },
      ],
    });

    expect(transformRecord.outputs[0].key).toBe("derived/orders/normalized.parquet");
    expect(datasetDescriptor.sourceArtifacts).toEqual([
      { key: "derived/orders/normalized.parquet", label: undefined },
    ]);
    expect(lineage.edges[1]).toMatchObject({
      kind: "produced",
      from: { id: "normalize-orders", kind: "transform" },
      to: { id: "orders.v1", kind: "dataset" },
    });
  });

  it("keeps shared storage foundation thin across object and repo families", () => {
    const objectKind = normalizeStorageKind("artifact-object");
    const repoKind = normalizeStorageKind("artifact-repo");

    const objectBacking = normalizeStorageBackingReference({
      kind: objectKind,
      provider: "local-filesystem",
      locator: "workspace/ws-42/snapshots/state.json",
    });
    const repoRequest = createStoreArtifactInRepoRequest(new Uint8Array([1]), {
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "state.json",
      },
    });

    expect(objectBacking.kind).toBe("artifact-object");
    expect(repoKind).toBe("artifact-repo");
    expect("repository" in objectBacking).toBe(false);
    expect("key" in repoRequest.target).toBe(false);
  });

});
