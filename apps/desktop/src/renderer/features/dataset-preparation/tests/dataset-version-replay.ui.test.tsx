// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DATASET_PREPARATION_TASK_TYPES } from "../../../../../../../modules/contracts/runtime";
import { useDatasetPreparationFeature, resetDatasetPreparationPageStateForTests } from "../hooks/useDatasetPreparationFeature";
import { datasetVersionReplayFixture } from "./datasetVersionReplayFixture";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement, feature!: ReturnType<typeof useDatasetPreparationFeature>;
function Probe({ client, workspaceId }: { client: any; workspaceId: string }) {
  feature = useDatasetPreparationFeature({ client, workspaceId }); return null;
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; resetDatasetPreparationPageStateForTests(); vi.clearAllMocks(); });
async function render(client: any, workspaceId = "workspace-a") {
  // Simulated exact-source seam for hook-only fixtures. The actual key-derived
  // host implementation and capped catalogue are tested separately.
  if (!Object.hasOwn(client, "readReplaySourceArtifacts")) client.readReplaySourceArtifacts = vi.fn(async (_workspace: string, refs: { artifactId: string }[]) => feature.artifacts.filter(row => refs.some(ref => ref.artifactId === row.artifactId)));
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(<Probe client={client} workspaceId={workspaceId} />));
}
function configuration() { return Object.fromEntries(Object.entries(feature).filter(([key, value]) => typeof value !== "function" && key !== "status")); }
async function apply(fixture: ReturnType<typeof datasetVersionReplayFixture>) { let applied: boolean | undefined; await act(async () => { applied = await feature.onReuseDatasetVersion(fixture.reproduction, fixture.selection); }); return applied; }
it.each(DATASET_PREPARATION_TASK_TYPES)("replaces complete structured %s settings without dispatch or old provider consent", async taskType => {
  const f = datasetVersionReplayFixture(taskType), dispatch = vi.fn(); await render({ browseSourceArtifacts: async () => [f.source], startPrepareTrainingDataset: dispatch });
  await act(async () => { feature.setHuggingFaceDestinationEnabled(true); feature.setHuggingFaceRepository("old/private"); feature.setHuggingFaceRevision("old"); feature.setHuggingFacePathPrefix("old"); feature.setLocalDestinationEnabled(false); feature.setOutputBaseName("old"); feature.setLabelSet("old"); feature.setOcrEnabled(true); feature.setOcrLanguage("old"); });
  expect(feature.sourceLoadStatus).toBe("ready");
  expect(await apply(f)).toBe(true);
  expect(feature.taskType).toBe(taskType); expect(feature.preparationPlan?.method).toBe("validate-and-split");
  expect(feature.outputBaseName).toBe("Saved setup"); expect(feature.trainRatio).toBe("0.7"); expect(feature.validationRatio).toBe("0.2"); expect(feature.testRatio).toBe("0.1"); expect(feature.shuffle).toBe(false); expect(feature.seed).toBe("17");
  expect(feature.huggingFaceDestinationEnabled).toBe(false); expect(feature.huggingFaceRepository).toBe(""); expect(feature.huggingFaceRevision).toBe(""); expect(feature.huggingFacePathPrefix).toBe(""); expect(feature.localDestinationEnabled).toBe(true);
  expect(feature.ocrEnabled).toBe(false); expect(feature.ocrLanguage).toBe(""); expect(feature.labelSet).toBe(""); expect(feature.qualityPreset).toBe("strict"); expect(feature.requireLicenseMetadata).toBe(true); expect(feature.requireConsentMetadata).toBe(true); expect(feature.includeSourceAttribution).toBe(true);
  expect(dispatch).not.toHaveBeenCalled();
});
it.each(["pdf", "ocr"] as const)("restores complete %s settings and worker omission defaults", async kind => {
  const f = datasetVersionReplayFixture("llm-instruction", kind); await render({ browseSourceArtifacts: async () => [f.source] });
  await act(async () => { feature.setModelMemoryMode("offload-v1"); feature.setGenerationTemperature("0.9"); feature.setGenerationTopP("0.8"); feature.setGenerationMaxNewTokens("512"); feature.setBatchSize("4"); });
  expect(await apply(f)).toBe(true); expect(feature.modelMemoryMode).toBe("standard"); expect(feature.modelMemoryOverflowPolicy).toBe("none"); expect(feature.batchSize).toBe("1"); expect(feature.generationTemperature).toBe(""); expect(feature.generationTopP).toBe(""); expect(feature.generationMaxNewTokens).toBe("256"); expect(feature.failurePolicy).toBe("skip");
  expect(feature.ocrEnabled).toBe(kind === "ocr"); expect(feature.ocrLanguage).toBe(kind === "ocr" ? "en-US" : ""); expect(feature.preparationPlan?.method).toBe(kind === "ocr" ? "structure-aware" : "fixed-length");
});
it.each(["offload-v1", undefined] as const)("restores a supported model memory profile %s without inference", async memoryMode => {
  const f = datasetVersionReplayFixture("llm-instruction", "pdf"); if (memoryMode === undefined) delete f.recipe.generation.model.memoryMode; else f.recipe.generation.model.memoryMode = memoryMode;
  const dispatch = vi.fn(); await render({ browseSourceArtifacts: async () => [f.source], startPrepareTrainingDataset: dispatch });
  expect(await apply(f)).toBe(true); expect(feature.modelMemoryMode).toBe(memoryMode ?? "standard"); expect(dispatch).not.toHaveBeenCalled();
});
it.each(["missing-context", "missing-record", "foreign-workspace", "foreign-version", "foreign-file", "missing-source", "duplicate-source", "bad-profile", "unrepresentable-limit", "missing-inference"])("denies %s before changing any form setting", async mode => {
  const f = datasetVersionReplayFixture("llm-instruction", "pdf"); let rows = [f.source];
  if (mode === "missing-source") rows = []; if (mode === "duplicate-source") rows = [f.source, f.source];
  await render({ browseSourceArtifacts: async () => rows }); await act(async () => { feature.setOutputBaseName("Keep my edits"); feature.setModelMemoryMode("offload-v1"); });
  if (mode === "foreign-workspace") f.selection.workspaceId = "workspace-b";
  if (mode === "missing-record") f.selection.selectedVersion = undefined as any;
  if (mode === "foreign-version") f.reproduction.versionId = "different" as any;
  if (mode === "foreign-file") f.selection.datasetArtifactKey = "prepared/other.jsonl";
  if (mode === "bad-profile") f.recipe.generation.model.memoryMode = "offload-v99";
  if (mode === "unrepresentable-limit") f.recipe.generation.maxExamplesPerChunk = 7;
  if (mode === "missing-inference") delete f.recipe.generation.model.inferenceMode;
  const before = configuration(); let result: boolean | undefined;
  await act(async () => { result = await feature.onReuseDatasetVersion(f.reproduction, mode === "missing-context" ? undefined : f.selection); });
  expect(result).toBe(false); expect(configuration()).toEqual(before); expect(feature.status.message).toContain("unchanged");
});
it("retires an old callback after edits and accepts only one call from a committed frame", async () => {
  const f = datasetVersionReplayFixture(); await render({ browseSourceArtifacts: async () => [f.source] }); const stale = feature.onReuseDatasetVersion;
  await act(async () => feature.setOutputBaseName("Later edit")); const before = configuration();
  expect(await stale(f.reproduction, f.selection)).toBe(false); expect(configuration()).toEqual(before);
  const current = feature.onReuseDatasetVersion; await act(async () => { expect(await current(f.reproduction, f.selection)).toBe(true); expect(await current(f.reproduction, f.selection)).toBe(false); });
});
it("retires a callback when its source request is retried or the form unmounts", async () => {
  const f = datasetVersionReplayFixture(); let resolve!: (rows: any[]) => void;
  const client = { browseSourceArtifacts: vi.fn().mockResolvedValueOnce([f.source]).mockImplementation(() => new Promise<any[]>(yes => { resolve = yes; })) };
  await render(client); const stale = feature.onReuseDatasetVersion;
  await act(async () => { feature.retrySourceArtifacts(); expect(await stale(f.reproduction, f.selection)).toBe(false); });
  expect(await apply(f)).toBe(false);
  await act(async () => resolve([f.source])); const unmounted = feature.onReuseDatasetVersion;
  await act(async () => root!.unmount()); root = undefined; expect(await unmounted(f.reproduction, f.selection)).toBe(false);
});

