import { useTaskObservationManager } from "../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import { BoundedTaskIds } from "../../../../../../modules/ui/shared/notifications/taskObservation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ImageGenerationRequest } from "../../../../../../modules/contracts/image-generation";
import type { ModelInventoryRecord } from "../../../../../../modules/contracts/model";
import type { RuntimeTaskRecord, RuntimeTaskStatus } from "../../../../../../modules/contracts/runtime";
import { createWorkspaceId } from "../../../../../../modules/contracts/workspace";
import {
  isImageGenerationModelCandidate,
  isImageGenerationModelReady,
  toImageGenerationModelDropdownOption,
} from "../../../../../../modules/ui/shared";
import { createApiArtifactBrowserClient, type ArtifactBrowserApiClient, type ThinClientArtifactBrowseItem } from "../../artifact-browser/api/apiArtifactBrowserClient";
import { createApiModelManagementClient, type ModelManagementApiClient } from "../../model-management/api/apiModelManagementClient";
import { createApiImageGenerationClient, type FinalizedImageAsset, type ImageGenerationApiClient } from "../api/apiImageGenerationClient";

const RESOURCE_POLL_INTERVAL_MS = 5000;
const DEFAULT_PROMPT = "raw photo quality image; 35mm camera quality image; a dog in the park";
const DEFAULT_NEGATIVE_PROMPT = "anime; cartoon; melty; blurry";
type UiStatus = "idle" | "starting" | "queued" | "running" | "succeeded" | "finalizing" | "finalized" | "failed" | "cancelled";
const ACTIVE_STATUSES: UiStatus[] = ["starting", "queued", "running", "finalizing"];

export interface ImageGenerationFormState { prompt: string; negativePrompt: string; seed: string; width: string; height: string; steps: string; cfg: string; denoise: string; sampler: string; scheduler: string; model: string; numImages: string; latentSourceArtifactId: string; faceIdEnabled: boolean; faceIdArtifactId1: string; faceIdArtifactId2: string; faceIdArtifactId3: string; faceIdIdentityStrength: string; faceIdStructureStrength: string; faceIdNoise: string; }
export type ImageGenerationRuntimeMode = "auto" | "cpu" | "cuda" | "directml";
const defaultImageGenerationClient = createApiImageGenerationClient();
const defaultModelManagementClient = createApiModelManagementClient();
const defaultArtifactBrowserClient = createApiArtifactBrowserClient();

export interface ThinClientImageGenerationSessionGeneration { id: string; requestId?: string; createdAt: string; assets: FinalizedImageAsset[]; }
interface PersistedImageGenerationState { form: ImageGenerationFormState; runtimeMode: ImageGenerationRuntimeMode; status: UiStatus; requestId?: string; error?: string; results: FinalizedImageAsset[]; sessionGallery: ThinClientImageGenerationSessionGeneration[]; }
const persistedByWorkspace = new Map<string, PersistedImageGenerationState>();
const createDefaultForm = (): ImageGenerationFormState => ({ prompt: DEFAULT_PROMPT, negativePrompt: DEFAULT_NEGATIVE_PROMPT, seed: "", width: "1024", height: "1024", steps: "20", cfg: "8", denoise: "1", sampler: "dpmpp_2m", scheduler: "karras", model: "", numImages: "1", latentSourceArtifactId: "", faceIdEnabled: false, faceIdArtifactId1: "", faceIdArtifactId2: "", faceIdArtifactId3: "", faceIdIdentityStrength: "0.85", faceIdStructureStrength: "0.75", faceIdNoise: "0.35" });

export function resetImageGenerationPersistedStateForTests(): void {
  persistedByWorkspace.clear();
  for (const key of Object.keys(sessionStorage)) if (key.startsWith("ai-system-builder.thin-image-task.v1:")) sessionStorage.removeItem(key);
}

export function isServerInventoryImageGenerationModel(model: ModelInventoryRecord): boolean {
  return isImageGenerationModelCandidate(model);
}

function rankInventoryModel(model: ModelInventoryRecord): number {
  let rank = 0;
  if (isImageGenerationModelReady(model)) rank -= 100;
  if (model.inferenceMode === "text-to-image") rank -= 20;
  if ((model.taskTags ?? []).some((tag) => tag === "text-to-image")) rank -= 10;
  if (model.artifactForm === "checkpoint") rank -= 10;
  return rank;
}

