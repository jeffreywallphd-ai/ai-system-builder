import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSET_EXTERNAL_REPOSITORY_OBJECT_KINDS,
  ASSET_EXTERNAL_REPOSITORY_PROVIDERS,
  ASSET_RESOURCE_BACKED_VIEW_KINDS,
  ASSET_RESOURCE_BACKING_ROLES,
  ASSET_RESOURCE_KINDS,
  ASSET_RESOURCE_PREVIEW_KINDS,
  normalizeAssetExternalRepositoryObjectKind,
  normalizeAssetExternalRepositoryProvider,
  normalizeAssetResourceBackingRole,
  normalizeAssetResourceKind,
  normalizeAssetResourcePreviewKind,
  type AssetExternalRepositoryObjectReference,
  type AssetGeneratedOutputReference,
  type AssetResourceBackedAsset,
  type AssetResourceBacking,
  type AssetResourceBackingReference,
  type AssetResourcePreviewReference,
} from "..";



test("resource-backed view contracts expose computed internal read model vocabulary", () => {
  assert.deepEqual([...ASSET_RESOURCE_BACKED_VIEW_KINDS], [
    "artifact",
    "image-asset",
    "generated-output",
    "dataset",
    "model",
    "document",
    "external-repository-object",
    "preview",
  ]);
});

test("resource-backed asset contracts expose allowed resource and backing vocabularies", () => {
  assert.deepEqual([...ASSET_RESOURCE_KINDS], [
    "artifact",
    "storage-object",
    "artifact-repository-object",
    "external-repository-object",
    "generated-output",
    "preview",
    "image",
    "dataset",
    "model",
    "document",
    "file",
    "url-reference",
    "custom",
  ]);
  assert.equal(normalizeAssetResourceKind(" Storage-Object "), "storage-object");

  assert.deepEqual([...ASSET_RESOURCE_BACKING_ROLES], [
    "primary",
    "source",
    "derived",
    "preview",
    "thumbnail",
    "materialization",
    "checkpoint",
    "adapter",
    "metadata",
    "custom",
  ]);
  assert.equal(normalizeAssetResourceBackingRole(" Thumbnail "), "thumbnail");
});

test("external repository object vocabularies are safe provider object references", () => {
  assert.deepEqual([...ASSET_EXTERNAL_REPOSITORY_PROVIDERS], [
    "huggingface",
    "local",
    "github",
    "http",
    "custom",
  ]);
  assert.equal(normalizeAssetExternalRepositoryProvider(" HuggingFace "), "huggingface");

  assert.deepEqual([...ASSET_EXTERNAL_REPOSITORY_OBJECT_KINDS], [
    "repository",
    "file",
    "directory",
    "model",
    "dataset",
    "artifact",
    "preview",
    "custom",
  ]);
  assert.equal(normalizeAssetExternalRepositoryObjectKind(" Model "), "model");
});

test("preview contracts expose metadata-only preview kinds", () => {
  assert.deepEqual([...ASSET_RESOURCE_PREVIEW_KINDS], [
    "thumbnail",
    "text-summary",
    "metadata-summary",
    "table-sample",
    "image-preview",
    "document-preview",
    "model-card",
    "dataset-sample",
    "custom",
  ]);
  assert.equal(normalizeAssetResourcePreviewKind(" Text-Summary "), "text-summary");
});

test("resource backings can safely reference artifact and external repository resources", () => {
  const artifactBacking: AssetResourceBacking = {
    backingId: "artifact.uploaded-document",
    resourceKind: "artifact",
    ref: {
      kind: "artifact",
      id: "artifact-ref.uploaded-document" as never,
      metadata: { artifactKey: "uploads/document.txt" },
    },
    role: "primary",
    metadata: { storedAs: "artifact-key" },
  };

  const externalRef: AssetExternalRepositoryObjectReference = {
    provider: "huggingface",
    repositoryId: "org/model",
    revision: "main",
    objectPath: "README.md",
    objectKind: "file",
    contentType: "text/markdown",
    metadata: { pathIsProviderMetadata: true },
  };
  const repoBacking: AssetResourceBacking = {
    backingId: "external-repository-object.org-model-readme",
    resourceKind: "external-repository-object",
    ref: externalRef,
    role: "source",
  };

  assert.equal(artifactBacking.resourceKind, "artifact");
  assert.equal(repoBacking.resourceKind, "external-repository-object");
  assert.equal((repoBacking.ref as AssetExternalRepositoryObjectReference).objectPath, "README.md");
});

test("resource backing contract does not require raw paths, URLs, tokens, secrets, or bytes", () => {
  const backing: AssetResourceBacking = {
    backingId: "storage-object.safe-key",
    resourceKind: "storage-object",
    ref: { kind: "resource", id: "storage-object-ref.safe-key" as never },
  };

  assert.deepEqual(
    ["filePath", "filesystemPath", "localPath", "url", "token", "secret", "bytes", "blob"].filter(
      (key) => key in backing,
    ),
    [],
  );
});

test("resource-backed asset links asset refs to one or more resource backings", () => {
  const primaryBackingRef: AssetResourceBackingReference = { kind: "asset-resource-backing", id: "image.generated" as never };
  const link: AssetResourceBackedAsset = {
    assetRef: { kind: "asset-instance", id: "instance.image" as never },
    backings: [
      {
        backingId: "image.generated",
        resourceKind: "image",
        ref: { kind: "artifact", id: "artifact-ref.generated" as never },
        role: "primary",
      },
    ],
    primaryBackingRef,
    previewRefs: [{ kind: "resource", id: "preview.generated.thumbnail" as never }],
    metadata: { mappingOnly: true },
  };

  assert.equal(link.assetRef.kind, "asset-instance");
  assert.equal(link.backings.length, 1);
  assert.equal(link.primaryBackingRef?.kind, "asset-resource-backing");
  assert.equal(link.primaryBackingRef?.id, "image.generated");
});

test("generated output references runtime capabilities without duplicating readiness or task records", () => {
  const generated: AssetGeneratedOutputReference = {
    outputId: "output.generated-image",
    runtimeCapabilityId: "image-generation",
    producedAssetType: "image",
    taskRef: { kind: "resource", id: "runtime-task.123" as never },
    sourceRefs: [{ kind: "asset-instance", id: "instance.prompt" as never }],
    metadata: { promptId: "prompt-123" },
  };

  assert.equal(generated.runtimeCapabilityId, "image-generation");
  assert.equal("runtimeReadinessSnapshot" in generated, false);
  assert.equal("taskRecord" in generated, false);
});

test("preview reference is metadata-only and stores no bytes", () => {
  const preview: AssetResourcePreviewReference = {
    previewId: "preview.dataset-sample",
    previewKind: "dataset-sample",
    assetRef: { kind: "resource-backed-asset", id: "dataset.training" as never },
    contentType: "application/json",
    summary: "Five-row table sample.",
    metadata: { rowCount: 5 },
  };

  assert.equal(preview.previewKind, "dataset-sample");
  assert.equal("bytes" in preview, false);
  assert.equal("blob" in preview, false);
});
