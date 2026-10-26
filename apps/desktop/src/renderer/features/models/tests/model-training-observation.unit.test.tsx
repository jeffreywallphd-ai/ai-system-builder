// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useModelTrainingFeature } from "../hooks/useModelTrainingFeature";
import { TrainModelTab } from "../components/TrainModelTab";
import type { DesktopModelsClient } from "../api/desktopModelsClient";
import type { DesktopModelTrainingResult } from "../../../lib/desktopApi";
import { NotificationTestHarness, readNotificationMessages } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { TaskObservationProvider, useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";

vi.mock("../../settings/components/SettingsPanel", () => ({ SettingsPanel: () => null }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let container: HTMLDivElement | undefined;
beforeEach(() => { (window as any).desktopApi = {}; });
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); sessionStorage.clear(); root = undefined; vi.restoreAllMocks(); });

function Probe({ client, workspaceId }: { client: any; workspaceId: string }) {
  const view = useModelTrainingFeature(client, workspaceId);
  return <output>{view.result?.runId ?? "none"}:{view.message}</output>;
}
function mount(client: any, workspaceId: string) {
  container ??= document.createElement("div"); document.body.appendChild(container);
  root ??= createRoot(container);
  return <Probe client={client} workspaceId={workspaceId} />;
}

it("reopens a saved task identity into explicit review without publishing a model", async () => {
  sessionStorage.setItem("ai-system-builder.training-task.v1:workspace-a", "run-a");
  const client = { listModels: vi.fn(async () => []), readModelTrainingStatus: vi.fn(async () => ({ runId: "run-a", status: "succeeded", reviewPending: true })), saveModelTraining: vi.fn() };
  const probe = mount(client, "workspace-a"); await act(async () => { root!.render(probe); });
  expect(container!.textContent).toContain("run-a:Training completed. Save or discard");
  expect(client.readModelTrainingStatus).toHaveBeenCalledWith({ runId: "run-a", workspaceId: "workspace-a" });
  expect(client.saveModelTraining).not.toHaveBeenCalled();
});

it("does not publish a late task reply or reuse its ID in another workspace", async () => {
  sessionStorage.setItem("ai-system-builder.training-task.v1:workspace-a", "run-a");
  let release!: (value: any) => void;
  const pending = new Promise<DesktopModelTrainingResult>((resolve) => { release = resolve; });
  const client = { listModels: vi.fn(async () => []), readModelTrainingStatus: vi.fn<DesktopModelsClient["readModelTrainingStatus"]>(() => pending) };
  const a = mount(client, "workspace-a"); await act(async () => { root!.render(a); });
  const b = mount(client, "workspace-b"); await act(async () => { root!.render(b); });
  await act(async () => { release({ runId: "run-a", status: "succeeded", reviewPending: true }); await Promise.resolve(); });
  expect(container!.textContent).not.toContain("run-a");
  expect(client.readModelTrainingStatus.mock.calls.every(([request]) => request.workspaceId === "workspace-a")).toBe(true);
});