const toUiStatus = (status: RuntimeTaskStatus): UiStatus => (["queued", "running", "succeeded", "failed", "cancelled"].includes(status) ? status : "failed") as UiStatus;
const parsePositiveInt = (v: string) => { const n = Number(v); return Number.isInteger(n) && Number.isFinite(n) && n > 0 ? n : undefined; };
const parseSeed = (v: string) => { if (!v.trim()) return undefined; const n = Number(v); return Number.isSafeInteger(n) ? n : undefined; };
const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
const hasFinalizedAssets = (assets: FinalizedImageAsset[] | undefined): assets is FinalizedImageAsset[] =>
  Array.isArray(assets) && assets.length > 0 && assets.length <= 8 && assets.every((asset) =>
    asset && [asset.assetId, asset.artifactId, asset.storageKey, asset.mediaType].every((value) => typeof value === "string" && value.trim().length > 0))
  && new Set(assets.map((asset) => asset.assetId)).size === assets.length
  && new Set(assets.map((asset) => asset.artifactId)).size === assets.length;

function isUnavailableApiError(error: unknown): error is Error & { code: string; status?: number; details?: Record<string, unknown> } {
  return error instanceof Error && (error as { code?: string }).code === "unavailable";
}

function runtimeUnavailableMessage(error: Error & { details?: Record<string, unknown> }): string {
  const status = typeof error.details?.status === "string" ? error.details.status : undefined;
  const reason = error.details?.reason;
  const reasonCode = typeof reason === "object" && reason !== null && typeof (reason as { code?: unknown }).code === "string"
    ? (reason as { code: string }).code
    : undefined;
  if (status === "starting" || reasonCode?.includes("starting")) {
    return "ComfyUI is starting. Wait a moment, then generate again.";
  }
  if (status === "installing" || reasonCode?.includes("install")) {
    return "ComfyUI is setting up its runtime. Wait for setup to finish, then generate again.";
  }
  if (status === "failed") {
    return "ComfyUI is not ready. Check the server logs for the image-generation readiness failure, then try again.";
  }
  return "ComfyUI is not ready yet. Check runtime status, then try again.";
}

function taskFailureMessage(task: RuntimeTaskRecord): string {
  return "Image generation failed. Review runtime diagnostics before trying again.";
}

