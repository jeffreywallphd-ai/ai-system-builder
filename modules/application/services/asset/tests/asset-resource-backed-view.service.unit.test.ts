import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { BUILT_IN_ASSET_DEFINITION_IDS } from "../built-ins";
import { AssetResourceBackedViewService } from "../asset-resource-backed-view.service";
import type { AssetExternalRepositoryObjectReference } from "../../../../contracts/asset";
import type { ArtifactDescriptor } from "../../../../contracts/artifact";
import type { DatasetDescriptor } from "../../../../contracts/dataset";
import type { ImageAsset } from "../../../../contracts/image";
import type { ImageGenerationOutput } from "../../../../contracts/image-generation";
import type { ModelInventoryRecord } from "../../../../contracts/model";

const service = new AssetResourceBackedViewService();

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

function assertJsonCompatible(value: unknown): void {
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(value)));
}

test("artifact descriptor maps to artifact data-source view using builtin.artifact", () => {
  const descriptor: ArtifactDescriptor = {
    key: "uploads/source-image.png",
    kind: "raw-staged",
    id: "artifact-123",
    name: "Source image",
    format: { mediaType: "image/png", extension: "png" },
    metadata: { label: "safe" },
  };

  const view = service.fromArtifactDescriptor(descriptor);

  assert.equal(view.viewKind, "artifact");
  assert.equal(view.assetType, "data-source");
  assert.equal(view.assetFamily, "resource-backed");
  assert.equal(view.assetDefinitionRef?.id, "builtin.artifact");
  assert.equal(view.resourceBacking?.resourceKind, "artifact");
  assert.equal(view.viewId.includes("uploads/source-image.png"), false);
  assert.equal(view.diagnostics?.some((item) => item.code === "artifact-not-assumed-document"), true);
  assertJsonCompatible(view);
});

test("document-like artifact maps to document view using builtin.document", () => {
  const descriptor: ArtifactDescriptor = {
    key: "uploads/requirements.pdf",
    kind: "raw-staged",
    id: "artifact-doc-1",
    name: "Requirements",
    format: { mediaType: "application/pdf", extension: "pdf" },
  };

  const view = service.fromArtifactDescriptor(descriptor);

  assert.equal(view.viewKind, "document");
  assert.equal(view.assetType, "document");
  assert.equal(view.assetDefinitionRef?.id, "builtin.document");
  assert.equal(serialized(view).includes("OCR"), false);
});

test("ambiguous artifact remains artifact, not document", () => {
  const view = service.fromArtifactDescriptor({
    key: "uploads/blob.bin",
    kind: "raw-staged",
    id: "artifact-ambiguous",
    name: "Blob",
    format: { mediaType: "application/octet-stream", extension: "bin" },
  });

  assert.equal(view.viewKind, "artifact");
  assert.equal(view.assetDefinitionRef?.id, "builtin.artifact");
});