const baseModel = { modelRecordId: "support-base", modelId: "example/support", displayName: "Support base", provider: "huggingface" as const, source: "huggingface" as const, lifecycleStatus: "downloaded" as const, artifactForm: "full-model" as const, localPath: "synthetic-unused", inferenceMode: "causal" as const, createdAt: "2026-01-01" };
const reviewRun = (): DesktopModelTrainingResult => ({ runId: "run-a", status: "succeeded", reviewPending: true });
const savedRun = (): DesktopModelTrainingResult => ({ runId: "run-a", status: "succeeded", reviewPending: false, outputModel: { ...baseModel, modelRecordId: "trained-support", source: "generated", lifecycleStatus: "generated" } });
function deferred<Value>() { let resolve!: (value: Value) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<Value>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function trainingClient(overrides: Partial<DesktopModelsClient> = {}): DesktopModelsClient {
  return { listModels: vi.fn(async () => [baseModel]), trainModel: vi.fn<DesktopModelsClient["trainModel"]>(async () => reviewRun()), readModelTrainingStatus: vi.fn<DesktopModelsClient["readModelTrainingStatus"]>(async () => reviewRun()), saveModelTraining: vi.fn<DesktopModelsClient["saveModelTraining"]>(async () => savedRun()), discardModelTraining: vi.fn<DesktopModelsClient["discardModelTraining"]>(async () => ({ runId: "run-a", status: "cancelled" })), cancelModelTraining: vi.fn<DesktopModelsClient["cancelModelTraining"]>(async () => ({ runId: "run-a", status: "cancelled" })), ...overrides } as DesktopModelsClient;
}
let training: ReturnType<typeof useModelTrainingFeature>;
let trainingObserver: ReturnType<typeof useTaskObservationManager>;
function TrainingProbe({ client, workspace = "workspace-a" }: { client: DesktopModelsClient; workspace?: string }) {
  trainingObserver = useTaskObservationManager();
  training = useModelTrainingFeature(client, workspace);
  return <NotificationTestHarness><TrainModelTab state={training} /></NotificationTestHarness>;
}
function TrainingShell(props: { client: DesktopModelsClient; workspace?: string }) { return <TaskObservationProvider><TrainingProbe {...props}/></TaskObservationProvider>; }
async function mountTraining(client: DesktopModelsClient) {
  (window as any).desktopApi = {
    readApplicationSettings: async () => ({ ok: true, value: { values: [] } }),
    readPythonRuntimeStatus: async () => ({ ok: true, value: { healthy: true, activeTaskCount: 0 } }),
    browseArtifacts: vi.fn(async () => ({ ok: true, value: [
      { artifactId: "support-train", storageKey: "datasets/support-train.parquet", originalName: "support-train.parquet", artifactFamily: "dataset", mediaType: "application/vnd.apache.parquet" },
      { artifactId: "support-validation", storageKey: "datasets/support-validation.jsonl", originalName: "support-validation.jsonl", artifactFamily: "dataset", mediaType: "application/x-ndjson" },
    ] })),
  };
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root!.render(<TrainingShell client={client} />); await new Promise(done => setTimeout(done, 0)); });
}
function trainingButton(label: string) { const value = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label); expect(value).toBeTruthy(); return value!; }
function trainingField(label: string, selector: string) { const value = [...container!.querySelectorAll("label")].find(element => element.textContent?.includes(label))?.querySelector(selector); expect(value).toBeTruthy(); return value as HTMLInputElement & HTMLSelectElement; }
function changeTraining(field: HTMLInputElement | HTMLSelectElement, value: string) { const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }
async function selectTrainingInputs() { await act(async () => container!.querySelectorAll<HTMLInputElement>('input[name="training-dataset"]').forEach(input => input.click())); }

it.each(["llm-instruction", "llm-classification", "llm-extraction", "llm-embedding", "llm-reranker", "diffusion-lora", "vision-classification", "vision-detection", "vision-segmentation"] as const)("builds a two-dataset %s training request from the actual form", async task => {
  const client = trainingClient(); await mountTraining(client); await selectTrainingInputs();
  await act(async () => changeTraining(trainingField("Training task", "select"), task));
  expect(client.trainModel).not.toHaveBeenCalled();
  expect(trainingButton("Start Training").disabled).toBe(false);
  await act(async () => trainingButton("Start Training").click());
  expect(client.trainModel).toHaveBeenCalledTimes(1);
  expect(client.trainModel).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-a", trainingTask: task, baseModel: { modelRecordId: "support-base" }, datasets: [{ artifactId: "support-train", splitRole: "train", format: "parquet" }, { artifactId: "support-validation", splitRole: "validation", format: "jsonl" }], method: "lora", output: expect.objectContaining({ destination: { local: { enabled: true }, huggingFace: undefined }, registration: expect.objectContaining({ artifactForm: "adapter" }) }), validation: { enabled: true, expectedLoRA: true } }));
  expect(trainingButton("Save model")).toBeTruthy(); expect(client.saveModelTraining).not.toHaveBeenCalled();
});

it("preserves explicit zero seed and LoRA dropout", async () => {
  const client = trainingClient(); await mountTraining(client); await selectTrainingInputs();
  await act(async () => { training.setSeed("0"); training.setLoraDropout("0"); });
  await act(async () => trainingButton("Start Training").click());
  expect(client.trainModel).toHaveBeenCalledWith(expect.objectContaining({ commonParameters: expect.objectContaining({ seed: 0 }), advancedParameters: expect.objectContaining({ lora: expect.objectContaining({ dropout: 0 }) }) }));
});

it("admits one start before its busy render", async () => {
  const pending = deferred<DesktopModelTrainingResult>(), client = trainingClient({ trainModel: vi.fn(async () => pending.promise) }); await mountTraining(client); await selectTrainingInputs();
  try { await act(async () => { const start = trainingButton("Start Training"); start.click(); start.click(); }); expect(client.trainModel).toHaveBeenCalledTimes(1); }
  finally { await act(async () => pending.resolve(reviewRun())); }
});