export function useImageGenerationFeature(
  client: ImageGenerationApiClient = defaultImageGenerationClient,
  onGenerated?: (assets: FinalizedImageAsset[]) => void,
  modelClient: ModelManagementApiClient = defaultModelManagementClient,
  artifactClient: ArtifactBrowserApiClient = defaultArtifactBrowserClient,
  workspaceId?: string,
) {
  const observer = useTaskObservationManager();
  const session = useMemo(() => ({ active: false, action: undefined as "start" | "cancel" | "unload" | undefined, finalizing: false }), [client, modelClient, artifactClient, workspaceId]);
  const [stateSession, setStateSession] = useState(session);
  const persistedState = persistedByWorkspace.get(workspaceId ?? "");
  const taskStorageKey = `ai-system-builder.thin-image-task.v1:${workspaceId ?? ""}`;
  let recoveredId: string | undefined;
  try { recoveredId = sessionStorage.getItem(taskStorageKey) ?? undefined; } catch { /* Optional recovery identity. */ }
  const [form, setForm] = useState<ImageGenerationFormState>(persistedState?.form ?? { prompt: DEFAULT_PROMPT, negativePrompt: DEFAULT_NEGATIVE_PROMPT, seed: "", width: "1024", height: "1024", steps: "20", cfg: "8", denoise: "1", sampler: "dpmpp_2m", scheduler: "karras", model: "", numImages: "1", latentSourceArtifactId: "", faceIdEnabled: false, faceIdArtifactId1: "", faceIdArtifactId2: "", faceIdArtifactId3: "", faceIdIdentityStrength: "0.85", faceIdStructureStrength: "0.75", faceIdNoise: "0.35" });
  const [runtimeMode, setRuntimeMode] = useState<ImageGenerationRuntimeMode>(persistedState?.runtimeMode ?? "auto");
  const [modelInventory, setModelInventory] = useState<ModelInventoryRecord[]>([]);
  const [modelInventoryLoading, setModelInventoryLoading] = useState(false);
  const [modelInventoryError, setModelInventoryError] = useState<string | undefined>(undefined);
  const [selectedModelRecordId, setSelectedModelRecordId] = useState<string>("");
  const [imageArtifacts, setImageArtifacts] = useState<ThinClientArtifactBrowseItem[]>([]);
  const [imageArtifactsLoading, setImageArtifactsLoading] = useState(false);
  const [imageArtifactsError, setImageArtifactsError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<UiStatus>(persistedState?.status ?? (recoveredId ? "queued" : "idle"));
  const [requestId, setRequestId] = useState<string | undefined>(persistedState?.requestId ?? recoveredId);
  const [error, setError] = useState<string | undefined>(persistedState?.error);
  const [results, setResults] = useState<FinalizedImageAsset[]>(persistedState?.results ?? []);
  const [sessionGallery, setSessionGallery] = useState<ThinClientImageGenerationSessionGeneration[]>(persistedState?.sessionGallery ?? []);
  const [hasAttemptedGeneration, setHasAttemptedGeneration] = useState(false);
  const [unloadModelState, setUnloadModelState] = useState<{ status: "idle" | "loading" | "success" | "error"; message?: string }>({ status: "idle" });
  const [runtimeResources, setRuntimeResources] = useState<{ memoryUsagePercent: number; cpuUsagePercent: number; gpuUsagePercent: number }>({ memoryUsagePercent: 0, cpuUsagePercent: 0, gpuUsagePercent: 0 });

  const stopObservationRef = useRef<(() => void) | undefined>(undefined);
  const resultsRef = useRef(results); resultsRef.current = results;
  const generatedCallbackRef = useRef(onGenerated);
  useLayoutEffect(() => { generatedCallbackRef.current = onGenerated; }, [onGenerated]);
  const activeRequestRef = useRef<string | undefined>(undefined);
  const pollRunIdRef = useRef(0);
  const finalizedByRequestRef = useRef(new BoundedTaskIds());
  const modelInventoryRequestRef = useRef(0);
  const imageArtifactsRequestRef = useRef(0);
  const displayedValidationErrorRef = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    session.active = true;
    const saved = persistedByWorkspace.get(workspaceId ?? "");
    let id: string | undefined;
    try { const stored = sessionStorage.getItem(taskStorageKey); if (stored?.trim() && stored.length <= 512) id = stored; } catch { /* Optional recovery identity. */ }
    setStateSession(session); setRequestId(id); setStatus(id ? "queued" : "idle"); setError(undefined);
    setSelectedModelRecordId(""); setModelInventory([]); setImageArtifacts([]); setHasAttemptedGeneration(false);
    setUnloadModelState({ status: "idle" });
    if (saved) { setForm(saved.form); setRuntimeMode(saved.runtimeMode); setResults(saved.results); resultsRef.current = saved.results; setSessionGallery(saved.sessionGallery); }
    else { setForm(createDefaultForm()); setRuntimeMode("auto"); setResults([]); resultsRef.current = []; setSessionGallery([]); }
    return () => { session.active = false; stopObservationRef.current?.(); pollRunIdRef.current += 1; activeRequestRef.current = undefined; modelInventoryRequestRef.current += 1; imageArtifactsRequestRef.current += 1; };
  }, [session]);

  const refreshModelInventory = useCallback(async () => {
    if (!session.active) return;
    const requestId = ++modelInventoryRequestRef.current;
    setModelInventoryLoading(true);
    setModelInventoryError(undefined);
        try {
      const result = workspaceId ? await modelClient.listModels({ workspaceId: createWorkspaceId(workspaceId) }) : { models: [] };
      if (!session.active || requestId !== modelInventoryRequestRef.current) return;
      const sorted = [...result.models].sort((a, b) => rankInventoryModel(a) - rankInventoryModel(b) || a.displayName.localeCompare(b.displayName));
      const downloadedImageModel = sorted.find((m) => isServerInventoryImageGenerationModel(m) && isImageGenerationModelReady(m));
      setModelInventory(sorted);
      setSelectedModelRecordId((current) => {
        if (current && sorted.some((m) => m.modelRecordId === current && isServerInventoryImageGenerationModel(m))) return current;
        if (downloadedImageModel) return downloadedImageModel.modelRecordId;
        return "";
      });
    } catch (e) {
      if (!session.active || requestId !== modelInventoryRequestRef.current) return;
      const message = "Failed to load model inventory. Refresh the model list.";
      setModelInventoryError(message);
    } finally {
      if (session.active && requestId === modelInventoryRequestRef.current) setModelInventoryLoading(false);
    }
  }, [modelClient, workspaceId, session]);

  useEffect(() => { void refreshModelInventory(); }, [refreshModelInventory]);

  const refreshImageArtifacts = useCallback(async () => {
    if (!session.active) return;
    const requestId = ++imageArtifactsRequestRef.current;
    setImageArtifactsLoading(true);
    setImageArtifactsError(undefined);
    try {
      const items = workspaceId ? await artifactClient.browseArtifacts({ artifactFamily: "image", workspaceId }) : [];
      if (!session.active || requestId !== imageArtifactsRequestRef.current) return;
      setImageArtifacts(items.filter((item) => item.artifactFamily === "image" || item.mediaType?.startsWith("image/")));
    } catch (cause) {
      if (!session.active || requestId !== imageArtifactsRequestRef.current) return;
      setImageArtifactsError("Failed to load image artifacts. Refresh the image list.");
    } finally {
      if (session.active && requestId === imageArtifactsRequestRef.current) setImageArtifactsLoading(false);
    }
  }, [artifactClient, workspaceId, session]);

  useEffect(() => { void refreshImageArtifacts(); }, [refreshImageArtifacts]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const pollResources = async () => {
      if (typeof client.readRuntimeResources !== "function") return;
      try {
        const snapshot = await client.readRuntimeResources();
        if (!cancelled && session.active) setRuntimeResources(snapshot);
      } catch {
        // Resource telemetry is supplementary and must not interrupt generation.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => { void pollResources(); }, RESOURCE_POLL_INTERVAL_MS);
      }
    };
    void pollResources();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [client, workspaceId, session]);

  const validationError = useMemo(() => {
    if (!form.prompt.trim()) return "Prompt is required.";
    if (form.prompt.length > 10000 || form.negativePrompt.length > 10000) return "Prompt and negative prompt must each contain at most 10,000 characters.";
    if (!parsePositiveInt(form.width) || !parsePositiveInt(form.height) || !parsePositiveInt(form.steps) || !parsePositiveInt(form.numImages)) return "Width, height, steps, and number of images must be positive integers.";
    if (Number(form.width) < 64 || Number(form.width) > 4096 || Number(form.height) < 64 || Number(form.height) > 4096 || Number(form.steps) > 200 || Number(form.numImages) > 8) return "Use dimensions from 64 to 4096, at most 200 steps and at most 8 images.";
    if (form.seed.trim() && parseSeed(form.seed) === undefined) return "Seed must be a finite integer when provided.";
    const cfg = Number(form.cfg); if (!Number.isFinite(cfg) || cfg <= 0 || cfg > 50) return "CFG must be greater than zero and at most 50.";
    const denoise = Number(form.denoise); if (!Number.isFinite(denoise) || denoise < 0 || denoise > 1) return "Denoise must be between 0 and 1.";
    if (form.faceIdEnabled) {
      if (!form.faceIdArtifactId1.trim()) return "FaceID requires at least one face reference image.";
      if (![form.faceIdIdentityStrength, form.faceIdStructureStrength, form.faceIdNoise].every((value) => value.trim() && Number.isFinite(Number(value)))) return "FaceID strength and noise settings must be finite numbers.";
    }
    return undefined;
  }, [form]);

  const selectedModelRecord = useMemo(() => modelInventory.find((m) => m.modelRecordId === selectedModelRecordId), [modelInventory, selectedModelRecordId]);

  const pollUntilTerminal = useCallback((id: string, runId: number): Promise<RuntimeTaskRecord | undefined> => {
    if (!workspaceId) return Promise.resolve(undefined);
    stopObservationRef.current?.();
    return new Promise((resolve) => {
      let stop = () => {}; let finished = false;
      const finish = (value?: RuntimeTaskRecord) => { if (finished) return; finished = true; queueMicrotask(() => stop()); resolve(value); };
      const scope = { workspaceId, family: "image-generation", requestId: id };
      stop = observer.subscribe(scope, async () => {
        const task = await client.readImageGeneration({ requestId: id, workspaceId });
        if (task.requestId !== id) throw new Error("Image task identity is unconfirmed.");
        return { value: task, activity: ["succeeded", "failed", "cancelled"].includes(task.status) ? "terminal" : "active" };
      }, (snapshot) => {
        if (!session.active || pollRunIdRef.current !== runId) { finish(); return; }
        if (!snapshot) { setError("Image progress is temporarily unavailable. It will retry automatically."); return; }
        const task = snapshot.value;
        if (task.status === "unknown") { setError("Runtime status is unavailable. The task identity is retained."); return; }
        setStatus(toUiStatus(task.status)); setError((current) => current?.startsWith("Cancellation") ? current : undefined);
        if (["succeeded", "failed", "cancelled"].includes(task.status)) { activeRequestRef.current = undefined; finish(task); }
      });
      stopObservationRef.current = () => { stop(); finish(); };
    });
  }, [client, observer, workspaceId, session]);

  const finalize = useCallback(async (id: string, runId: number) => {
    const current = () => session.active && pollRunIdRef.current === runId;
    if (!current() || session.finalizing) return;
    session.finalizing = true;
    setStatus("finalizing");
    try {
      const finalized = await client.finalizeImageGenerationIfCompleted({ requestId: id, workspaceId });
      if (!current()) return;
      if (!finalized.finalized || !hasFinalizedAssets(finalized.assets)) throw new Error("Incomplete output");
      const assets = finalized.assets;
      const previous = resultsRef.current;
      if (previous.length && !finalizedByRequestRef.current.has(id)) setSessionGallery((history) => [{ id: `${id}-${Date.now()}`, requestId: id, createdAt: new Date().toISOString(), assets: previous }, ...history].slice(0, 20));
      const alreadyFinalized = finalizedByRequestRef.current.has(id);
      finalizedByRequestRef.current.add(id); resultsRef.current = assets;
      setResults(assets); setStatus("finalized"); setError(undefined);
      if (!alreadyFinalized) {
        try { generatedCallbackRef.current?.(assets); } catch { /* Confirmed output is not revoked by a consumer refresh failure. */ }
      }
    } catch {
      if (current()) { setStatus("failed"); setError("Image finalization could not finish. Retry finalization to keep the same generation."); }
    } finally { session.finalizing = false; }
  }, [client, workspaceId, session]);

  const start = useCallback(async () => {
    setHasAttemptedGeneration(true);
    if (!session.active || stateSession !== session || session.action || session.finalizing || activeRequestRef.current || ACTIVE_STATUSES.includes(status)) return;
    if (validationError) { setError(validationError); return; }
    if (selectedModelRecord) {
      if (!isServerInventoryImageGenerationModel(selectedModelRecord)) {
        setError("Selected server model is not an image generation model. Choose a downloaded image model or use the manual checkpoint override.");
        return;
      }
      if (!isImageGenerationModelReady(selectedModelRecord)) {
        setError("Selected server model is a saved reference only. Download the image model before generating.");
        return;
      }
    }

    session.action = "start";
    let awaitingAcceptance = true;
    pollRunIdRef.current += 1;
    const runId = pollRunIdRef.current;
    activeRequestRef.current = undefined;

    try {
      setError(undefined); setRequestId(undefined); setStatus("starting");
      const payload: ImageGenerationRequest = {
        prompt: form.prompt.trim(), width: parsePositiveInt(form.width)!, height: parsePositiveInt(form.height)!, steps: parsePositiveInt(form.steps)!, numImages: parsePositiveInt(form.numImages)!,
        cfg: Number(form.cfg), denoise: Number(form.denoise),
        sampler: form.sampler.trim() || "dpmpp_2m", scheduler: form.scheduler.trim() || "karras",
      };
      const seed = parseSeed(form.seed); payload.seed = seed ?? randomSeed();
      if (selectedModelRecordId.trim()) payload.model = selectedModelRecordId.trim();
      else if (form.model.trim()) payload.model = form.model.trim();
      if (form.negativePrompt.trim()) payload.negativePrompt = form.negativePrompt.trim();
      if (form.latentSourceArtifactId.trim()) payload.latentSource = { kind: "artifact", artifactId: form.latentSourceArtifactId.trim() };
      else payload.latentSource = { kind: "empty" };
      payload.engineHints = { ...(payload.engineHints ?? {}), runtimeDeviceMode: runtimeMode };
      if (form.faceIdEnabled) {
        const references = [form.faceIdArtifactId1, form.faceIdArtifactId2, form.faceIdArtifactId3]
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .slice(0, 3)
          .map((artifactId) => ({ artifactId }));
        if (references.length > 0) {
          payload.faceId = {
            enabled: true,
            references,
            identityStrength: Number(form.faceIdIdentityStrength),
            structureStrength: Number(form.faceIdStructureStrength),
            noise: Number(form.faceIdNoise),
          };
          console.info("[thin-client][image-generation] FaceID enabled for request.", { referenceCount: references.length, hasLatentSource: payload.latentSource?.kind === "artifact" });
        }
      }

      if (!workspaceId) { setError("Select a workspace before generating images."); setStatus("failed"); return; } const started = await client.startImageGeneration({ ...payload, workspaceId });
      if (!session.active || pollRunIdRef.current !== runId) return;
      if (typeof started.requestId !== "string" || !started.requestId.trim() || started.requestId.length > 512) throw new Error("Unconfirmed image request.");
      try { sessionStorage.setItem(taskStorageKey, started.requestId); } catch { /* Optional recovery identity. */ }
      setRequestId(started.requestId); activeRequestRef.current = started.requestId; setStatus("queued");
      session.action = undefined;
      awaitingAcceptance = false;

      const finalTask = await pollUntilTerminal(started.requestId, runId);
      if (!finalTask || !session.active || pollRunIdRef.current !== runId) return;
      if (finalTask.status !== "succeeded") {
        setStatus(toUiStatus(finalTask.status));
        if (finalTask.status === "failed") setError(taskFailureMessage(finalTask));
        return;
      }
      await finalize(started.requestId, runId);
    } catch (cause) {
      if (!session.active || pollRunIdRef.current !== runId) return;
      if (isUnavailableApiError(cause)) {
        setStatus("idle");
        setError(runtimeUnavailableMessage(cause));
        return;
      }
      setStatus("failed");
      setError("Image generation could not start. Check runtime status and try again.");
    } finally { if (awaitingAcceptance && session.action === "start") session.action = undefined; }
  }, [client, finalize, form, pollUntilTerminal, runtimeMode, selectedModelRecord, selectedModelRecordId, status, validationError, workspaceId, session, stateSession]);

  const cancel = useCallback(async () => {
    const id = activeRequestRef.current;
    if (!session.active || session.action || session.finalizing || !id || !workspaceId) return;
    session.action = "cancel";
    try {
      const result = await client.cancelImageGeneration({ requestId: id, workspaceId });
      if (!session.active || activeRequestRef.current !== id || session.finalizing) return;
      if (result.cancelled === true) { activeRequestRef.current = undefined; stopObservationRef.current?.(); setStatus("cancelled"); }
      else setError("Cancellation remains pending. Runtime progress will continue to be checked.");
    } catch { if (session.active && activeRequestRef.current === id) setError("Cancellation could not be confirmed. The task remains active."); }
    finally { session.action = undefined; }
    if (session.active && activeRequestRef.current === id) observer.invalidate({ workspaceId, family: "image-generation", requestId: id });
  }, [client, observer, workspaceId, session]);

  const unloadModel = useCallback(async () => {
    if (!session.active || session.action || session.finalizing || activeRequestRef.current || ACTIVE_STATUSES.includes(status)) return;
    session.action = "unload";
    setUnloadModelState({ status: "loading", message: "Unloading image generation model..." });
    try {
      const result = await client.unloadModel();
      if (!session.active) return;
      if (result.unloaded !== true) throw new Error("Unconfirmed model unload.");
      setUnloadModelState({
        status: "success",
        message: "Image generation model unloaded.",
      });
    } catch (cause) {
      if (!session.active) return;
      setUnloadModelState({
        status: "error",
        message: "Model unload could not be confirmed. Check runtime status and try again.",
      });
    } finally { session.action = undefined; }
  }, [client, session, status]);

  useEffect(() => {
    if (!hasAttemptedGeneration) return;
    const previousValidationError = displayedValidationErrorRef.current;
    displayedValidationErrorRef.current = validationError;
    setError((current) =>
      validationError ?? (current === previousValidationError ? undefined : current),
    );
  }, [hasAttemptedGeneration, validationError]);


  useEffect(() => {
    if (!workspaceId || !session.active || stateSession !== session) return;
    persistedByWorkspace.delete(workspaceId);
    persistedByWorkspace.set(workspaceId, { form, runtimeMode, status, requestId, error, results, sessionGallery });
    if (persistedByWorkspace.size > 64) persistedByWorkspace.delete(persistedByWorkspace.keys().next().value!);
  }, [form, runtimeMode, status, requestId, error, results, sessionGallery, workspaceId, stateSession, session]);

  useEffect(() => {
    if (!session.active || stateSession !== session || session.finalizing || !requestId || !["starting", "queued", "running", "finalizing"].includes(status)) return;
    if (activeRequestRef.current === requestId) return;
    pollRunIdRef.current += 1;
    const runId = pollRunIdRef.current;
    activeRequestRef.current = requestId;
    void pollUntilTerminal(requestId, runId).then(async (task) => {
      if (!task || !session.active || pollRunIdRef.current !== runId) return;
      if (task.status !== "succeeded") {
        setStatus(toUiStatus(task.status));
        if (task.status === "failed") setError(taskFailureMessage(task));
        return;
      }
      await finalize(requestId, runId);
    }).catch((cause) => {
      if (!session.active || pollRunIdRef.current !== runId) return;
      if (isUnavailableApiError(cause)) {
        setStatus("idle");
        setError(runtimeUnavailableMessage(cause));
        return;
      }
      setStatus("failed");
      setError("Image generation progress is unavailable. Retry the current task status.");
    });
  }, [finalize, pollUntilTerminal, requestId, status, workspaceId, session, stateSession]);

  const qualityNote = useMemo(() => {
    const width = Number(form.width); const height = Number(form.height); const steps = Number(form.steps);
    if (width <= 256 || height <= 256 || steps < 15) return "Quality warning: very small resolution or low steps can reduce detail; SDXL-style models generally perform better with larger sizes and 15+ steps.";
    return undefined;
  }, [form.width, form.height, form.steps]);

  const imageGenerationModels = useMemo(() => modelInventory.filter(isServerInventoryImageGenerationModel), [modelInventory]);
  const downloadedImageGenerationModels = useMemo(() => imageGenerationModels.filter(isImageGenerationModelReady), [imageGenerationModels]);
  const referenceOnlyImageGenerationModels = useMemo(() => imageGenerationModels.filter((m) => !isImageGenerationModelReady(m)), [imageGenerationModels]);
  const imageGenerationModelOptions = useMemo(() => imageGenerationModels.map(toImageGenerationModelDropdownOption).filter((option): option is NonNullable<typeof option> => Boolean(option)), [imageGenerationModels]);
  const createPreviewUrl = useCallback(
    (storageKey: string) => client.createArtifactMediaViewUrl(storageKey, { workspaceId }),
    [client, workspaceId],
  );

  const retryFinalization = () => { const id = activeRequestRef.current ?? requestId; if (id) void finalize(id, pollRunIdRef.current); };
  return { retryFinalization, canRetryFinalization: status === "failed" && Boolean(requestId) && error?.startsWith("Image finalization"), form, setForm, runtimeMode, setRuntimeMode, status, error, requestId, results, sessionGallery, start, cancel, unloadModel, unloadModelState, runtimeResources, qualityNote, validationError: hasAttemptedGeneration ? validationError : undefined, isGenerateDisabled: ACTIVE_STATUSES.includes(status), isCancelDisabled: !(requestId && ["queued", "running", "starting", "finalizing"].includes(status)), isUnloadModelDisabled: ACTIVE_STATUSES.includes(status) || unloadModelState.status === "loading", createPreviewUrl, modelInventory, modelInventoryLoading, modelInventoryError, refreshModelInventory, selectedModelRecordId, setSelectedModelRecordId, selectedModelRecord, imageGenerationModels, downloadedImageGenerationModels, referenceOnlyImageGenerationModels, imageGenerationModelOptions, imageArtifacts, imageArtifactsLoading, imageArtifactsError, refreshImageArtifacts };
}
