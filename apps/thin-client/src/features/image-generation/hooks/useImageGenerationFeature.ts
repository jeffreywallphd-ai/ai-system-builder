import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const POLL_INTERVAL_MS = 1200;
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
let persistedState: PersistedImageGenerationState | undefined;

export function resetImageGenerationPersistedStateForTests(): void {
  persistedState = undefined;
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
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const parsePositiveInt = (v: string) => { const n = Number(v); return Number.isInteger(n) && Number.isFinite(n) && n > 0 ? n : undefined; };
const parseSeed = (v: string) => { if (!v.trim()) return undefined; const n = Number(v); return Number.isInteger(n) && Number.isFinite(n) ? n : undefined; };
const randomSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
const hasFinalizedAssets = (assets: FinalizedImageAsset[] | undefined): assets is FinalizedImageAsset[] => Array.isArray(assets) && assets.length > 0;

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
  return error.message || "ComfyUI is not ready yet.";
}

function taskFailureMessage(task: RuntimeTaskRecord): string {
  return task.error?.message ?? "Image generation task failed.";
}

export function useImageGenerationFeature(
  client: ImageGenerationApiClient = defaultImageGenerationClient,
  onGenerated?: (assets: FinalizedImageAsset[]) => void,
  modelClient: ModelManagementApiClient = defaultModelManagementClient,
  artifactClient: ArtifactBrowserApiClient = defaultArtifactBrowserClient,
  workspaceId?: string,
) {
  const [form, setForm] = useState<ImageGenerationFormState>(persistedState?.form ?? { prompt: DEFAULT_PROMPT, negativePrompt: DEFAULT_NEGATIVE_PROMPT, seed: "", width: "1024", height: "1024", steps: "20", cfg: "8", denoise: "1", sampler: "dpmpp_2m", scheduler: "karras", model: "", numImages: "1", latentSourceArtifactId: "", faceIdEnabled: false, faceIdArtifactId1: "", faceIdArtifactId2: "", faceIdArtifactId3: "", faceIdIdentityStrength: "0.85", faceIdStructureStrength: "0.75", faceIdNoise: "0.35" });
  const [runtimeMode, setRuntimeMode] = useState<ImageGenerationRuntimeMode>(persistedState?.runtimeMode ?? "auto");
  const [modelInventory, setModelInventory] = useState<ModelInventoryRecord[]>([]);
  const [modelInventoryLoading, setModelInventoryLoading] = useState(false);
  const [modelInventoryError, setModelInventoryError] = useState<string | undefined>(undefined);
  const [selectedModelRecordId, setSelectedModelRecordId] = useState<string>("");
  const [imageArtifacts, setImageArtifacts] = useState<ThinClientArtifactBrowseItem[]>([]);
  const [imageArtifactsLoading, setImageArtifactsLoading] = useState(false);
  const [imageArtifactsError, setImageArtifactsError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<UiStatus>(persistedState?.status ?? "idle");
  const [requestId, setRequestId] = useState<string | undefined>(persistedState?.requestId);
  const [error, setError] = useState<string | undefined>(persistedState?.error);
  const [results, setResults] = useState<FinalizedImageAsset[]>(persistedState?.results ?? []);
  const [sessionGallery, setSessionGallery] = useState<ThinClientImageGenerationSessionGeneration[]>(persistedState?.sessionGallery ?? []);
  const [hasAttemptedGeneration, setHasAttemptedGeneration] = useState(false);
  const [unloadModelState, setUnloadModelState] = useState<{ status: "idle" | "loading" | "success" | "error"; message?: string }>({ status: "idle" });
  const [runtimeResources, setRuntimeResources] = useState<{ memoryUsagePercent: number; cpuUsagePercent: number; gpuUsagePercent: number }>({ memoryUsagePercent: 0, cpuUsagePercent: 0, gpuUsagePercent: 0 });

  const mountedRef = useRef(true);
  const activeRequestRef = useRef<string | undefined>(undefined);
  const pollRunIdRef = useRef(0);
  const finalizedByRequestRef = useRef(new Set<string>());
  const modelInventoryRequestRef = useRef(0);
  const imageArtifactsRequestRef = useRef(0);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; pollRunIdRef.current += 1; activeRequestRef.current = undefined; }; }, []);

  const refreshModelInventory = useCallback(async () => {
    const requestId = ++modelInventoryRequestRef.current;
    setModelInventoryLoading(true);
    setModelInventoryError(undefined);
        try {
      const result = workspaceId ? await modelClient.listModels({ workspaceId: createWorkspaceId(workspaceId) }) : { models: [] };
      if (!mountedRef.current || requestId !== modelInventoryRequestRef.current) return;
      const sorted = [...result.models].sort((a, b) => rankInventoryModel(a) - rankInventoryModel(b) || a.displayName.localeCompare(b.displayName));
      const downloadedImageModel = sorted.find((m) => isServerInventoryImageGenerationModel(m) && isImageGenerationModelReady(m));
      setModelInventory(sorted);
      setSelectedModelRecordId((current) => {
        if (current && sorted.some((m) => m.modelRecordId === current && isServerInventoryImageGenerationModel(m))) return current;
        if (downloadedImageModel) return downloadedImageModel.modelRecordId;
        return "";
      });
    } catch (e) {
      if (!mountedRef.current || requestId !== modelInventoryRequestRef.current) return;
      const message = e instanceof Error ? e.message : "Failed to load model inventory.";
      setModelInventoryError(message);
    } finally {
      if (mountedRef.current && requestId === modelInventoryRequestRef.current) setModelInventoryLoading(false);
    }
  }, [modelClient, workspaceId]);

  useEffect(() => { void refreshModelInventory(); }, [refreshModelInventory]);

  const refreshImageArtifacts = useCallback(async () => {
    const requestId = ++imageArtifactsRequestRef.current;
    setImageArtifactsLoading(true);
    setImageArtifactsError(undefined);
    try {
      const items = workspaceId ? await artifactClient.browseArtifacts({ artifactFamily: "image", workspaceId }) : [];
      if (!mountedRef.current || requestId !== imageArtifactsRequestRef.current) return;
      setImageArtifacts(items.filter((item) => item.artifactFamily === "image" || item.mediaType?.startsWith("image/")));
    } catch (cause) {
      if (!mountedRef.current || requestId !== imageArtifactsRequestRef.current) return;
      setImageArtifactsError(cause instanceof Error ? cause.message : "Failed to load image artifacts.");
    } finally {
      if (mountedRef.current && requestId === imageArtifactsRequestRef.current) setImageArtifactsLoading(false);
    }
  }, [artifactClient, workspaceId]);

  useEffect(() => { void refreshImageArtifacts(); }, [refreshImageArtifacts]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const pollResources = async () => {
      if (typeof client.readRuntimeResources !== "function") return;
      try {
        const snapshot = await client.readRuntimeResources();
        if (!cancelled) setRuntimeResources(snapshot);
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
  }, [client, workspaceId]);

  const validationError = useMemo(() => {
    if (!form.prompt.trim()) return "Prompt is required.";
    if (!parsePositiveInt(form.width) || !parsePositiveInt(form.height) || !parsePositiveInt(form.steps) || !parsePositiveInt(form.numImages)) return "Width, height, steps, and number of images must be positive integers.";
    if (form.seed.trim() && parseSeed(form.seed) === undefined) return "Seed must be a finite integer when provided.";
    const cfg = Number(form.cfg); if (!Number.isFinite(cfg) || cfg <= 0) return "CFG must be a positive number.";
    const denoise = Number(form.denoise); if (!Number.isFinite(denoise) || denoise < 0 || denoise > 1) return "Denoise must be between 0 and 1.";
    if (form.faceIdEnabled) {
      if (!form.faceIdArtifactId1.trim()) return "FaceID requires at least one face reference image.";
    }
    return undefined;
  }, [form]);

  const selectedModelRecord = useMemo(() => modelInventory.find((m) => m.modelRecordId === selectedModelRecordId), [modelInventory, selectedModelRecordId]);

  const pollUntilTerminal = useCallback(async (id: string, runId: number): Promise<RuntimeTaskRecord | undefined> => {
    let latest = await client.readImageGeneration({ requestId: id, workspaceId });
    while (mountedRef.current && pollRunIdRef.current === runId) {
      setStatus(toUiStatus(latest.status));
      if (["succeeded", "failed", "cancelled"].includes(latest.status)) return latest;
      await sleep(POLL_INTERVAL_MS);
      if (!mountedRef.current || pollRunIdRef.current !== runId) return undefined;
      latest = await client.readImageGeneration({ requestId: id, workspaceId });
    }
    return undefined;
  }, [client, workspaceId]);

  const start = useCallback(async () => {
    setHasAttemptedGeneration(true);
    if (ACTIVE_STATUSES.includes(status)) return;
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
      if (!mountedRef.current || pollRunIdRef.current !== runId) return;
      setRequestId(started.requestId); activeRequestRef.current = started.requestId; setStatus("queued");

      const finalTask = await pollUntilTerminal(started.requestId, runId);
      if (!finalTask || !mountedRef.current || pollRunIdRef.current !== runId) return;
      if (finalTask.status !== "succeeded") {
        setStatus(toUiStatus(finalTask.status));
        if (finalTask.status === "failed") setError(taskFailureMessage(finalTask));
        return;
      }
      setStatus("finalizing");
      const finalized = await client.finalizeImageGenerationIfCompleted({ requestId: started.requestId, workspaceId });
      if (!mountedRef.current || pollRunIdRef.current !== runId) return;
      if (!finalized.finalized) {
        setStatus("failed");
        setError(finalized.reason ?? "Finalization did not complete.");
        return;
      }
      finalizedByRequestRef.current.add(started.requestId);
      const assets = finalized.assets ?? [];
      if (!hasFinalizedAssets(assets)) {
        setStatus("failed");
        setError("Image generation finalized but did not register any generated image artifacts.");
        return;
      }
      if (results.length > 0) {
        setSessionGallery((history) => [{ id: `${started.requestId}-${Date.now()}`, requestId: started.requestId, createdAt: new Date().toISOString(), assets: results }, ...history]);
      }
      setResults(assets);
      setStatus("finalized");
      onGenerated?.(assets);
    } catch (cause) {
      if (!mountedRef.current || pollRunIdRef.current !== runId) return;
      if (isUnavailableApiError(cause)) {
        setStatus("idle");
        setError(runtimeUnavailableMessage(cause));
        return;
      }
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : "Image generation failed.");
    }
  }, [client, form, onGenerated, pollUntilTerminal, results, runtimeMode, selectedModelRecord, selectedModelRecordId, status, validationError, workspaceId]);

  const cancel = useCallback(async () => {
    pollRunIdRef.current += 1;
    const id = activeRequestRef.current ?? requestId;
    activeRequestRef.current = undefined;
    setStatus("cancelled");
    if (!id) return;
    try { await client.cancelImageGeneration({ requestId: id, workspaceId }); } catch { }
  }, [client, requestId, workspaceId]);



  const unloadModel = useCallback(async () => {
    setUnloadModelState({ status: "loading", message: "Unloading image generation model..." });
    try {
      const result = await client.unloadModel();
      if (!mountedRef.current) return;
      setUnloadModelState({
        status: "success",
        message: result.message ?? "Image generation model unloaded.",
      });
    } catch (cause) {
      if (!mountedRef.current) return;
      setUnloadModelState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Failed to unload image generation model.",
      });
    }
  }, [client]);

  useEffect(() => {
    if (!hasAttemptedGeneration) return;
    setError(validationError);
  }, [form, hasAttemptedGeneration, validationError]);


  useEffect(() => {
    persistedState = { form, runtimeMode, status, requestId, error, results, sessionGallery };
  }, [form, runtimeMode, status, requestId, error, results, sessionGallery]);

  useEffect(() => {
    if (!requestId || !["starting", "queued", "running", "finalizing"].includes(status)) return;
    if (activeRequestRef.current === requestId) return;
    pollRunIdRef.current += 1;
    const runId = pollRunIdRef.current;
    activeRequestRef.current = requestId;
    void pollUntilTerminal(requestId, runId).then(async (task) => {
      if (!task || !mountedRef.current || pollRunIdRef.current !== runId) return;
      if (task.status !== "succeeded") {
        setStatus(toUiStatus(task.status));
        if (task.status === "failed") setError(taskFailureMessage(task));
        return;
      }
      if (finalizedByRequestRef.current.has(requestId)) {
        setStatus("finalized");
        return;
      }
      setStatus("finalizing");
      const finalized = await client.finalizeImageGenerationIfCompleted({ requestId, workspaceId });
      if (!mountedRef.current || pollRunIdRef.current !== runId) return;
      if (!finalized.finalized) {
        setStatus("failed");
        setError(finalized.reason ?? "Finalization did not complete.");
        return;
      }
      finalizedByRequestRef.current.add(requestId);
      const assets = finalized.assets ?? [];
      if (!hasFinalizedAssets(assets)) {
        setStatus("failed");
        setError("Image generation finalized but did not register any generated image artifacts.");
        return;
      }
      if (results.length > 0) {
        setSessionGallery((history) => [{ id: `${requestId}-${Date.now()}`, requestId, createdAt: new Date().toISOString(), assets: results }, ...history]);
      }
      setResults(assets);
      setStatus("finalized");
      onGenerated?.(assets);
    }).catch((cause) => {
      if (!mountedRef.current || pollRunIdRef.current !== runId) return;
      if (isUnavailableApiError(cause)) {
        setStatus("idle");
        setError(runtimeUnavailableMessage(cause));
        return;
      }
      setStatus("failed");
      setError(cause instanceof Error ? cause.message : "Image generation failed.");
    });
  }, [client, onGenerated, pollUntilTerminal, requestId, results, status, workspaceId]);

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

  return { form, setForm, runtimeMode, setRuntimeMode, status, error, requestId, results, sessionGallery, start, cancel, unloadModel, unloadModelState, runtimeResources, qualityNote, validationError: hasAttemptedGeneration ? validationError : undefined, isGenerateDisabled: ACTIVE_STATUSES.includes(status), isCancelDisabled: !(requestId && ["queued", "running", "starting", "finalizing"].includes(status)), isUnloadModelDisabled: ACTIVE_STATUSES.includes(status) || unloadModelState.status === "loading", createPreviewUrl, modelInventory, modelInventoryLoading, modelInventoryError, refreshModelInventory, selectedModelRecordId, setSelectedModelRecordId, selectedModelRecord, imageGenerationModels, downloadedImageGenerationModels, referenceOnlyImageGenerationModels, imageGenerationModelOptions, imageArtifacts, imageArtifactsLoading, imageArtifactsError, refreshImageArtifacts };
}
