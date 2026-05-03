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
      modelRecordId: "m1",
      displayName: "Local Llama",
      source: "local",
      provider: "huggingface",
      artifactForm: "full-model",
      localPath: "/models/llama",
    });

    await adapter.registerGeneratedModel({
      modelRecordId: "m2",
      displayName: "Adapter Alpha",
      artifactForm: "adapter",
      localPath: "/models/adapter-alpha",
      baseModelId: "m1",
      generatedFromRunId: "run-1",
      metadata: { custom: { nested: true } },
    });

    const generated = await adapter.getModelRecord("m2");
    expect(generated?.provider).toBe("unknown");

    const list = await adapter.listModels({ search: "adapter", source: "generated", limit: 10 });
    expect(list.models.map((model) => model.modelRecordId)).toEqual(["m2"]);

    const updated = await adapter.updateModelRecord({
      modelRecordId: "m2",
      patch: { validationStatus: "valid", validationReportPath: "/reports/m2.json" },
    });
    expect(updated.model.updatedAt).toBe("2026-04-27T00:00:00.000Z");
    expect(updated.model.validationStatus).toBe("valid");

    await adapter.deleteModelRecord({ modelRecordId: "m2" });
    const afterDelete = await adapter.listModels({ limit: 10 });
    expect(afterDelete.models.map((model) => model.modelRecordId)).toEqual(["m1"]);
  });

  it("preserves unknown root metadata and does not manage files directly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "model-registry-"));
    const filePath = join(dir, "models.json");
    await writeFile(filePath, JSON.stringify({ schemaVersion: 3, models: [] }), "utf8");

    const adapter = createLocalModelRegistryAdapter(createTestAdapterOptions(filePath));
    await adapter.saveModelReference({ provider: "huggingface", modelId: "org/demo", displayName: "Demo" });

    const document = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    expect(document.schemaVersion).toBe(3);

    const serialized = JSON.stringify(document);
    expect(serialized).not.toContain("huggingface.token");
    expect(serialized).not.toContain("deleteFile");
    expect(serialized).not.toContain("unlink");
  });

  it("discovers unregistered local Hugging Face cache models and persists them", async () => {
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

    const listed = await adapter.listModels({ limit: 10 });
    expect(listed.models.length).toBe(1);
    expect(listed.models[0]?.source).toBe("local");
    expect(listed.models[0]?.provider).toBe("huggingface");
    expect(listed.models[0]?.modelId).toBe("org/demo-model");
    expect([newestSnapshot, olderSnapshot]).toContain(listed.models[0]?.localPath);

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as { models?: Array<{ modelId?: string }> };
    expect(persisted.models?.[0]?.modelId).toBe("org/demo-model");
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

    const listed = await adapter.listModels({ limit: 10, includeDiscovered: false });

    expect(listed.models.map((model) => model.modelId)).toEqual(["org/registered-image-model"]);
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as { models?: Array<{ modelId?: string }> };
    expect(persisted.models?.map((model) => model.modelId)).toEqual(["org/registered-image-model"]);
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
      Array.from({ length: 20 }, () => adapter.listModels({ limit: 10 })),
    );

    expect(listed.every((result) => result.models[0]?.modelId === "org/demo-model")).toBe(true);

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as { models?: Array<{ modelId?: string }> };
    expect(persisted.models?.[0]?.modelId).toBe("org/demo-model");
  });
});