it.each(["workspace", "client"])("retires a prior committed callback on same-instance %s replacement", async change => {
  const f = datasetVersionReplayFixture(), client = { browseSourceArtifacts: async () => [f.source] };
  await render(client); const stale = feature.onReuseDatasetVersion;
  await render(change === "client" ? { browseSourceArtifacts: async () => [f.source] } : client, change === "workspace" ? "workspace-b" : "workspace-a");
  const before = configuration(), status = feature.status;
  expect(await stale(f.reproduction, f.selection)).toBe(false); expect(configuration()).toEqual(before); expect(feature.status).toBe(status);
});
it("refuses reuse during a starting task without changing its progress or configuration", async () => {
  const f = datasetVersionReplayFixture(); let finish!: (value: unknown) => void;
  const dispatch = vi.fn(() => new Promise(yes => { finish = yes; }));
  await render({ browseSourceArtifacts: async () => [f.source], startPrepareTrainingDataset: dispatch });
  expect(await apply(f)).toBe(true); let pending!: Promise<void>;
  const beforeStart = feature.onReuseDatasetVersion;
  await act(async () => { pending = feature.onSubmit({ preventDefault() {} } as any); expect(await beforeStart(f.reproduction, f.selection)).toBe(false); });
  expect(dispatch).toHaveBeenCalledTimes(1); expect(feature.status.kind).toBe("loading");
  const before = configuration(), status = feature.status;
  expect(await apply(f)).toBe(false); expect(feature.status).toBe(status); expect(configuration()).toEqual(before);
  await act(async () => { finish({ error: { code: "validation_failed", message: "Synthetic fixture completed." } }); await pending; });
});
it("preserves complete classification choices and custom generation parameters", async () => {
  const f = datasetVersionReplayFixture("llm-classification", "pdf");
  f.recipe.task.labelSet = ["positive", "negative"]; f.recipe.task.multiLabel = true;
  f.recipe.generation.generationParams = { temperature: 0.4, topP: 0.8, maxNewTokens: 300 }; f.recipe.generation.batchSize = 2; f.recipe.generation.failurePolicy = "fail";
  await render({ browseSourceArtifacts: async () => [f.source] }); expect(await apply(f)).toBe(true);
  expect(feature.labelSet).toBe("positive, negative"); expect(feature.multiLabel).toBe(true); expect(feature.generationTemperature).toBe("0.4"); expect(feature.generationTopP).toBe("0.8"); expect(feature.generationMaxNewTokens).toBe("300"); expect(feature.batchSize).toBe("2"); expect(feature.failurePolicy).toBe("fail");
});