it.each(["save", "discard"] as const)("admits one %s while review is pending", async action => {
  const pending = deferred<DesktopModelTrainingResult>(); const client = trainingClient({ saveModelTraining: vi.fn(async () => pending.promise), discardModelTraining: vi.fn(async () => pending.promise) });
  await mountTraining(client); await selectTrainingInputs(); await act(async () => trainingButton("Start Training").click());
  try { await act(async () => { const target = trainingButton(action === "save" ? "Save model" : "Discard model"); target.click(); target.click(); }); expect(action === "save" ? client.saveModelTraining : client.discardModelTraining).toHaveBeenCalledTimes(1); }
  finally { await act(async () => pending.resolve(action === "save" ? savedRun() : { runId: "run-a", status: "cancelled" })); }
});

it.each(["save", "discard"] as const)("retains review after foreign %s acknowledgement", async action => {
  const client = trainingClient({ saveModelTraining: vi.fn(async () => ({ ...savedRun(), runId: "foreign-run" })), discardModelTraining: vi.fn<DesktopModelsClient["discardModelTraining"]>(async () => ({ runId: "foreign-run", status: "cancelled" })) });
  await mountTraining(client); await selectTrainingInputs(); await act(async () => trainingButton("Start Training").click());
  await act(async () => trainingButton(action === "save" ? "Save model" : "Discard model").click());
  expect(training.result?.runId).toBe("run-a"); expect(training.result?.reviewPending).toBe(true); expect(training.canSubmit).toBe(false);
});

it("does not save an old review through a replaced client", async () => {
  const pending = deferred<DesktopModelTrainingResult>(), client = trainingClient({ saveModelTraining: vi.fn(async () => pending.promise) }), next = trainingClient();
  await mountTraining(client); await selectTrainingInputs(); await act(async () => trainingButton("Start Training").click()); await act(async () => trainingButton("Save model").click());
  await act(async () => root!.render(<TrainingShell client={next} />)); const before = vi.mocked(client.listModels).mock.calls.length;
  await act(async () => pending.resolve(savedRun())); expect(client.listModels).toHaveBeenCalledTimes(before); expect(training.result?.outputModel).toBeUndefined();
});

it("routes a safe training failure to Notifications without an inline error", async () => {
  const client = trainingClient({ trainModel: vi.fn(async () => { throw new Error("private-training-payload"); }) }); await mountTraining(client); await selectTrainingInputs(); await act(async () => trainingButton("Start Training").click());
  expect(readNotificationMessages(container!)).toEqual(expect.arrayContaining([expect.stringContaining("Training could not start")]));
  expect(container!.querySelector('[role="alert"]')).toBeNull(); expect(container!.textContent).not.toContain("private-training-payload");
});

it.each(["save", "discard"] as const)("retains review after nonterminal %s acknowledgement",async action=>{
  const unconfirmed:DesktopModelTrainingResult={runId:"run-a",status:"running"};const client=trainingClient({saveModelTraining:vi.fn(async()=>unconfirmed),discardModelTraining:vi.fn(async()=>unconfirmed)});
  await mountTraining(client);await selectTrainingInputs();await act(async()=>trainingButton("Start Training").click());await act(async()=>trainingButton(action==="save"?"Save model":"Discard model").click());
  expect(training.result?.reviewPending).toBe(true);expect(training.canSubmit).toBe(false);expect(trainingButton("Save model")).toBeTruthy();
});

it("retains review when a successful save has no registered output model",async()=>{
  const client=trainingClient({saveModelTraining:vi.fn<DesktopModelsClient["saveModelTraining"]>(async()=>({runId:"run-a",status:"succeeded",reviewPending:false}))});
  await mountTraining(client);await selectTrainingInputs();await act(async()=>trainingButton("Start Training").click());await act(async()=>trainingButton("Save model").click());expect(training.result?.reviewPending).toBe(true);
});

it("keeps a confirmed saved model successful if the inventory refresh fails",async()=>{
  let saved=false;const client=trainingClient({saveModelTraining:vi.fn(async()=>{saved=true;return savedRun();}),listModels:vi.fn(async()=>{if(saved)throw new Error("private-list-payload");return[baseModel];})});
  await mountTraining(client);await selectTrainingInputs();await act(async()=>trainingButton("Start Training").click());await act(async()=>trainingButton("Save model").click());
  expect(training.status).toBe("succeeded");expect(training.result?.outputModel?.modelRecordId).toBe("trained-support");expect(training.result?.reviewPending).toBe(false);expect(training.message).toContain("saved");expect(training.message).not.toContain("private-list-payload");
});

