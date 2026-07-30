import { constants } from "node:fs";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import { createFilesystemGeneratedImagePersistenceAdapter } from "../createFilesystemGeneratedImagePersistenceAdapter";

describe("createFilesystemGeneratedImagePersistenceAdapter", () => {
  it("moves comfy output into generated/images with safe artifact key and writes catalog+binding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-move-"));
    const out = path.join(root, "comfy");
    const store = path.join(root, "store");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "x.png"), "abc");
    const artifactCatalogAppend = {
      appendArtifactCatalogRecord: testDouble.fn(async () => ({
        ok: true as const,
        value: { storageKey: "workspaces/workspace-a/generated/images/x.png" },
      })),
    };
    const artifactStorageBinding = {
      upsertArtifactStorageBinding: testDouble.fn(async () => ({
        ok: true as const,
        value: { binding: {} },
      })),
    };
    const adapter = createFilesystemGeneratedImagePersistenceAdapter({
      comfyUiOutputRoot: out,
      artifactStorageRoot: store,
      artifactCatalogAppend,
      artifactStorageBinding,
    });
    const result = await adapter.persistGeneratedImage({
      output: { type: "image", engine: "comfyui", fileName: "x.png" },
      workspaceId: "workspace-a",
      requestId: "req-1",
    });
    expect(result.storageKey).toBe(
      "workspaces/workspace-a/generated/images/x.png",
    );
    expect((await stat(path.join(store, result.storageKey))).isFile()).toBe(
      true,
    );
    await expect(stat(path.join(out, "x.png"))).rejects.toThrow();
    expect(
      artifactCatalogAppend.appendArtifactCatalogRecord.mock.calls[0]?.[0]
        ?.record,
    ).toMatchObject({
      workspaceId: "workspace-a",
      sourceKind: "generated",
      artifactFamily: "image",
    });
    expect(
      artifactStorageBinding.upsertArtifactStorageBinding.mock.calls[0]?.[0]
        ?.binding,
    ).toMatchObject({
      workspaceId: "workspace-a",
      artifactId: result.artifactId,
      role: "primary",
      backing: {
        kind: "artifact-object",
        provider: "filesystem",
        locator: result.storageKey,
        verification: { exists: true },
      },
    });
  });

  it("rejects path traversal in filename and subfolder", async () => {
    const adapter = createFilesystemGeneratedImagePersistenceAdapter({
      comfyUiOutputRoot: "/tmp/out",
      artifactStorageRoot: "/tmp/store",
    });
    await expect(
      adapter.persistGeneratedImage({
        output: { type: "image", engine: "comfyui", fileName: "../x.png" },
        workspaceId: "workspace-a",
        requestId: "req-1",
      }),
    ).rejects.toThrow("Generated image output path is invalid.");
    await expect(
      adapter.persistGeneratedImage({
        output: {
          type: "image",
          engine: "comfyui",
          fileName: "x.png",
          subfolder: "../evil",
        },
        workspaceId: "workspace-a",
        requestId: "req-1",
      }),
    ).rejects.toThrow("Generated image output path is invalid.");
    await expect(
      adapter.persistGeneratedImage({
        output: {
          type: "image",
          engine: "comfyui",
          fileName: "x.png",
          subfolder: "../evil",
          contentBase64: Buffer.from("abc").toString("base64"),
        },
        workspaceId: "workspace-a",
        requestId: "req-1",
      }),
    ).rejects.toThrow("Generated image output path is invalid.");
  });

  it("persists generated image from in-memory base64 content when runtime file was already deleted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-memory-"));
    const out = path.join(root, "comfy");
    const store = path.join(root, "store");
    await mkdir(out, { recursive: true });
    const adapter = createFilesystemGeneratedImagePersistenceAdapter({
      comfyUiOutputRoot: out,
      artifactStorageRoot: store,
    });
    const pngBody = Buffer.from("abc");
    const result = await adapter.persistGeneratedImage({
      output: {
        type: "image",
        engine: "comfyui",
        fileName: "x.png",
        contentBase64: pngBody.toString("base64"),
        mediaType: "image/png",
      },
      workspaceId: "workspace-a",
      requestId: "req-1",
    });
    expect((await stat(path.join(store, result.storageKey))).isFile()).toBe(
      true,
    );
    expect(await readFile(path.join(store, result.storageKey))).toEqual(
      pngBody,
    );
  });

  it("rejects oversized file and inline outputs without retaining partial destinations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-bounded-"));
    const out = path.join(root, "comfy");
    const store = path.join(root, "store");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "large.png"), "12345");
    const adapter = createFilesystemGeneratedImagePersistenceAdapter({
      comfyUiOutputRoot: out,
      artifactStorageRoot: store,
      maximumGeneratedImageBytes: 4,
    });

    await expect(
      adapter.persistGeneratedImage({
        output: { type: "image", engine: "comfyui", fileName: "large.png" },
        workspaceId: "workspace-a",
        requestId: "req-file",
      }),
    ).rejects.toThrow("configured byte limit");
    await expect(
      adapter.persistGeneratedImage({
        output: {
          type: "image",
          engine: "comfyui",
          fileName: "inline.png",
          contentBase64: Buffer.from("12345").toString("base64"),
        },
        workspaceId: "workspace-a",
        requestId: "req-inline",
      }),
    ).rejects.toThrow("configured byte limit");
    expect((await stat(path.join(out, "large.png"))).isFile()).toBe(true);
    await expect(
      stat(
        path.join(store, "workspaces/workspace-a/generated/images/large.png"),
      ),
    ).rejects.toThrow();
    await expect(
      stat(
        path.join(store, "workspaces/workspace-a/generated/images/inline.png"),
      ),
    ).rejects.toThrow();
  });

  it("appends numeric suffixes for generated filename collisions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-name-collision-"));
    const out = path.join(root, "comfy");
    const store = path.join(root, "store");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "x.png"), "abc");
    await mkdir(path.join(store, "workspaces/workspace-a/generated/images"), {
      recursive: true,
    });
    await writeFile(
      path.join(store, "workspaces/workspace-a/generated/images/my-image.png"),
      "existing",
    );
    const adapter = createFilesystemGeneratedImagePersistenceAdapter({
      comfyUiOutputRoot: out,
      artifactStorageRoot: store,
    });
    const result = await adapter.persistGeneratedImage({
      output: {
        type: "image",
        engine: "comfyui",
        fileName: "my image.png",
        contentBase64: Buffer.from("abc").toString("base64"),
      },
      workspaceId: "workspace-a",
      requestId: "req-1",
    });
    expect(result.storageKey).toBe(
      "workspaces/workspace-a/generated/images/my-image-2.png",
    );
  });

  it("validates workspace id before constructing generated image keys", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-invalid-workspace-"));
    const adapter = createFilesystemGeneratedImagePersistenceAdapter({
      comfyUiOutputRoot: path.join(root, "comfy"),
      artifactStorageRoot: path.join(root, "store"),
    });
    await expect(
      adapter.persistGeneratedImage({
        output: { type: "image", engine: "comfyui", fileName: "x.png" },
        workspaceId: "../workspace-b",
        requestId: "req-1",
      }),
    ).rejects.toThrow("Workspace id must be");
  });

  it("sanitizes catalog append failures and keeps workspace image keys isolated", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-append-fail-"));
    const out = path.join(root, "comfy");
    const store = path.join(root, "store");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "x.png"), "abc");
    const rawPath = path.join(root, "secret", "catalog.ndjson");
    const artifactCatalogAppend = {
      appendArtifactCatalogRecord: testDouble.fn(async () => ({
        ok: false as const,
        error: { code: "unavailable" as const, message: `failed ${rawPath}` },
      })),
    };
    const adapter = createFilesystemGeneratedImagePersistenceAdapter({
      comfyUiOutputRoot: out,
      artifactStorageRoot: store,
      artifactCatalogAppend,
    });
    try {
      await adapter.persistGeneratedImage({
        output: { type: "image", engine: "comfyui", fileName: "x.png" },
        workspaceId: "workspace-a",
        requestId: "req-1",
      });
      throw new Error("Expected generated image persistence to fail.");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect((error as Error).message).toBe(
        "Failed to register generated image artifact.",
      );
      expect(JSON.stringify(error)).not.toContain(rawPath);
    }

    const record =
      artifactCatalogAppend.appendArtifactCatalogRecord.mock.calls[0]?.[0]
        ?.record;
    expect(
      record.storageKey.startsWith("workspaces/workspace-a/generated/images/"),
    ).toBe(true);
    expect(
      record.storageKey.startsWith("workspaces/workspace-b/generated/images/"),
    ).toBe(false);
  });

  it("sanitizes artifact binding failures without leaking raw paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "img-binding-fail-"));
    const out = path.join(root, "comfy");
    const store = path.join(root, "store");
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "x.png"), "abc");
    const rawPath = path.join(root, "secret", "bindings.ndjson");
    const artifactStorageBinding = {
      upsertArtifactStorageBinding: testDouble.fn(async () => ({
        ok: false as const,
        error: { code: "unavailable" as const, message: `failed ${rawPath}` },
      })),
    };
    const adapter = createFilesystemGeneratedImagePersistenceAdapter({
      comfyUiOutputRoot: out,
      artifactStorageRoot: store,
      artifactStorageBinding,
    });

    try {
      await adapter.persistGeneratedImage({
        output: { type: "image", engine: "comfyui", fileName: "x.png" },
        workspaceId: "workspace-a",
        requestId: "req-1",
      });
      throw new Error("Expected generated image persistence to fail.");
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect((error as Error).message).toBe(
        "Failed to persist generated image primary binding.",
      );
      expect(JSON.stringify(error)).not.toContain(rawPath);
    }
  });
});
