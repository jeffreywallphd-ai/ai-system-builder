import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ArtifactBrowseItem, ArtifactBrowseSuccessValue, ArtifactReadSuccessValue } from "../../../../contracts/artifact-browser";
import { createContractError, createFailureResult, createSuccessResult, type ContractResult } from "../../../../contracts/shared";
import type { ArtifactBrowserMetadataReadPort } from "../../../ports/artifact-browser";
import { ArtifactResourceBackedViewProvider } from "../asset-artifact-resource-backed-view-provider.service";

class FakeArtifactBrowserMetadataRead implements Pick<ArtifactBrowserMetadataReadPort, "browseArtifacts"> {
  public browseCalls = 0;
  public readDetailCalls = 0;
  public readContentCalls = 0;
  public storageListCalls = 0;
  public createAssetInstanceCalls = 0;
  public persistMappingCalls = 0;
  public result: ContractResult<ArtifactBrowseSuccessValue> | undefined;
  public throws = false;

  public constructor(private readonly items: readonly ArtifactBrowseItem[] = []) {}

  public async browseArtifacts(): Promise<ContractResult<ArtifactBrowseSuccessValue>> {
    this.browseCalls += 1;
    if (this.throws) throw new Error("C:\\Users\\name\\secret token stack raw provider payload command bytes blob base64");
    return this.result ?? createSuccessResult({ items: [...this.items] });
  }

  public async readArtifactDetail(request: Parameters<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>[0]): Promise<ContractResult<ArtifactReadSuccessValue>> {
    this.readDetailCalls += 1;
    const item = this.items.find((candidate) => candidate.storageKey === request.locator.storageKey) ?? this.items[0]!;
    return createSuccessResult({
      artifact: {
        locator: request.locator,
        artifactFamily: item.artifactFamily,
        mediaType: item.mediaType,
        sizeBytes: item.sizeBytes,
        sourceKind: item.sourceKind,
        originalName: item.originalName,
        createdAt: item.createdAt,
        metadata: item.metadata,
      },
    });
  }
}