test("finalized image asset maps to resource-backed image view", () => {
  const image: ImageAsset = {
    assetId: "image-1",
    artifactId: "artifact-1",
    source: "generated",
    metadata: {
      requestId: "request-1",
      originalFileName: "image.png",
      prompt: "safe prompt metadata is omitted from view metadata",
      seed: 42,
      engine: "comfyui",
      width: 512,
      height: 512,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };

  const view = service.fromImageAsset(image);

  assert.equal(view.viewKind, "image-asset");
  assert.equal(view.assetType, "image");
  assert.equal(view.assetDefinitionRef?.id, "builtin.resource-backed-image");
  assert.equal(view.resourceBackedAsset?.assetRef.kind, "resource-backed-asset");
  assert.equal(view.resourceBacking?.resourceKind, "image");
});

test("generated image output maps to generated-output view and is not a finalized image asset", () => {
  const output: ImageGenerationOutput = {
    type: "image",
    engine: "comfyui",
    fileName: "draft.png",
    contentBase64: "raw-bytes-must-not-map",
    mediaType: "image/png",
    promptId: "prompt-1",
    width: 512,
    height: 512,
  };

  const view = service.fromGeneratedImageOutput(output, "output-1");

  assert.equal(view.viewKind, "generated-output");
  assert.equal(view.assetDefinitionRef, undefined);
  assert.equal(view.assetType, undefined);
  assert.equal(view.generatedOutput?.producedAssetType, "image");
  assert.equal(view.resourceBacking?.resourceKind, "generated-output");
  assert.equal(serialized(view).includes("builtin.resource-backed-image"), false);
  assert.equal(serialized(view).includes("raw-bytes-must-not-map"), false);
  assert.equal(view.diagnostics?.some((item) => item.code === "generated-output-not-finalized"), true);
});

test("dataset descriptor maps to dataset view", () => {
  const descriptor: DatasetDescriptor = {
    id: "dataset-1",
    name: "Training dataset",
    sourceArtifacts: [{ key: "uploads/a.png" }],
    transforms: [{ definitionId: "resize" }],
    materializations: [{ artifactKey: "datasets/train.parquet", format: "parquet", rowCount: 10 }],
    metadata: { split: "train" },
  };

  const view = service.fromDatasetDescriptor(descriptor);

  assert.equal(view.viewKind, "dataset");
  assert.equal(view.assetDefinitionRef?.id, "builtin.dataset");
  assert.equal((view.metadata as Record<string, unknown>).sourceArtifactCount, 1);
  assert.equal(view.resourceBacking?.resourceKind, "dataset");
});

test("model inventory record maps to model view without local paths", () => {
  const record: ModelInventoryRecord = {
    modelRecordId: "model-record-1",
    displayName: "Adapter model",
    source: "generated",
    lifecycleStatus: "validated",
    artifactForm: "adapter",
    provider: "unknown",
    modelId: "model-1",
    localPath: "/tmp/model.safetensors",
    validationReportPath: "/tmp/report.json",
    createdAt: "2026-01-01T00:00:00.000Z",
    taskTags: ["text-to-image"],
    backingArtifactIds: ["artifact-1"],
    primaryArtifactId: "artifact-1",
    validationStatus: "valid",
    metadata: { note: "safe", safeButPathValue: "/tmp/cache/model" },
  };

  const view = service.fromModelInventoryRecord(record);
  const json = serialized(view);

  assert.equal(view.viewKind, "model");
  assert.equal(view.assetDefinitionRef?.id, "builtin.model");
  assert.equal(view.lifecycleStatus, "validated");
  assert.equal(view.validationSummary?.status, "valid");
  assert.equal(json.includes("/tmp/model.safetensors"), false);
  assert.equal(json.includes("/tmp/report.json"), false);
  assert.equal(json.includes("/tmp/cache/model"), false);
});

test("external repository object maps without using provider path as canonical view id", () => {
  const external: AssetExternalRepositoryObjectReference = {
    provider: "github",
    repositoryId: "org/repo",
    revision: "main",
    objectPath: "artifacts/model.safetensors",
    objectKind: "file",
    contentType: "application/octet-stream",
  };

  const view = service.fromExternalRepositoryObject(external);

  assert.equal(view.viewKind, "external-repository-object");
  assert.equal(view.assetDefinitionRef, undefined);
  assert.equal(view.resourceBacking?.resourceKind, "external-repository-object");
  assert.equal(view.viewId.includes("artifacts/model.safetensors"), false);
  assert.equal(view.viewId.includes("org/repo"), false);
  assert.equal(view.diagnostics?.some((item) => item.code === "external-object-not-registered"), true);
});

test("Hugging Face-like repo object is not treated as a registered asset by default", () => {
  const view = service.fromArtifactRepoTarget({
    provider: "huggingface",
    repository: "org/model",
    revision: "main",
    path: "README.md",
  });

  assert.equal(view.viewKind, "external-repository-object");
  assert.equal(view.assetType, undefined);
  assert.equal(view.resourceBackedAsset, undefined);
  assert.equal(serialized(view).includes("builtin.model"), false);
});

test("preview maps to preview view and not a standalone asset", () => {
  const view = service.fromPreview({
    previewId: "preview-1",
    previewKind: "metadata-summary",
    summary: "Metadata only.",
    metadata: { rowCount: 5 },
  });

  assert.equal(view.viewKind, "preview");
  assert.equal(view.assetDefinitionRef, undefined);
  assert.equal(view.assetType, undefined);
  assert.equal(view.preview?.previewKind, "metadata-summary");
  assert.equal(view.diagnostics?.some((item) => item.code === "preview-not-standalone-asset"), true);
});

test("unsafe metadata keys and values are omitted or sanitized", () => {
  const view = service.fromDatasetDescriptor({
    id: "dataset-unsafe",
    name: "Unsafe dataset",
    metadata: {
      safe: "kept",
      token: "secret-token",
      nested: { authorization: "Bearer secret", value: "ok" },
      safeButPathValue: "/tmp/private.csv",
      contentBase64: "aGVsbG8=",
    },
  });
  const json = serialized(view);

  assert.equal(json.includes("secret-token"), false);
  assert.equal(json.includes("Bearer secret"), false);
  assert.equal(json.includes("/tmp/private.csv"), false);
  assert.equal(json.includes("contentBase64"), false);
  assert.equal(json.includes("kept"), true);
});

test("raw bytes, blobs, local paths, tokens, commands, stacks, and payloads are not present in serialized views", () => {
  const view = service.fromExternalRepositoryObject({
    provider: "local",
    repositoryId: "local-repo",
    objectPath: "/tmp/private/model.safetensors",
    objectKind: "file",
    metadata: {
      bytes: "bytes",
      blob: "blob",
      rawPayload: "raw payload",
      commandLine: "python train.py --token x",
      stackTrace: "Error: stack",
      token: "hf_secret",
      safeButPathValue: "C:\\Users\\name\\secret.bin",
    },
  });
  const json = serialized(view);

  for (const unsafe of ["bytes", "blob", "raw payload", "python train.py", "Error: stack", "hf_secret", "/tmp/private", "C:\\Users\\name"]) {
    assert.equal(json.includes(unsafe), false, unsafe);
  }
});

test("service imports no forbidden outer layers, transports, runtime adapters, filesystem, network, or Hugging Face clients", () => {
  const source = readFileSync("modules/application/services/asset/asset-resource-backed-view.service.ts", "utf8");
  for (const forbidden of [
    "modules/adapters",
    "../../../adapters",
    "modules/hosts",
    "../../../hosts",
    "contracts/api",
    "contracts/ipc",
    "electron",
    "express",
    "preload",
    "renderer",
    "thin-client",
    "node:fs",
    "node:path",
    "fetch(",
    "runtimeTaskRegistry",
    "RuntimeTaskRegistry",
    "runtimeReadiness",
    "RuntimeReadiness",
    "HuggingFace",
    "huggingface/",
    "runtime/python",
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected forbidden boundary: ${forbidden}`);
  }
});

test("no runtime readiness or runtime task registry calls occur", () => {
  const source = readFileSync("modules/application/services/asset/asset-resource-backed-view.service.ts", "utf8");
  assert.equal(/readiness|taskRegistry|supervisor|execute|spawn|probe/i.test(source), false);
});

test("all built-in definition IDs referenced by the service exist in the built-in catalog", () => {
  const source = readFileSync("modules/application/services/asset/asset-resource-backed-view.service.ts", "utf8");
  const referenced = [...source.matchAll(/builtin\.[a-z-]+/g)].map((match) => match[0]);
  for (const id of new Set(referenced)) {
    assert.equal(BUILT_IN_ASSET_DEFINITION_IDS.includes(id as never), true, id);
  }
});

test("view service imports centralized sanitizer without a second local forbidden-key regex", () => {
  const source = readFileSync("modules/application/services/asset/asset-resource-backed-view.service.ts", "utf8");
  assert.equal(source.includes("FORBIDDEN_METADATA_KEY_PATTERN"), false);
  assert.equal(source.includes("sanitizeAssetMetadata"), true);
});
