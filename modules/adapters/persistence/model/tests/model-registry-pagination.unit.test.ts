import assert from "node:assert/strict";
import fsPromises, {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";
import {test} from "node:test";
import {DEFAULT_LIST_MODELS_LIMIT, MAX_LIST_MODELS_LIMIT, type ListModelsRequest} from "../../../../contracts/model";
import {createLocalModelRegistryAdapter} from "../createLocalModelRegistryAdapter";

const workspace = "workspace-pagination" as never;
const foreignWorkspace = "workspace-foreign-pagination" as never;
const refused = "Model inventory cursor is unavailable.";

async function withRegistry(run: (fixture: {adapter: ReturnType<typeof createLocalModelRegistryAdapter>;
  filePath: string; discoveryCalls: () => number}) => Promise<void>) {
  const temporaryRoot = resolve(tmpdir());
  const directory = resolve(await mkdtemp(join(temporaryRoot, "headless-model-pagination-")));
  const filePath = join(directory, "models.json");
  let discoveryCalls = 0;
  try {
    const adapter = createLocalModelRegistryAdapter({filePath, now: () => "2026-11-01T00:00:00.000Z",
      discovery: {enabled: true, env: {}, homeDirectory: directory,
        searchRoots: () => {discoveryCalls++; return [join(directory, "shared")];}}});
    for (let number = 1; number <= 5; number++) {
      await adapter.saveModelReference({workspaceId: workspace, modelRecordId: `model-${number}`,
        provider: "huggingface", modelId: `synthetic/model-${number}`,
        displayName: `${number % 2 ? "Keep" : "Other"} ${number}`,
        taskTags: [number % 2 ? "classification" : "chat"]});
    }
    await adapter.saveModelReference({workspaceId: foreignWorkspace, modelRecordId: "foreign-model",
      provider: "huggingface", modelId: "synthetic/foreign", displayName: "Foreign"});
    await run({adapter, filePath, discoveryCalls: () => discoveryCalls});
  } finally {
    assert.equal(dirname(directory), temporaryRoot);
    assert.ok(basename(directory).startsWith("headless-model-pagination-"));
    await rm(directory, {recursive: true, force: true});
  }
}

const query = (overrides: Partial<ListModelsRequest> = {}): ListModelsRequest => ({workspaceId: workspace,
  includeDiscovered: false, includeSharedStorage: false, limit: 2, ...overrides});

test("model inventory advances from the first omitted record without repeating or losing rows", async () => {
  await withRegistry(async ({adapter, filePath, discoveryCalls}) => {
    const saved = await readFile(filePath);
    const first = await adapter.listModels(query());
    assert.deepEqual(first.models.map(model => model.modelRecordId), ["model-1", "model-2"]);
    assert.equal(first.nextCursor, "model-3");
    const second = await adapter.listModels(query({cursor: first.nextCursor}));
    assert.deepEqual(second.models.map(model => model.modelRecordId), ["model-3", "model-4"]);
    assert.equal(second.nextCursor, "model-5");
    const third = await adapter.listModels(query({cursor: second.nextCursor}));
    assert.deepEqual(third.models.map(model => model.modelRecordId), ["model-5"]);
    assert.equal(third.nextCursor, undefined);
    assert.deepEqual([first, second, third].flatMap(page => page.models.map(model => model.modelRecordId)),
      ["model-1", "model-2", "model-3", "model-4", "model-5"]);
    assert.equal(discoveryCalls(), 0);
    assert.deepEqual(await readFile(filePath), saved);
  });
});

test("model inventory cursor membership and ordering use the current complete filter", async () => {
  await withRegistry(async ({adapter}) => {
    const selected = query({limit: 1, source: "huggingface", lifecycleStatus: "saved-reference", provider: "huggingface",
      artifactForm: "full-model", taskTags: ["classification"], search: "keep"});
    const first = await adapter.listModels(selected);
    assert.deepEqual(first.models.map(model => model.modelRecordId), ["model-1"]);
    assert.equal(first.nextCursor, "model-3");
    const second = await adapter.listModels({...selected, cursor: first.nextCursor});
    assert.deepEqual(second.models.map(model => model.modelRecordId), ["model-3"]);
    assert.equal(second.nextCursor, "model-5");
    const last = await adapter.listModels({...selected, cursor: second.nextCursor});
    assert.deepEqual(last.models.map(model => model.modelRecordId), ["model-5"]);
    assert.equal(last.nextCursor, undefined);
    await assert.rejects(adapter.listModels({...selected, cursor: "model-2"}), {message: refused});
  });
});

test("unknown and foreign model cursors fail without echoing an identity or changing saved bytes", async () => {
  await withRegistry(async ({adapter, filePath, discoveryCalls}) => {
    const saved = await readFile(filePath);
    for (const cursor of ["missing-private-marker", "foreign-model"]) {
      await assert.rejects(adapter.listModels(query({cursor})), {message: refused});
    }
    assert.equal(discoveryCalls(), 0);
    assert.deepEqual(await readFile(filePath), saved);
  });
});

test("a removed model cursor requires a fresh first page", async () => {
  await withRegistry(async ({adapter}) => {
    const first = await adapter.listModels(query());
    await adapter.deleteModelRecord({workspaceId: workspace, modelRecordId: first.nextCursor!});
    await assert.rejects(adapter.listModels(query({cursor: first.nextCursor})), {message: refused});
    const restarted = await adapter.listModels(query());
    assert.deepEqual(restarted.models.map(model => model.modelRecordId), ["model-1", "model-2"]);
    assert.equal(restarted.nextCursor, "model-4");
  });
});

test("ambiguous model cursor membership fails closed", async () => {
  await withRegistry(async ({adapter, filePath}) => {
    const document = JSON.parse(await readFile(filePath, "utf8"));
    document.models.push({...document.models.find((model: {modelRecordId: string}) => model.modelRecordId === "model-3")});
    await writeFile(filePath, JSON.stringify(document));
    const saved = await readFile(filePath);
    await assert.rejects(adapter.listModels(query({cursor: "model-3"})), {message: refused});
    assert.deepEqual(await readFile(filePath), saved);
  });
});

test("model inventory captures workspace, filters, tags, cursor, limit and discovery before I/O", async () => {
  await withRegistry(async ({adapter, discoveryCalls}) => {
    const requested = query({limit: 1, cursor: "model-3", search: "keep", source: "huggingface",
      lifecycleStatus: "saved-reference", artifactForm: "full-model", provider: "huggingface", taskTags: ["classification"]});
    const pending = adapter.listModels(requested);
    requested.taskTags!.splice(0, 1, "chat");
    Object.assign(requested, {workspaceId: foreignWorkspace, limit: 999, cursor: "foreign-model", search: "foreign",
      source: "local", lifecycleStatus: "installed", artifactForm: "adapter", provider: "unknown",
      includeDiscovered: true, includeSharedStorage: true});
    const result = await pending;
    assert.deepEqual(result.models.map(model => model.modelRecordId), ["model-3"]);
    assert.equal(result.nextCursor, "model-5");
    assert.equal(discoveryCalls(), 0);
  });
});

test("model inventory retains existing contract page limits with inclusive cursor continuation", async () => {
  await withRegistry(async ({adapter, filePath}) => {
    const document = JSON.parse(await readFile(filePath, "utf8"));
    const example = document.models[0];
    document.models = Array.from({length: MAX_LIST_MODELS_LIMIT + 1}, (_, number) =>
      ({...example, modelRecordId: `bounded-${number}`, displayName: `Bounded ${number}`}));
    await writeFile(filePath, JSON.stringify(document));
    const large = await adapter.listModels(query({limit: MAX_LIST_MODELS_LIMIT + 499}));
    assert.equal(large.models.length, MAX_LIST_MODELS_LIMIT);
    assert.equal(large.nextCursor, `bounded-${MAX_LIST_MODELS_LIMIT}`);
    const last = await adapter.listModels(query({cursor: large.nextCursor}));
    assert.deepEqual(last.models.map(model => model.modelRecordId), [`bounded-${MAX_LIST_MODELS_LIMIT}`]);
    assert.equal(last.nextCursor, undefined);
    const defaulted = await adapter.listModels(query({limit: 0}));
    assert.equal(defaulted.models.length, DEFAULT_LIST_MODELS_LIMIT);
    assert.equal(defaulted.nextCursor, `bounded-${DEFAULT_LIST_MODELS_LIMIT}`);
    const ordinary = await adapter.listModels(query({limit: undefined}));
    assert.equal(ordinary.models.length, DEFAULT_LIST_MODELS_LIMIT);
    assert.equal(ordinary.nextCursor, defaulted.nextCursor);
  });
});

test("legacy Model writes reuse bounded exact Windows publication retries and preserve permanently denied bytes", {skip: process.platform !== "win32"}, async context => {
  for (const code of ["EPERM", "EBUSY", "EACCES"]) await withRegistry(async ({adapter, filePath}) => {
    const rename = fsPromises.rename;
    let expectedBytes = await readFile(filePath), failures = 2;
    const mode: {value: "transient" | "permanent" | "normal"} = {value: "transient"};
    const attempts: [string, string][] = [];
    const replaced = context.mock.method(fsPromises, "rename", async (from: Parameters<typeof rename>[0], to: Parameters<typeof rename>[1]) => {
      if (resolve(String(to)) === filePath) {
        attempts.push([String(from), String(to)]);
        if (mode.value === "permanent" || mode.value === "transient" && failures > 0) {
          failures--; assert.deepEqual(await readFile(filePath), expectedBytes);
          throw Object.assign(new Error("Synthetic sharing conflict."), {code});
        }
      }
      return rename(from, to);
    });
    syncBuiltinESMExports();
    try {
      await adapter.saveModelReference({workspaceId: workspace, modelRecordId: "retry-success", provider: "huggingface", modelId: "synthetic/retry"});
      assert.equal(attempts.length, 3); assert.deepEqual(attempts[0], attempts[1]); assert.deepEqual(attempts[1], attempts[2]);
      expectedBytes = await readFile(filePath);
      attempts.length = 0; mode.value = "permanent";
      await assert.rejects(adapter.saveModelReference({workspaceId: workspace, modelRecordId: "retry-denied",
        provider: "huggingface", modelId: "synthetic/denied"}), {code});
      assert.equal(attempts.length, 4); for (const pair of attempts) assert.deepEqual(pair, attempts[0]);
      assert.deepEqual(await readFile(filePath), expectedBytes);
      assert.deepEqual(await readdir(dirname(filePath)), ["models.json"], "Only the exact fresh temporary file is cleaned up.");
      mode.value = "normal";
      await adapter.saveModelReference({workspaceId: workspace, modelRecordId: "after-denial", provider: "huggingface", modelId: "synthetic/recovered"});
      const records = await adapter.listModels(query({limit: 20}));
      assert.ok(records.models.some(row => row.modelRecordId === "retry-success"));
      assert.ok(records.models.some(row => row.modelRecordId === "after-denial"));
      assert.equal(records.models.some(row => row.modelRecordId === "retry-denied"), false);
    } finally {replaced.mock.restore(); syncBuiltinESMExports();}
  });
});

test("legacy Model publication does not retry non-sharing failures or damage the saved registry", async context => {
  for (const code of ["EIO", "ENOENT"]) await withRegistry(async ({adapter, filePath}) => {
    const rename = fsPromises.rename, before = await readFile(filePath); let attempts = 0;
    const replaced = context.mock.method(fsPromises, "rename", async (from: Parameters<typeof rename>[0], to: Parameters<typeof rename>[1]) => {
      if (resolve(String(to)) === filePath) {
        attempts++; throw Object.assign(new Error("Synthetic non-sharing publication failure."), {code});
      }
      return rename(from, to);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(adapter.saveModelReference({workspaceId: workspace, modelRecordId: "not-saved", provider: "huggingface",
        modelId: "synthetic/not-saved"}), {code});
      assert.equal(attempts, 1); assert.deepEqual(await readFile(filePath), before);
      assert.deepEqual(await readdir(dirname(filePath)), ["models.json"]);
    } finally {replaced.mock.restore(); syncBuiltinESMExports();}
    await adapter.saveModelReference({workspaceId: workspace, modelRecordId: "recovered", provider: "huggingface", modelId: "synthetic/recovered"});
    assert.ok((await adapter.listModels(query({limit: 20}))).models.some(row => row.modelRecordId === "recovered"));
  });
});