it("restores from a complete catalogue above256 unrelated files without dispatch", async () => {
  const f = datasetVersionReplayFixture(), dispatch = vi.fn();
  const rows = [...Array.from({ length: 300 }, (_, index) => ({ ...f.source, artifactId: `other-${index}` })), f.source];
  await render({ browseSourceArtifacts: async () => rows, startPrepareTrainingDataset: dispatch });
  expect(await apply(f)).toBe(true); expect(feature.outputBaseName).toBe("Saved setup"); expect(feature.selectedArtifactIds).toEqual([f.source.artifactId]);
  expect(dispatch).not.toHaveBeenCalled();
});
it.each(["same", "wrong-key", "incompatible"])("denies a late %s matching duplicate in a large catalogue before any settings change", async kind => {
  const f = datasetVersionReplayFixture(), duplicate = { ...f.source }, dispatch = vi.fn();
  if (kind === "wrong-key") duplicate.storageKey = "other/examples.csv";
  if (kind === "incompatible") { duplicate.label = "other.bin"; duplicate.mediaType = "application/octet-stream"; }
  const rows = [f.source, ...Array.from({ length: 300 }, (_, index) => ({ ...f.source, artifactId: `other-${index}` })), duplicate];
  await render({ browseSourceArtifacts: async () => rows, startPrepareTrainingDataset: dispatch });
  await act(async () => feature.setOutputBaseName("Keep edits")); const before = configuration();
  expect(await apply(f)).toBe(false); expect(configuration()).toEqual(before); expect(dispatch).not.toHaveBeenCalled();
});
it("adds a resolved saved source beyond a capped browse only with the complete validated settings", async () => {
  const f = datasetVersionReplayFixture(), dispatch = vi.fn(), read = vi.fn(async () => [f.source]);
  const rows = Array.from({ length: 250 }, (_, index) => ({ ...f.source, artifactId: `other-${index}` }));
  await render({ browseSourceArtifacts: async () => rows, readReplaySourceArtifacts: read, startPrepareTrainingDataset: dispatch });
  expect(feature.allArtifactCount).toBe(250); expect(await apply(f)).toBe(true);
  expect(feature.allArtifactCount).toBe(251); expect(feature.selectedArtifactIds).toEqual([f.source.artifactId]); expect(dispatch).not.toHaveBeenCalled();
  expect(read.mock.calls).toHaveLength(1);
});
it("does not merge privately resolved source options when the saved recipe cannot be represented", async () => {
  const f = datasetVersionReplayFixture("llm-instruction", "pdf"); f.recipe.generation.maxExamplesPerChunk = 7;
  await render({ browseSourceArtifacts: async () => [], readReplaySourceArtifacts: async () => [f.source] });
  await act(async () => feature.setOutputBaseName("Keep edits")); const before = configuration();
  expect(await apply(f)).toBe(false); expect(configuration()).toEqual(before); expect(feature.allArtifactCount).toBe(0);
});
it("captures caller-owned reproduction and selection before an awaited lookup", async () => {
  const f = datasetVersionReplayFixture(); let resolve!: (rows: any[]) => void, pending!: Promise<boolean>;
  await render({ browseSourceArtifacts: async () => [f.source], readReplaySourceArtifacts: () => new Promise<any[]>(yes => { resolve = yes; }) });
  await act(async () => { pending = feature.onReuseDatasetVersion(f.reproduction, f.selection); });
  f.snapshot.output.naming.baseName = "Caller mutation"; f.selection.datasetArtifactKey = "other/file.jsonl"; f.version.lineage.sources = [];
  await act(async () => resolve([f.source])); expect(await pending).toBe(true); expect(feature.outputBaseName).toBe("Saved setup");
});
it.each(["edit", "workspace", "client", "retry", "request", "unmount"])("an in-flight lookup cannot overwrite after %s retirement", async mode => {
  const f = datasetVersionReplayFixture(); let resolve!: (rows: any[]) => void, pending!: Promise<boolean>, requestCurrent = true;
  const client = { browseSourceArtifacts: vi.fn(async () => [f.source]), readReplaySourceArtifacts: () => new Promise<any[]>(yes => { resolve = yes; }) };
  await render(client);
  await act(async () => { pending = feature.onReuseDatasetVersion(f.reproduction, f.selection, () => requestCurrent); });
  if (mode === "edit") await act(async () => feature.setOutputBaseName("Later edits"));
  if (mode === "workspace") await render(client, "workspace-b");
  if (mode === "client") await render({ browseSourceArtifacts: async () => [f.source] });
  if (mode === "retry") await act(async () => feature.retrySourceArtifacts());
  if (mode === "request") requestCurrent = false;
  if (mode === "unmount") { await act(async () => root!.unmount()); root = undefined; }
  const before = configuration(), status = feature.status;
  await act(async () => resolve([f.source])); expect(await pending).toBe(false); expect(configuration()).toEqual(before); expect(feature.status).toBe(status);
});
it("a task started during source lookup keeps its progress and rejects the old restore", async () => {
  const f = datasetVersionReplayFixture(); let resolve!: (rows: any[]) => void, finish!: (value: any) => void, pending!: Promise<boolean>, task!: Promise<void>;
  const dispatch = vi.fn(() => new Promise<any>(yes => { finish = yes; }));
  await render({ browseSourceArtifacts: async () => [f.source], readReplaySourceArtifacts: () => new Promise<any[]>(yes => { resolve = yes; }), startPrepareTrainingDataset: dispatch });
  await act(async () => feature.onToggleArtifact(f.source.artifactId));
  await act(async () => { pending = feature.onReuseDatasetVersion(f.reproduction, f.selection); });
  await act(async () => { task = feature.onSubmit({ preventDefault() {} } as any); });
  expect(dispatch).toHaveBeenCalledTimes(1); const before = configuration(), status = feature.status;
  await act(async () => resolve([f.source])); expect(await pending).toBe(false); expect(configuration()).toEqual(before); expect(feature.status).toBe(status);
  await act(async () => { finish({ error: { code: "validation_failed", message: "Synthetic test completed" } }); await task; });
});
