import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";

import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalModelRegistryAdapter } from "../createLocalModelRegistryAdapter";

function createTestAdapterOptions(filePath: string) {
  return {
    filePath,
    now: () => "2026-04-27T00:00:00.000Z",
    discovery: { enabled: false },
  };
}

describe("createLocalModelRegistryAdapter", () => {
  it("type-checks with Node readdir directory-entry overloads", () => {
    const program = ts.createProgram(["modules/adapters/persistence/model/createLocalModelRegistryAdapter.ts"], {
      strict: true,
      noEmit: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      skipLibCheck: true,
      types: ["node"],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const formattedDiagnostics = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    });

    expect(formattedDiagnostics).toBe("");
  });

  it("creates and saves remote model references", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    const adapter = createLocalModelRegistryAdapter(createTestAdapterOptions(filePath));

    const saved = await adapter.saveModelReference({
      workspaceId: "workspace-a" as never, 
      provider: "huggingface",
      modelId: "openai/demo-model",
      displayName: "Demo",
      taskTags: ["text-generation"],
      metadata: { likes: 1 },
    });

    expect(saved.model.modelRecordId.startsWith("model_")).toBe(true);
    expect(saved.model.lifecycleStatus).toBe("saved-reference");
    expect(saved.model.localPath).toBeUndefined();
  });

  it("lists with filter/search and updates/deletes records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    const adapter = createLocalModelRegistryAdapter(createTestAdapterOptions(filePath));

    await adapter.registerDownloadedModel({
      workspaceId: "workspace-a" as never, 
      modelRecordId: "m1",
      displayName: "Local Llama",
      source: "local",
      provider: "huggingface",
      artifactForm: "full-model",
      localPath: "/models/llama",
    });

    await adapter.registerGeneratedModel({
      workspaceId: "workspace-a" as never, 
      modelRecordId: "m2",
      displayName: "Adapter Alpha",
      artifactForm: "adapter",
      localPath: "/models/adapter-alpha",
      baseModelId: "m1",
      generatedFromRunId: "run-1",
      metadata: { custom: { nested: true } },
    });

    const generated = await adapter.getModelRecord("workspace-a" as never, "m2");
    expect(generated?.provider).toBe("unknown");

    const list = await adapter.listModels({
      workspaceId: "workspace-a" as never,  search: "adapter", source: "generated", limit: 10 });
    expect(list.models.map((model) => model.modelRecordId)).toEqual(["m2"]);

    const updated = await adapter.updateModelRecord({
      workspaceId: "workspace-a" as never, 
      modelRecordId: "m2",
      patch: { validationStatus: "valid", validationReportPath: "/reports/m2.json" },
    });
    expect(updated.model.updatedAt).toBe("2026-04-27T00:00:00.000Z");
    expect(updated.model.validationStatus).toBe("valid");

    await adapter.deleteModelRecord({
      workspaceId: "workspace-a" as never,  modelRecordId: "m2" });
    const afterDelete = await adapter.listModels({
      workspaceId: "workspace-a" as never,  limit: 10 });
    expect(afterDelete.models.map((model) => model.modelRecordId)).toEqual(["m1"]);
  });

  it("preserves unknown root metadata and does not manage files directly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    await writeFile(filePath, JSON.stringify({ schemaVersion: 3, models: [] }), "utf8");

    const adapter = createLocalModelRegistryAdapter(createTestAdapterOptions(filePath));
    await adapter.saveModelReference({
      workspaceId: "workspace-a" as never,  provider: "huggingface", modelId: "org/demo", displayName: "Demo" });

    const document = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    expect(document.schemaVersion).toBe(3);

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("huggingface.token");
    expect(serialized).not.toContain("deleteFile");
    expect(serialized).not.toContain("unlink");
  });

  it("lists configured shared Hugging Face cache models without persisting them into workspace inventory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    const cacheRoot = join(dir, "hf-cache");
    const newestSnapshot = join(cacheRoot, "models--org--demo-model", "snapshots", "bbb");
    const olderSnapshot = join(cacheRoot, "models--org--demo-model", "snapshots", "aaa");
    await mkdir(olderSnapshot, { recursive: true });
    await mkdir(newestSnapshot, { recursive: true });

    const adapter = createLocalModelRegistryAdapter({
      filePath,
      now: () => "2026-04-27T00:00:00.000Z",
      discovery: {
        searchRoots: [cacheRoot],
        env: {},
        homeDirectory: join(dir, "home"),
      },
    });

    const listed = await adapter.listModels({
      workspaceId: "workspace-a" as never,  limit: 10 });
    expect(listed.models.length).toBe(1);
    expect(listed.models[0]).toMatchObject({
      workspaceId: "workspace-a",
      modelId: "org/demo-model",
      displayName: "org/demo-model",
      storageScope: "shared",
      lifecycleStatus: "downloaded",
      artifactForm: "full-model",
    });

    const persisted = JSON.parse(await readFile(filePath, "utf8").catch(() => "{}")) as { models?: Array<{ modelId?: string }> };
    expect(persisted.models ?? []).toEqual([]);
  });

  it("lists checkpoint files from the configured shared model directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    const sharedRoot = join(dir, "shared-models");
    await mkdir(sharedRoot, { recursive: true });
    await writeFile(join(sharedRoot, "dream.safetensors"), "checkpoint", "utf8");

    const adapter = createLocalModelRegistryAdapter({
      filePath,
      now: () => "2026-04-27T00:00:00.000Z",
      discovery: {
        searchRoots: async () => [sharedRoot],
      },
    });

    const listed = await adapter.listModels({ workspaceId: "workspace-a" as never, limit: 10 });

    expect(listed.models.length).toBe(1);
    expect(listed.models[0]).toMatchObject({
      displayName: "dream",
      artifactForm: "checkpoint",
      provider: "unknown",
      storageScope: "shared",
    });
  });

  it("can list persisted registry records without cache discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    const cacheRoot = join(dir, "hf-cache");
    await mkdir(join(cacheRoot, "models--org--cached-model", "snapshots", "bbb"), { recursive: true });

    const adapter = createLocalModelRegistryAdapter({
      filePath,
      now: () => "2026-04-27T00:00:00.000Z",
      discovery: {
        searchRoots: [cacheRoot],
        env: {},
        homeDirectory: join(dir, "home"),
      },
    });

    await adapter.registerDownloadedModel({
      workspaceId: "workspace-a" as never, 
      modelRecordId: "registered-1",
      displayName: "Registered Image Model",
      source: "huggingface",
      provider: "huggingface",
      modelId: "org/registered-image-model",
      localPath: join(dir, "models", "registered-image-model"),
      artifactForm: "full-model",
      inferenceMode: "text-to-image",
      taskTags: ["text-to-image"],
    });

    const listed = await adapter.listModels({
      workspaceId: "workspace-a" as never,  limit: 10, includeDiscovered: false });

    expect(listed.models.map((model) => model.modelId)).toEqual(["org/registered-image-model"]);
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as { models?: Array<{ modelId?: string }> };
    expect(persisted.models?.map((model) => model.modelId)).toEqual(["org/registered-image-model"]);
  });

  it("can include configured shared storage while keeping general discovery disabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    const sharedRoot = join(dir, "shared-models");
    await mkdir(sharedRoot, { recursive: true });
    await writeFile(join(sharedRoot, "shared-dream.safetensors"), "checkpoint", "utf8");

    const adapter = createLocalModelRegistryAdapter({
      filePath,
      now: () => "2026-04-27T00:00:00.000Z",
      discovery: {
        searchRoots: [sharedRoot],
        env: {},
        homeDirectory: join(dir, "home"),
      },
    });

    const listed = await adapter.listModels({
      workspaceId: "workspace-a" as never,
      limit: 10,
      includeDiscovered: false,
      includeSharedStorage: true,
    });

    expect(listed.models.map((model) => model.displayName)).toEqual(["shared-dream"]);
    expect(listed.models[0]?.storageScope).toBe("shared");
    const persisted = JSON.parse(await readFile(filePath, "utf8").catch(() => "{}")) as { models?: Array<{ modelId?: string }> };
    expect(persisted.models ?? []).toEqual([]);
  });

  it("does not auto-migrate legacy global records into workspace inventory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    await writeFile(filePath, JSON.stringify({ models: [{ modelRecordId: "legacy", displayName: "Legacy", source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface", createdAt: "2026-01-01T00:00:00.000Z" }] }), "utf8");
    const adapter = createLocalModelRegistryAdapter(createTestAdapterOptions(filePath));
    const listed = await adapter.listModels({ workspaceId: "workspace-a" as never, limit: 10 });
    expect(listed.models).toEqual([]);
    expect(await adapter.getModelRecord("workspace-a" as never, "legacy")).toBeUndefined();
  });

  it("uses isolated temporary files for concurrent discovery persistence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    const cacheRoot = join(dir, "hf-cache");
    await mkdir(join(cacheRoot, "models--org--demo-model", "snapshots", "bbb"), { recursive: true });

    const adapter = createLocalModelRegistryAdapter({
      filePath,
      now: () => "2026-04-27T00:00:00.000Z",
      discovery: {
        searchRoots: [cacheRoot],
        env: {},
        homeDirectory: join(dir, "home"),
      },
    });

    const listed = await Promise.all(
      Array.from({ length: 20 }, () => adapter.listModels({
      workspaceId: "workspace-a" as never,  limit: 10 })),
    );

    expect(listed.every((result) => result.models.length === 1)).toBe(true);

    const persisted = JSON.parse(await readFile(filePath, "utf8").catch(() => "{}")) as { models?: Array<{ modelId?: string }> };
    expect(persisted.models ?? []).toEqual([]);
  });
});
