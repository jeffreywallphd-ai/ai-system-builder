// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { DatasetPreparationFeature as DesktopPreparation } from "../../../../apps/desktop/src/renderer/features/dataset-preparation/components/DatasetPreparationFeature";
import { DatasetPreparationFeature as BrowserPreparation } from "../../../../apps/thin-client/src/features/dataset-preparation/components/DatasetPreparationFeature";
import type { DesktopDatasetPreparationClient } from "../../../../apps/desktop/src/renderer/features/dataset-preparation/api/desktopDatasetPreparationClient";
import type { ApiDatasetPreparationClient } from "../../../../apps/thin-client/src/features/dataset-preparation/api/apiDatasetPreparationClient";
import type { DesktopApplicationSettingsClient } from "../../../../apps/desktop/src/renderer/features/settings";
import type { DesktopModelsClient } from "../../../../apps/desktop/src/renderer/features/models/api/desktopModelsClient";
import type { ArtifactBrowserApiClient } from "../../../../apps/thin-client/src/features/artifact-browser/api/apiArtifactBrowserClient";
import { DATASET_PREPARATION_SOURCE_CAPABILITIES, type DatasetPreparationTaskType } from "../../../../modules/contracts/runtime";
import { NotificationProvider } from "../../../../modules/ui/shared/notifications/NotificationProvider";