it("keeps observing a recovered task when a status reply names another run",async()=>{
  sessionStorage.setItem("ai-system-builder.training-task.v1:workspace-a","run-a");const client=trainingClient({readModelTrainingStatus:vi.fn(async()=>({...reviewRun(),runId:"foreign-run"}))});
  await mountTraining(client);expect(training.result).toBeUndefined();expect(training.canSubmit).toBe(false);expect(training.canStopTraining).toBe(true);expect(client.saveModelTraining).not.toHaveBeenCalled();
});

it("admits one stop request and retains a task after a foreign cancellation",async()=>{
  sessionStorage.setItem("ai-system-builder.training-task.v1:workspace-a","run-a");const pending=deferred<DesktopModelTrainingResult>();
  const client=trainingClient({readModelTrainingStatus:vi.fn<DesktopModelsClient["readModelTrainingStatus"]>(async()=>({runId:"run-a",status:"running"})),cancelModelTraining:vi.fn(async()=>pending.promise)});
  await mountTraining(client);
  try{await act(async()=>{const stop=trainingButton("Stop training");stop.click();stop.click();});expect(client.cancelModelTraining).toHaveBeenCalledTimes(1);}
  finally{await act(async()=>pending.resolve({runId:"foreign-run",status:"cancelled"}));}
  expect(training.canStopTraining).toBe(true);expect(training.result?.runId).not.toBe("foreign-run");expect(training.canSubmit).toBe(false);
});

it("does not overwrite a newer recovery identity with a retired start reply",async()=>{
  const pending=deferred<DesktopModelTrainingResult>(),client=trainingClient({trainModel:vi.fn(async()=>pending.promise)}),next=trainingClient({trainModel:vi.fn(async()=>({...reviewRun(),runId:"run-b"}))});
  await mountTraining(client);await selectTrainingInputs();await act(async()=>trainingButton("Start Training").click());
  await act(async()=>{root!.render(<TrainingShell client={next}/>);await new Promise(done=>setTimeout(done,0));});await selectTrainingInputs();await act(async()=>trainingButton("Start Training").click());
  expect(sessionStorage.getItem("ai-system-builder.training-task.v1:workspace-a")).toBe("run-b");
  await act(async()=>pending.resolve(reviewRun()));
  expect(sessionStorage.getItem("ai-system-builder.training-task.v1:workspace-a")).toBe("run-b");expect(training.result?.runId).toBe("run-b");expect(client.cancelModelTraining).not.toHaveBeenCalled();
});

it.each(["running","rejected"] as const)("keeps a confirmed review when an older stop is %s",async resolution=>{
  sessionStorage.setItem("ai-system-builder.training-task.v1:workspace-a","run-a");let terminal=false;
  const pending=deferred<DesktopModelTrainingResult>(),client=trainingClient({readModelTrainingStatus:vi.fn<DesktopModelsClient["readModelTrainingStatus"]>(async()=>terminal?reviewRun():{runId:"run-a",status:"running"}),cancelModelTraining:vi.fn(async()=>pending.promise)});
  await mountTraining(client);await act(async()=>trainingButton("Stop training").click());
  terminal=true;await act(async()=>{trainingObserver.invalidate({workspaceId:"workspace-a",family:"model-training"});await new Promise(done=>setTimeout(done,0));});
  expect(training.result?.reviewPending).toBe(true);expect(training.status).toBe("succeeded");
  expect(trainingButton("Save model").disabled).toBe(true);
  await act(async()=>{if(resolution==="running")pending.resolve({runId:"run-a",status:"running"});else pending.reject(new Error("private-old-stop"));});
  expect(training.result?.reviewPending).toBe(true);expect(training.status).toBe("succeeded");expect(trainingButton("Save model").disabled).toBe(false);expect(training.canSubmit).toBe(false);expect(container!.textContent).not.toContain("private-old-stop");
});

it("notifies an uncertain stop without hiding active task controls",async()=>{
  sessionStorage.setItem("ai-system-builder.training-task.v1:workspace-a","run-a");const client=trainingClient({readModelTrainingStatus:vi.fn<DesktopModelsClient["readModelTrainingStatus"]>(async()=>({runId:"run-a",status:"running"})),cancelModelTraining:vi.fn(async()=>{throw new Error("private-cancel-payload");})});
  await mountTraining(client);await act(async()=>trainingButton("Stop training").click());
  expect(training.canStopTraining).toBe(true);expect(readNotificationMessages(container!)).toEqual(expect.arrayContaining([expect.stringContaining("Stop could not be confirmed")]));expect(container!.querySelector('[role="alert"]')).toBeNull();expect(container!.textContent).not.toContain("private-cancel-payload");
});