function safeArtifact(overrides: Partial<ArtifactBrowseItem> = {}): ArtifactBrowseItem {
  return {
    artifactId: "artifact-1",
    storageKey: "uploads/private/source.txt",
    artifactFamily: "binary",
    mediaType: "application/octet-stream",
    sizeBytes: 128,
    sourceKind: "upload",
    originalName: "source.bin",
    createdAt: "2026-01-01T00:00:00.000Z",
    metadata: { label: "safe" },
    ...overrides,
  };
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertSafe(value: unknown): void {
  const output = serialized(value);
  for (const unsafe of [
    "uploads/private",
    "c:\\users",
    "/tmp",
    "token",
    "secret",
    "password",
    "authorization",
    "api_key",
    "apikey",
    "commandline",
    "stacktrace",
    "rawpayload",
    "blobbytes",
    "contentbase64",
    "bearer",
    "base64",
    "file content",
  ]) {
    assert.equal(output.includes(unsafe), false, `serialized output included ${unsafe}: ${output}`);
  }
}

describe("ArtifactResourceBackedViewProvider", () => {

  it("requires workspace context and does not call artifact browse without it", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([]);
    const result = await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews();

    assert.deepEqual(result.items, []);
    assert.equal(browser.browseCalls, 0);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "workspace-required"), true);
  });
  it("maps a safe artifact descriptor to a generic artifact resource-backed view", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([safeArtifact({ artifactId: "artifact-alpha", originalName: "Source data.bin" })]);
    const result = await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a" });

    const view = result.items[0]!;
    assert.equal(view.viewKind, "artifact");
    assert.equal(view.assetType, "data-source");
    assert.equal(view.assetFamily, "resource-backed");
    assert.equal(view.assetDefinitionRef?.id, "builtin.artifact");
    assert.equal(view.displayName, "Source data.bin");
    assert.equal(view.summary?.includes("registered asset instance"), true);
    assert.equal(view.resourceBacking?.resourceKind, "artifact");
    assert.equal(view.resourceBackedAsset?.assetRef.kind, "resource-backed-asset");
    assertSafe(result);
  });

  it("maps a document-like artifact descriptor to a document resource-backed view", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      safeArtifact({ artifactId: "artifact-doc", artifactFamily: "document", mediaType: "application/pdf", originalName: "Requirements.pdf" }),
    ]);

    const view = (await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a" })).items[0]!;

    assert.equal(view.viewKind, "document");
    assert.equal(view.assetType, "document");
    assert.equal(view.assetDefinitionRef?.id, "builtin.document");
    assert.equal(view.resourceBacking?.contentType, "application/pdf");
    assert.equal(view.resourceBacking?.format, "pdf");
  });

  it("keeps uncertain document type as a generic artifact view", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      safeArtifact({ artifactId: "artifact-binary", artifactFamily: "binary", mediaType: "application/octet-stream", originalName: "unknown.bin" }),
    ]);

    const view = (await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a" })).items[0]!;

    assert.equal(view.viewKind, "artifact");
    assert.equal(view.assetType, "data-source");
  });

  it("detects document-like artifacts from safe metadata without reading bytes", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      safeArtifact({ artifactId: "artifact-json", mediaType: undefined, originalName: "metadata", metadata: { contentType: "application/json" } }),
    ]);

    const view = (await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a" })).items[0]!;

    assert.equal(view.viewKind, "document");
    assert.equal(browser.readContentCalls, 0);
    assert.equal(browser.readDetailCalls, 0);
  });

  it("does not call storage list/filesystem functions or create durable asset records", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([safeArtifact()]);
    await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a" });

    assert.equal(browser.storageListCalls, 0);
    assert.equal(browser.createAssetInstanceCalls, 0);
    assert.equal(browser.persistMappingCalls, 0);
  });

  it("does not expose storage keys or path-like artifact identifiers", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      safeArtifact({ artifactId: "uploads/private/report.pdf", storageKey: "uploads/private/report.pdf", mediaType: "application/pdf", originalName: "report.pdf" }),
    ]);

    const result = await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a", includeMetadata: true } as never);

    assert.equal(result.items[0]?.viewKind, "document");
    assertSafe(result);
  });

  it("removes local paths and path-like names from display and metadata", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      safeArtifact({
        artifactId: "artifact-paths",
        originalName: "C:\\Users\\name\\report.pdf",
        metadata: { safe: "visible", localPath: "/tmp/report.pdf", nested: { filePath: "C:\\Users\\name\\x" } },
      }),
    ]);

    const view = (await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a" })).items[0]!;

    assert.equal(view.displayName, "artifact-paths");
    assert.equal(view.metadata?.safe, "visible");
    assertSafe(view);
  });

  it("removes secrets, auth, env, command, stack, raw payload, bytes, blob, and base64 values", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      safeArtifact({
        artifactId: "artifact-unsafe",
        metadata: {
          safe: "visible",
          token: "secret-token",
          authorization: "Bearer secret",
          password: "password=secret",
          env: { SECRET_ENV: "hidden" },
          commandLine: "python run.py --token x",
          stackTrace: "Error: stack",
          rawPayload: { value: "raw provider payload" },
          blobBytes: "bytes",
          contentBase64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ=",
        },
      }),
    ]);

    const result = await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a" });

    assert.equal(result.items[0]?.metadata?.safe, "visible");
    assertSafe(result);
  });

  it("supports safe bounded limits", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      safeArtifact({ artifactId: "artifact-1" }),
      safeArtifact({ artifactId: "artifact-2" }),
      safeArtifact({ artifactId: "artifact-3" }),
    ]);

    const result = await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser, maxListLimit: 2 }).listResourceBackedViews({ workspaceId: "workspace-a", limit: 99 });

    assert.deepEqual(result.items.map((item) => item.sourceRef?.metadata?.artifactId), ["artifact-1", "artifact-2"]);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "artifact-resource-backed-view-limit-clamped"), true);
  });

  it("safely reports unsupported cursor behavior", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([safeArtifact()]);
    const result = await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser }).listResourceBackedViews({ workspaceId: "workspace-a", cursor: "cursor-1" });

    assert.equal(result.nextCursor, undefined);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "artifact-resource-backed-view-cursor-unsupported"), true);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "artifact-resource-backed-view-source-pagination-unavailable"), true);
    assertSafe(result);
  });

  it("supports safe search, asset type, family, and view kind filtering", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      safeArtifact({ artifactId: "artifact-notes", artifactFamily: "document", mediaType: "text/markdown", originalName: "Notes.md" }),
      safeArtifact({ artifactId: "artifact-image", artifactFamily: "image", mediaType: "image/png", originalName: "Image.png" }),
    ]);
    const provider = new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser });

    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a", searchText: "notes" })).items.map((item) => item.viewKind), ["document"]);
    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a", assetTypes: ["document"] })).items.map((item) => item.viewKind), ["document"]);
    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a", assetFamilies: ["resource-backed"], viewKinds: ["artifact"] })).items.map((item) => item.displayName), ["Image.png"]);
    assert.equal((await provider.listResourceBackedViews({ workspaceId: "workspace-a", lifecycleStatuses: ["published"] })).diagnostics?.some((diagnostic) => diagnostic.code === "artifact-resource-backed-view-lifecycle-filter-unsupported"), true);
  });

  it("returns sanitized diagnostics when the artifact source is unavailable or fails", async () => {
    const noSource = await new ArtifactResourceBackedViewProvider().listResourceBackedViews({ workspaceId: "workspace-a" });
    assert.equal(noSource.diagnostics?.some((diagnostic) => diagnostic.code === "artifact-resource-backed-view-source-unavailable"), true);

    const failingResult = new FakeArtifactBrowserMetadataRead();
    failingResult.result = createFailureResult(createContractError("internal", "C:\\Users\\name\\secret token stack raw provider payload"));
    const failed = await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: failingResult }).listResourceBackedViews({ workspaceId: "workspace-a" });

    const throwing = new FakeArtifactBrowserMetadataRead();
    throwing.throws = true;
    const thrown = await new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: throwing }).listResourceBackedViews({ workspaceId: "workspace-a" });

    assert.equal(failed.diagnostics?.some((diagnostic) => diagnostic.code === "artifact-resource-backed-view-source-failed"), true);
    assert.equal(thrown.diagnostics?.some((diagnostic) => diagnostic.code === "artifact-resource-backed-view-source-failed"), true);
    assertSafe([noSource, failed, thrown]);
  });

  it("reads detail by bounded list fallback with an explicit limitation diagnostic and no byte reads", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([safeArtifact({ artifactId: "artifact-read", originalName: "Readme.md", mediaType: "text/markdown" })]);
    const provider = new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser });
    const listed = await provider.listResourceBackedViews({ workspaceId: "workspace-a" });
    const detail = await provider.readResourceBackedView(listed.items[0]!.viewId, { workspaceId: "workspace-a" });

    assert.equal(detail?.viewKind, "document");
    assert.equal(detail?.diagnostics?.some((diagnostic) => diagnostic.code === "artifact-resource-backed-view-detail-list-fallback-limited"), true);
    assert.equal(await provider.readResourceBackedView("missing", { workspaceId: "workspace-a" }), undefined);
    assert.equal(browser.readContentCalls, 0);
    assert.equal(browser.readDetailCalls, 0);
    assert.equal(browser.createAssetInstanceCalls, 0);
    assert.equal(browser.persistMappingCalls, 0);
  });

  it("imports no forbidden outer layers, storage adapters, byte readers, filesystem, network, or runtime seams", () => {
    const source = readFileSync("modules/application/services/asset/asset-artifact-resource-backed-view-provider.service.ts", "utf8");
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
      "readArtifactContent",
      "ArtifactBrowserContentReadPort",
      "ArtifactObjectStoragePort",
      "ArtifactRepoStoragePort",
      "scanArtifacts",
      "readBytes",
      "runtimeReadiness",
      "RuntimeTaskRegistry",
      "HuggingFace",
      "huggingface/",
    ]) {
      assert.equal(source.includes(forbidden), false, `unexpected forbidden boundary: ${forbidden}`);
    }
  });
});