// Configuration integration, not file decoding or model qualification. Actual
// mounted app components receive finite metadata/readiness/client fixtures.
// A fixed refusal stops each captured command before any task can be accepted.
// No real transport, provider, model, OCR, download, offload or host is invoked.
type Host = "desktop" | "browser";
const textGoals = ["llm-instruction", "llm-classification", "llm-extraction", "llm-embedding", "llm-reranker"] as const;
const imageGoals = ["diffusion-lora", "vision-classification", "vision-detection", "vision-segmentation"] as const;
const goals = [...textGoals, ...imageGoals];
const tables = [
  ["csv", "text/csv"], ["json", "application/json"],
  ["jsonl", "application/x-ndjson"], ["parquet", "application/vnd.apache.parquet"],
] as const;
const documents = [
  ["text", "text/plain", "txt"], ["markdown", "text/markdown", "md"],
  ["html", "text/html", "html"], ["pdf", "application/pdf", "pdf"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
] as const;
const pairs = [
  ...tables.flatMap(([format, media]) => goals.map(goal => ({ goal, format, media, extension: format, kind: "structured" }))),
  ...documents.flatMap(([format, media, extension]) => textGoals.map(goal => ({ goal, format, media, extension, kind: "document" }))),
  ...imageGoals.map(goal => ({ goal, format: "image", media: "image/png", extension: "png", kind: "image" })),
];
const names: Record<DatasetPreparationTaskType, string> = {
  "llm-instruction": "support-instructions", "llm-classification": "ticket-labels",
  "llm-extraction": "invoice-fields", "llm-embedding": "semantic-pairs", "llm-reranker": "search-triplets",
  "diffusion-lora": "ceramic-mug-captions", "vision-classification": "surface-defects",
  "vision-detection": "street-boxes", "vision-segmentation": "surface-masks",
};
let root: Root | undefined, container: HTMLDivElement | undefined, workspace = "", sequence = 0;
let previousAct: PropertyDescriptor | undefined;
let actEnvironmentOwned = false;
let beforeLocal: Map<string, string> | undefined, beforeSession: Map<string, string> | undefined;
const commands: Record<string, any>[] = [];
const storageEntries = (storage: Storage) => new Map(Object.keys(storage).map(key => [key, storage.getItem(key)!]));
function restoreActEnvironment() {
  if (!actEnvironmentOwned) return;
  try {
    if (previousAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
    else delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  } finally {
    actEnvironmentOwned = false;
    previousAct = undefined;
  }
}
function restoreOwned(storage: Storage, before: Map<string, string>) {
  const owned = new Set([
    `ai-system-builder.dataset-preparation.structured-output.v1:${workspace}`,
    `ai-system-builder.preparation-task.v1:${workspace}`,
  ]);
  for (const key of new Set([...Object.keys(storage), ...before.keys()])) {
    if (!owned.has(key)) expect(storage.getItem(key)).toBe(before.get(key) ?? null);
    else if (before.has(key)) storage.setItem(key, before.get(key)!);
    else storage.removeItem(key);
  }
}
afterEach(async () => {
  try {
    await act(async () => root?.unmount()); root = undefined;
    container?.remove(); container = undefined;
    if (beforeLocal) restoreOwned(localStorage, beforeLocal);
    if (beforeSession) restoreOwned(sessionStorage, beforeSession);
  } finally {
    restoreActEnvironment();
    beforeLocal = beforeSession = undefined;
    commands.length = 0;
  }
});
function control(label: string, selector = "input,select,textarea"): HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement {
  const candidates = [...container!.querySelectorAll<HTMLLabelElement>("label")].filter(value => value.textContent?.includes(label));
  const candidate = candidates.find(value => value.querySelector(selector) || value.htmlFor);
  const node = candidate?.querySelector(selector) ?? (candidate?.htmlFor ? document.getElementById(candidate.htmlFor) : undefined)
    ?? container!.querySelector(`[aria-label='${label}']`);
  if (!node) throw new Error(`Missing visible control: ${label}`);
  expect(node.closest("[hidden],details:not([open])")).toBeNull();
  return node as HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;
}
function maybeControl(label: string, selector = "input,select,textarea") {
  try { return control(label, selector); } catch { return undefined; }
}
function button(label: string) {
  const node = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.trim() === label);
  if (!node) throw new Error(`Missing button: ${label}`); return node;
}
function change(node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
async function revealControls() {
  // Open actual parent controls in visible order. Never interact through a
  // hidden ancestor merely because jsdom allows programmatic clicks there.
  for (let index = 0; index < 24; index++) {
    const toggle = [...container!.querySelectorAll<HTMLButtonElement>("button.ui-panel__toggle[aria-expanded='false']")].find(node => !node.closest("[hidden],details:not([open])"));
    const summary = [...container!.querySelectorAll<HTMLElement>("details:not([open]) > summary")].find(node => !node.parentElement!.parentElement!.closest("[hidden],details:not([open])"));
    if (toggle) await act(async () => toggle.click());
    else if (summary) await act(async () => summary.click());
    else return;
  }
  throw new Error("Synthetic control-reveal bound exceeded.");
}
async function mount(host: Host, goal: DatasetPreparationTaskType, extension: string, mediaType: string, count = 1) {
  workspace = `workspace.dataset-variants-${++sequence}`;
  beforeLocal = storageEntries(localStorage); beforeSession = storageEntries(sessionStorage);
  previousAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  actEnvironmentOwned = true;
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
  const artifacts = Array.from({ length: count }, (_, index) => ({ artifactId: `source-${index + 1}`, storageKey: `uploads/${names[goal]}-${index + 1}.${extension}`, originalName: `${names[goal]}-${index + 1}.${extension}`, mediaType, sourceKind: "upload", artifactFamily: "dataset" }));
  const capture = (command: object) => { commands.push(JSON.parse(JSON.stringify(command))); expect(commands.length).toBeLessThanOrEqual(2); };
  const refused = async () => { throw new Error("Synthetic unused action is disabled."); };
  const desktop: DesktopDatasetPreparationClient = {
    browseSourceArtifacts: async () => artifacts.map(value => ({ ...value, label: value.originalName })),
    startPrepareTrainingDataset: async input => { capture(input); return { error: { code: "invalid_data", message: "Synthetic command captured. No task was started." } }; },
    readPrepareTrainingDatasetTask: refused, cancelPrepareTrainingDatasetTask: refused, approvePreparedTrainingDataset: refused,
  };
  const browser: ApiDatasetPreparationClient = {
    start: async input => { expect(input.workspaceId).toBe(workspace); capture(input.command); throw new Error("Synthetic command captured. No task was started."); },
    read: refused, cancel: refused, approve: refused, readPreparedReviewPage: refused,
  };
  // Only finite stored settings are available. No app credential or runtime is read.
  const settings = { readSettings: async () => ({ values: [] }), resolveModelDefault: async () => ({ resolved: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct", inferenceMode: "text2text", source: "global", device: "cpu" } }), listDefinitions: refused, updateSetting: refused, clearSetting: refused } as unknown as DesktopApplicationSettingsClient;
  const models = { listModels: async () => [], downloadModel: refused } as unknown as DesktopModelsClient;
  const runtime = { readStatus: refused, controlRuntime: refused };
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root!.render(<NotificationProvider>{host === "desktop"
    ? <DesktopPreparation workspaceId={workspace} client={desktop} settingsClient={settings} modelsClient={models} runtimeStatusClient={runtime} />
    : <BrowserPreparation workspaceId={workspace} artifactClient={{ browseArtifacts: async () => artifacts } as unknown as ArtifactBrowserApiClient} preparationClient={browser} />}</NotificationProvider>));
  await revealControls();
  await act(async () => change(control(host === "desktop" ? "Training task" : "Training goal", "select"), goal));
  await revealControls();
  for (const artifact of artifacts) {
    const source = maybeControl(artifact.originalName, "input[type='checkbox']");
    if (source && !source.disabled) await act(async () => source.click());
  }
  await revealControls();
  return artifacts;
}
async function setTaskChoices(goal: DatasetPreparationTaskType, host: Host) {
  await revealControls();
  await act(async () => {
    if (goal === "llm-classification" || goal.startsWith("vision-")) change(control("Allowed labels", "input"), "normal, damaged");
    if (goal === "llm-classification") control("Allow more than one label", "input").click();
    if (goal === "llm-extraction") control(host === "desktop" ? "Keep extracted fields strict" : "Require every extracted result", "input").click();
    if (goal === "diffusion-lora") {
      change(control(host === "desktop" ? "Concept kind" : "What the images teach", "select"), "style");
      change(control(host === "desktop" ? "Trigger token" : "Optional trigger word", "input"), " mug-token ");
      change(control(host === "desktop" ? "Regularization class" : "Optional general class", "input"), " ceramic mug ");
    }
    if (goal === "vision-detection") change(control("Box format", "select"), "xyxy");
    if (goal === "vision-segmentation") change(control("Mask format", "select"), "coco-rle");
  });
}
function checkTask(task: Record<string, unknown>, goal: DatasetPreparationTaskType) {
  expect(task.taskType).toBe(goal);
  if (goal === "llm-classification" || goal.startsWith("vision-")) expect(task.labelSet).toEqual(["normal", "damaged"]);
  else expect(task.labelSet).toBeUndefined();
  if (goal === "llm-classification") expect(task.multiLabel).toBe(true); else expect(task.multiLabel).toBeUndefined();
  if (goal === "llm-extraction") expect(task.strictSchema).toBe(false); else expect(task.strictSchema).toBeUndefined();
  if (goal === "diffusion-lora") expect(task).toMatchObject({ conceptKind: "style", triggerToken: "mug-token", regularizationClass: "ceramic mug" });
  else for (const key of ["conceptKind", "triggerToken", "regularizationClass"]) expect(task[key]).toBeUndefined();
  if (goal === "vision-detection") expect(task.boxFormat).toBe("xyxy"); else expect(task.boxFormat).toBeUndefined();
  if (goal === "vision-segmentation") expect(task.maskFormat).toBe("coco-rle"); else expect(task.maskFormat).toBeUndefined();
}
it("keeps the explicit UI inventory aligned with all 65 registry-supported goal and format pairs", () => {
  expect(pairs.length).toBe(65);
  expect(pairs.map(value => `${value.goal}:${value.format}`).sort()).toEqual(DATASET_PREPARATION_SOURCE_CAPABILITIES.flatMap(value => value.taskTypes.map(goal => `${goal}:${value.format}`)).sort());
});
it("preserves an ambient act descriptor when a case never mounted the UI", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  const ambient = { value: false, configurable: true, enumerable: false, writable: true };
  try {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", ambient);
    restoreActEnvironment();
    expect(Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT")).toEqual(ambient);
  } finally {
    if (original) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", original);
    else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
for (const host of ["desktop", "browser"] as const) {
  for (const pair of pairs) it(`${host} preserves ${pair.goal} choices for ${pair.format} source material`, async () => {
    const artifacts = await mount(host, pair.goal, pair.extension, pair.media);
    await setTaskChoices(pair.goal, host);
    const submit = button("Run checks and prepare"); expect(submit.disabled).toBe(false);
    await act(async () => submit.click());
    expect(commands.length).toBe(1);
    const command = commands[0]!;
    expect(command.sourceArtifactIds).toEqual(artifacts.map(value => value.artifactId));
    checkTask(command.recipe.task, pair.goal);
    const generation = pair.kind === "document" ? "task-examples" : "none";
    const method = pair.kind === "structured" ? "validate-and-split" : pair.kind === "document" ? "topic-aware" : pair.goal === "vision-detection" || pair.goal === "vision-segmentation" ? "use-existing-annotations" : "use-source-metadata";
    expect(command.preparation).toEqual({ schemaVersion: "1", inputIntent: pair.kind === "structured" ? "use-existing-dataset" : "create-from-source-material", method, sourceKinds: [pair.kind], generationMode: generation });
    expect(command.recipe.task.textInputMode).toBe(generation === "none" ? "provided" : "generate");
    if (generation === "none") expect(command.recipe.generation).toBeUndefined();
    else expect(command.recipe.generation.model.provider).toBe("transformers");
    expect(command.quality.reviewRequired).toBe(true);
    expect(command.split).toMatchObject({ trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, shuffle: true });
    expect(container!.textContent).not.toContain("Dataset ready");
    expect(commands.length).toBe(1);
  });
  for (const goal of goals) it(`${host} combines two ${goal} datasets without source conversion or generation`, async () => {
    const artifacts = await mount(host, goal, "jsonl", "application/x-ndjson", 2);
    await setTaskChoices(goal, host);
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(1);
    expect(commands[0]!.sourceArtifactIds).toEqual(artifacts.map(value => value.artifactId));
    expect(commands[0]!.preparation).toEqual({ schemaVersion: "1", inputIntent: "combine-existing-datasets", method: "combine-and-split", sourceKinds: ["structured"], generationMode: "none" });
    checkTask(commands[0]!.recipe.task, goal);
    for (const key of ["normalization", "chunking", "generation"]) expect(commands[0]!.recipe[key]).toBeUndefined();
    expect(commands[0]!.advanced).toBeUndefined();
  });
  const incompatible = [
    ...documents.flatMap(([format, media, extension]) => imageGoals.map(goal => ({ goal, format, media, extension }))),
    ...textGoals.map(goal => ({ goal, format: "image", media: "image/png", extension: "png" })),
    ...["xlsx", "doc"].map(extension => ({ goal: "llm-instruction" as const, format: extension, extension, media: "application/octet-stream" })),
  ];
  for (const pair of incompatible) it(`${host} refuses incompatible ${pair.goal} with ${pair.format} before task dispatch`, async () => {
    await mount(host, pair.goal, pair.extension, pair.media);
    expect(button("Run checks and prepare").disabled).toBe(true);
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(0);
  });
  for (const goal of textGoals) for (const method of ["fixed-length", "structure-aware"] as const) it(`${host} applies ${method} to ${goal} with only active division controls`, async () => {
    await mount(host, goal, "md", "text/markdown"); await setTaskChoices(goal, host);
    await act(async () => change(control(host === "desktop" ? "How should the source material be divided?" : "Preparation method", "select"), method));
    await revealControls();
    if (method === "fixed-length") {
      await act(async () => {
        change(control("Section length", "input"), "600");
        change(control(host === "desktop" ? "Section overlap" : "Overlap between sections", "input"), "40");
      });
      expect(maybeControl("Maximum section length", "input")).toBeUndefined();
      expect(maybeControl(host === "desktop" ? "Topic change sensitivity" : "Topic-change sensitivity", "input")).toBeUndefined();
    } else {
      await act(async () => {
        change(control("Maximum section length", "input"), "240");
        change(control("Maximum source sections", "input"), "20");
      });
      expect(maybeControl(host === "desktop" ? "Section overlap" : "Overlap between sections", "input")).toBeUndefined();
      expect(maybeControl(host === "desktop" ? "Topic change sensitivity" : "Topic-change sensitivity", "input")).toBeUndefined();
    }
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(1); const command = commands[0]!;
    expect(command.preparation.method).toBe(method); checkTask(command.recipe.task, goal);
    if (method === "fixed-length") {
      expect(command.recipe.chunking).toMatchObject({ strategy: "character", chunkSize: 600, chunkOverlap: 40 });
      expect(command.advanced).toBeUndefined();
    } else {
      expect(command.recipe.chunking).toBeUndefined();
      expect(command.advanced.content).toMatchObject({ strategy: "layout", layoutEnabled: true, maxTokensPerChunk: 240, maxSourceSpans: 20, ocrEnabled: false });
      expect(command.advanced.content.semanticBoundaryThreshold).toBeUndefined();
    }
  });
  for (const goal of ["diffusion-lora", "vision-classification"] as const) it(`${host} keeps explicit model choices only while ${goal} uses model-assisted metadata`, async () => {
    await mount(host, goal, "png", "image/png"); await setTaskChoices(goal, host);
    const method = control(host === "desktop" ? "How should the source material be divided?" : "Preparation method", "select");
    await act(async () => change(method, "model-assisted-metadata"));
    await revealControls();
    await act(async () => {
      change(control(host === "desktop" ? "Model ID" : "Local generation model", "input"), "Qwen/Qwen2.5-1.5B-Instruct");
      change(control("Model device", "select"), "cpu");
      change(control("Torch dtype", "select"), "bfloat16");
    });
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(1); checkTask(commands[0]!.recipe.task, goal);
    expect(commands[0]!.preparation.generationMode).toBe("metadata-text");
    expect(commands[0]!.recipe.generation.model).toMatchObject({ modelId: "Qwen/Qwen2.5-1.5B-Instruct", device: "cpu", torchDtype: "bfloat16" });
    await act(async () => change(method, "use-source-metadata"));
    expect(maybeControl(host === "desktop" ? "Model ID" : "Local generation model", "input")).toBeUndefined();
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(2); expect(commands[1]!.recipe.generation).toBeUndefined();
    expect(commands[1]!.preparation.generationMode).toBe("none");
  });
  it(`${host} refuses invalid split shares and accepts the corrected configuration`, async () => {
    await mount(host, "llm-classification", "csv", "text/csv"); await setTaskChoices("llm-classification", host);
    await act(async () => change(control(host === "desktop" ? "Train ratio" : "Training share", "input"), "0.95"));
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(0);
    expect(container!.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => change(control(host === "desktop" ? "Train ratio" : "Training share", "input"), "0.8"));
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(1); expect(commands[0]!.split).toMatchObject({ trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1 });
  });
  it(`${host} excludes invalid fixed-length values after switching to topic-aware preparation`, async () => {
    await mount(host, "llm-instruction", "md", "text/markdown");
    const method = control(host === "desktop" ? "How should the source material be divided?" : "Preparation method", "select");
    await act(async () => change(method, "fixed-length"));
    await revealControls();
    await act(async () => change(control("Section length", "input"), "not-a-number"));
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(0);
    await act(async () => change(method, "topic-aware"));
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(1); expect(commands[0]!.recipe.chunking).toBeUndefined();
    expect(commands[0]!.preparation.method).toBe("topic-aware");
    expect(JSON.stringify(commands[0]!)).not.toContain("not-a-number");
  });
  it(`${host} removes old task-specific labels when changing to instruction training`, async () => {
    const artifacts = await mount(host, "llm-classification", "jsonl", "application/x-ndjson"); await setTaskChoices("llm-classification", host);
    await act(async () => change(control(host === "desktop" ? "Training task" : "Training goal", "select"), "llm-instruction"));
    await revealControls();
    if (host === "browser") {
      expect(button("Run checks and prepare").disabled).toBe(true);
      await act(async () => control(artifacts[0]!.originalName, "input[type='checkbox']").click());
    }
    expect(maybeControl("Allowed labels", "input")).toBeUndefined();
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(1); checkTask(commands[0]!.recipe.task, "llm-instruction");
  });
  for (const format of host === "desktop" ? ["parquet", "jsonl", "json", "csv"] : ["parquet", "jsonl"]) it(`${host} retains its supported ${format} output format`, async () => {
    await mount(host, "llm-classification", "csv", "text/csv"); await setTaskChoices("llm-classification", host);
    await act(async () => change(control(host === "desktop" ? "Output format" : "Saved file format", "select"), format));
    await act(async () => button("Run checks and prepare").click());
    expect(commands.length).toBe(1); expect(commands[0]!.output.format).toBe(format);
    checkTask(commands[0]!.recipe.task, "llm-classification");
  });
}
