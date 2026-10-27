import { useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ImageGenerationRequest } from "../../../../../../../modules/contracts/image-generation";
import type { ModelInventoryRecord } from "../../../../../../../modules/contracts/model";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import type { RuntimeTaskRecord } from "../../../../../../../modules/contracts/runtime";
import type { RuntimeInstallStatus } from "../../../../../../../modules/contracts/runtime-installer";
import { createDesktopImageGenerationClient } from "../api";
import {
  createDesktopModelsClient,
  type DesktopModelsClient,
} from "../../models/api/desktopModelsClient";
import {
  createDesktopArtifactBrowserClient,
  type DesktopArtifactBrowserClient,
} from "../../artifact-browser/api/desktopArtifactBrowserClient";
import { recordSectionLoadMilestone } from "../../../diagnostics/sectionLoadDiagnostics";
import { recordRendererMemorySnapshot } from "../../../diagnostics/rendererMemoryDiagnostics";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));
export interface ImageGenerationOutputReference {
  fileName?: string;
  subfolder?: string;
  engine?: string;
  promptId?: string;
}
export interface ImageGenerationFinalizedAssetReference {
  assetId: string;
  artifactId: string;
  storageKey?: string;
  previewUrl?: string;
  mediaType?: string;
  previewStatus?: "idle" | "loading" | "ready" | "failed";
  previewError?: string;
}
export interface ImageGenerationSessionGeneration {
  id: string;
  requestId?: string;
  createdAt: string;
  assets: ImageGenerationFinalizedAssetReference[];
}
export interface ImageGenerationTaskDataView {
  status?: string;
  progress?: { message?: string; current?: number; total?: number };
  outputs: ImageGenerationOutputReference[];
}
export interface ImageGenerationFormValues {
  prompt: string;
  negativePrompt: string;
  seed: string;
  width: string;
  height: string;
  steps: string;
  cfg: string;
  denoise: string;
  sampler: string;
  scheduler: string;
  model: string;
  numImages: string;
  latentSourceArtifactId: string;
  faceIdEnabled: boolean;
  faceIdArtifactId1: string;
  faceIdArtifactId2: string;
  faceIdArtifactId3: string;
  faceIdIdentityStrength: string;
  faceIdStructureStrength: string;
  faceIdNoise: string;
}
export type ImageGenerationUiStatus =
  | "idle"
  | "starting"
  | "queued"
  | "running"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";
export type ImageGenerationModelLoadStatus =
  "idle" | "loading" | "success" | "error";
export interface ImageGenerationModelOption {
  value: string;
  label: string;
  modelRecordId: string;
}
export interface ImageGenerationArtifactOption {
  value: string;
  label: string;
}
const ACTIVE_STATUSES: ImageGenerationUiStatus[] = [
  "starting",
  "queued",
  "running",
  "finalizing",
  "unknown",
];
const INSTALL_STATUSES: RuntimeInstallStatus[] = [
  "not-installed",
  "installing",
  "checking",
  "installed",
  "update-available",
  "failed",
  "unknown",
];
const SELECTABLE_IMAGE_MODEL_LIFECYCLE_STATUSES = [
  "downloaded",
  "generated",
  "validated",
] as const;
const SELECTABLE_IMAGE_MODEL_ARTIFACT_FORMS = [
  "full-model",
  "merged-model",
  "checkpoint",
] as const;
type DesktopImageGenerationClient = ReturnType<
  typeof createDesktopImageGenerationClient
>;
const parsePositiveNumber = (value: string) => {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    return undefined;
  return parsed;
};
const parseSeed = (seed: string): number | undefined => {
  if (seed.trim() === "") return undefined;
  const parsed = Number(seed);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return parsed;
};
function normalizeInstallStatus(status: unknown): RuntimeInstallStatus {
  return typeof status === "string" &&
    INSTALL_STATUSES.includes(status as RuntimeInstallStatus)
    ? (status as RuntimeInstallStatus)
    : "unknown";
}
export function isSelectableImageGenerationModel(
  model: Pick<
    ModelInventoryRecord,
    "artifactForm" | "inferenceMode" | "lifecycleStatus" | "taskTags"
  >,
): boolean {
  if (
    !SELECTABLE_IMAGE_MODEL_LIFECYCLE_STATUSES.includes(
      model.lifecycleStatus as (typeof SELECTABLE_IMAGE_MODEL_LIFECYCLE_STATUSES)[number],
    )
  )
    return false;
  if (
    !SELECTABLE_IMAGE_MODEL_ARTIFACT_FORMS.includes(
      model.artifactForm as (typeof SELECTABLE_IMAGE_MODEL_ARTIFACT_FORMS)[number],
    )
  )
    return false;
  if (model.inferenceMode === "text-to-image") return true;
  return (model.taskTags ?? []).some((tag) => tag === "text-to-image");
}
export function toImageGenerationModelDropdownValue(
  model: Pick<
    ModelInventoryRecord,
    "displayName" | "localPath" | "modelId" | "modelRecordId"
  >,
): string | undefined {
  const candidates = [
    model.modelId,
    model.modelRecordId,
    model.displayName,
    model.localPath,
  ];
  return candidates
    .find((value) => typeof value === "string" && value.trim().length > 0)
    ?.trim();
}
export function toImageGenerationModelDropdownOption(
  model: Pick<
    ModelInventoryRecord,
    | "artifactForm"
    | "displayName"
    | "inferenceMode"
    | "lifecycleStatus"
    | "localPath"
    | "modelId"
    | "modelRecordId"
    | "source"
    | "storageScope"
    | "taskTags"
  >,
): ImageGenerationModelOption | undefined {
  if (!isSelectableImageGenerationModel(model)) return undefined;
  const value = toImageGenerationModelDropdownValue(model);
  if (!value) return undefined;
  const scope = model.storageScope === "shared" ? "shared" : "workspace";
  return {
    value,
    modelRecordId: model.modelRecordId,
    label: `${model.displayName} - ${model.modelId ?? model.modelRecordId} - ${scope} - ${model.source} - ${model.lifecycleStatus} - ${model.artifactForm} - inference: ${model.inferenceMode ?? "n/a"}`,
  };
}
export function resolveModelForGeneration(model: string): string | undefined {
  const normalized = model.trim();
  return normalized.length > 0 ? normalized : undefined;
}
export function normalizeImageGenerationOutputs(
  task: RuntimeTaskRecord,
): ImageGenerationOutputReference[] {
  const data = task.data as
    { outputs?: unknown; value?: { outputs?: unknown } } | undefined;
  const rawOutputs = Array.isArray(data?.outputs)
    ? data.outputs
    : Array.isArray(data?.value?.outputs)
      ? data.value.outputs
      : [];
  return rawOutputs
    .filter(
      (o): o is Record<string, unknown> => typeof o === "object" && o !== null,
    )
    .map((o) => ({
      fileName: typeof o.fileName === "string" ? o.fileName : undefined,
      subfolder: typeof o.subfolder === "string" ? o.subfolder : undefined,
      engine: typeof o.engine === "string" ? o.engine : undefined,
      promptId: typeof o.promptId === "string" ? o.promptId : undefined,
    }));
}
const hasFinalizedAssets = (
  assets: ImageGenerationFinalizedAssetReference[],
): boolean => Array.isArray(assets) && assets.length > 0 && assets.length <= 8
  && assets.every((asset) => asset && [asset.assetId, asset.artifactId, asset.storageKey].every((value) => typeof value === "string" && value.trim().length > 0))
  && new Set(assets.map((asset) => asset.assetId)).size === assets.length
  && new Set(assets.map((asset) => asset.artifactId)).size === assets.length;

const createDefaultForm = (): ImageGenerationFormValues => ({
    prompt: "",
    negativePrompt: "",
    seed: "42",
    width: "1024",
    height: "1024",
    steps: "30",
    cfg: "8",
    denoise: "1",
    sampler: "euler",
    scheduler: "normal",
    model: "",
    numImages: "1",
    latentSourceArtifactId: "",
    faceIdEnabled: false,
    faceIdArtifactId1: "",
    faceIdArtifactId2: "",
    faceIdArtifactId3: "",
    faceIdIdentityStrength: "0.85",
    faceIdStructureStrength: "0.75",
    faceIdNoise: "0.35",
  });

export function useImageGenerationFeature(
  client?: DesktopImageGenerationClient,
  modelsClient?: DesktopModelsClient,
  artifactClient?: DesktopArtifactBrowserClient,
  workspaceId?: string,
) {
  const imageGenerationClient = useMemo(
    () => client ?? createDesktopImageGenerationClient(),
    [client],
  );
  const modelInventoryClient = useMemo(
    () => modelsClient ?? createDesktopModelsClient(),
    [modelsClient],
  );
  const artifacts = useMemo(
    () => artifactClient ?? createDesktopArtifactBrowserClient(),
    [artifactClient],
  );
  const formWorkspaceRef = useRef(workspaceId);
  const session = useMemo(() => ({ active: false, action: undefined as "start" | "cancel" | "repair" | undefined, finalizing: false }), [imageGenerationClient, modelInventoryClient, artifacts, workspaceId]);
  const previewUrlsRef = useRef<string[]>([]);
  const [form, setForm] = useState<ImageGenerationFormValues>(createDefaultForm);
  const [status, setStatus] = useState<ImageGenerationUiStatus>("idle");
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [requestId, setRequestId] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<
    { message?: string; current?: number; total?: number } | undefined
  >(undefined);
  const [taskData, setTaskData] = useState<
    ImageGenerationTaskDataView | undefined
  >(undefined);
  const [outputs, setOutputs] = useState<ImageGenerationOutputReference[]>([]);
  const [finalizedAssets, setFinalizedAssets] = useState<
    ImageGenerationFinalizedAssetReference[]
  >([]);
  const [sessionGallery, setSessionGallery] = useState<
    ImageGenerationSessionGeneration[]
  >([]);
  const [installStatus, setInstallStatus] =
    useState<RuntimeInstallStatus>("unknown");
  const [availableModels, setAvailableModels] = useState<
    ImageGenerationModelOption[]
  >([]);
  const [availableImageArtifacts, setAvailableImageArtifacts] = useState<
    ImageGenerationArtifactOption[]
  >([]);
  const [modelLoadStatus, setModelLoadStatus] =
    useState<ImageGenerationModelLoadStatus>("idle");
  const [modelLoadMessage, setModelLoadMessage] = useState<string | undefined>(
    undefined,
  );
  const [artifactLoadMessage, setArtifactLoadMessage] = useState<
    string | undefined
  >(undefined);
  const observer = useTaskObservationManager();
  const pollStopRef = useRef<(() => void) | undefined>(undefined);
  const taskStorageKey = `ai-system-builder.image-task.v1:${workspaceId ?? "none"}`;
  const finalizedAssetsRef = useRef(finalizedAssets);
  const activePollRef = useRef<string | undefined>(undefined);
  const installStatusSequenceRef = useRef(0);
  const isPollingStillActive = useCallback(
    (id: string) => session.active && activePollRef.current === id,
    [session],
  );
  useEffect(
    () => () => {
      for (const url of previewUrlsRef.current) {
        if (typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(url);
        }
        recordRendererMemorySnapshot({
          milestone: "renderer.preview.object-url.revoked",
          component: "desktop-renderer-preview-cleanup",
          detail: {
            pageKey: "image-generation",
            sectionKey: "image-generation.gallery",
            reason: "session-retirement",
          },
        });
      }
      previewUrlsRef.current = [];
    },
    [session],
  );
  useLayoutEffect(() => {
    session.active = true;
    if (formWorkspaceRef.current !== workspaceId) { formWorkspaceRef.current = workspaceId; setForm(createDefaultForm()); }
    setRequestId(undefined); setStatus("idle"); setError(undefined); setMessage(undefined); setTaskData(undefined); setProgress(undefined); setOutputs([]);
    setFinalizedAssets([]); finalizedAssetsRef.current = []; setSessionGallery([]); setAvailableModels([]); setAvailableImageArtifacts([]); setInstallStatus("unknown");
    recordSectionLoadMilestone("renderer.section.load.skipped", {
      pageKey: "image-generation",
      sectionKey: "image-generation.runtime-readiness",
      trigger: "initial",
    });
    return () => {
      session.active = false;
      installStatusSequenceRef.current += 1;
      pollStopRef.current?.();
      activePollRef.current = undefined;
    };
  }, [session]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      recordSectionLoadMilestone("renderer.section.load.start", {
        pageKey: "image-generation",
        sectionKey: "image-generation.model-selector",
        trigger: "initial",
      });
      setModelLoadStatus("loading");
      setModelLoadMessage("Loading model inventory...");
      try {
        const models = workspaceId
          ? await modelInventoryClient.listModels({
              workspaceId: createWorkspaceId(workspaceId),
            })
          : [];
        if (cancelled || !session.active) return;
        const optionByValue = new Map<string, ImageGenerationModelOption>();
        for (const model of models) {
          const option = toImageGenerationModelDropdownOption(model);
          if (option && !optionByValue.has(option.value))
            optionByValue.set(option.value, option);
        }
        const options = Array.from(optionByValue.values());
        setAvailableModels(options);
        setModelLoadStatus("success");
        setModelLoadMessage(
          options.length > 0
            ? undefined
            : `Loaded ${models.length} model record${models.length === 1 ? "" : "s"}; found zero compatible image-generation models.`,
        );
        recordSectionLoadMilestone("renderer.section.load.resolved", {
          pageKey: "image-generation",
          sectionKey: "image-generation.model-selector",
          trigger: "initial",
        });
      } catch (e) {
        if (!cancelled && session.active) {
          setAvailableModels([]);
          setModelLoadStatus("error");
          setModelLoadMessage(
            "Failed to load model inventory for image generation. Refresh the page to try again.",
          );
          recordSectionLoadMilestone("renderer.section.load.failed", {
            pageKey: "image-generation",
            sectionKey: "image-generation.model-selector",
            trigger: "initial",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelInventoryClient, workspaceId, session]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      recordSectionLoadMilestone("renderer.section.load.start", {
        pageKey: "image-generation",
        sectionKey: "image-generation.gallery",
        trigger: "initial",
      });
      try {
        if (typeof artifacts.browseArtifacts !== "function") {
          recordSectionLoadMilestone("renderer.section.load.skipped", {
            pageKey: "image-generation",
            sectionKey: "image-generation.gallery",
            trigger: "initial",
          });
          return;
        }
        const items = workspaceId
          ? await artifacts.browseArtifacts({
              artifactFamily: "image",
              workspaceId,
            })
          : [];
        if (cancelled || !session.active) return;
        setAvailableImageArtifacts(
          items
            .filter(
              (item) =>
                item.artifactFamily === "image" ||
                item.mediaType?.startsWith("image/"),
            )
            .map((item) => ({
              value: item.storageKey,
              label: item.originalName ?? item.storageKey,
            })),
        );
        setArtifactLoadMessage(undefined);
        recordSectionLoadMilestone("renderer.section.load.resolved", {
          pageKey: "image-generation",
          sectionKey: "image-generation.gallery",
          trigger: "initial",
        });
      } catch (e) {
        if (!cancelled && session.active) {
          setAvailableImageArtifacts([]);
          setArtifactLoadMessage(
            "Failed to load image artifacts. Refresh the page to try again.",
          );
          recordSectionLoadMilestone("renderer.section.load.failed", {
            pageKey: "image-generation",
            sectionKey: "image-generation.gallery",
            trigger: "initial",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifacts, workspaceId, session]);
  const validationError = useMemo(() => {
    if (!form.prompt.trim()) return "Prompt is required.";
    if (form.prompt.length > 10000 || form.negativePrompt.length > 10000) return "Prompt and negative prompt must each contain at most 10,000 characters.";
    if (
      !parsePositiveNumber(form.width) ||
      !parsePositiveNumber(form.height) ||
      !parsePositiveNumber(form.steps) ||
      !parsePositiveNumber(form.numImages)
    )
      return "Width, height, steps, and number of images must be positive integers.";
    if (Number(form.width) < 64 || Number(form.width) > 4096 || Number(form.height) < 64 || Number(form.height) > 4096 || Number(form.steps) > 200 || Number(form.numImages) > 8) return "Use dimensions from 64 to 4096, at most 200 steps and at most 8 images.";
    if (form.seed.trim() && parseSeed(form.seed) === undefined)
      return "Seed must be a finite integer when provided.";
    const cfg = Number(form.cfg);
    if (!Number.isFinite(cfg) || cfg <= 0 || cfg > 50)
      return "CFG must be greater than zero and at most 50.";
    const denoise = Number(form.denoise);
    if (!Number.isFinite(denoise) || denoise < 0 || denoise > 1)
      return "Denoise must be between 0 and 1.";
    if (form.faceIdEnabled) {
      if (!form.faceIdArtifactId1.trim()) return "FaceID requires at least one face reference image.";
      if (![form.faceIdIdentityStrength, form.faceIdStructureStrength, form.faceIdNoise].every((value) => value.trim() && Number.isFinite(Number(value)))) return "FaceID strength and noise settings must be finite numbers.";
    }
    return undefined;
  }, [form]);
  const isStartDisabled = ACTIVE_STATUSES.includes(status);

  const hydratePreviews = useCallback(
    async (assets: ImageGenerationFinalizedAssetReference[]) => {
      const loading = assets.map((a) => ({
        ...a,
        previewStatus: "loading" as const,
      }));
      const resolved = await Promise.all(
        loading.map(async (a) => {
          try {
            const viewUrl = await artifacts.createArtifactMediaViewUrl({
              storageKey: a.storageKey ?? a.artifactId,
            }, { workspaceId });
            if (!session.active) { URL.revokeObjectURL?.(viewUrl); return { ...a, previewStatus: "failed" as const, previewError: "Preview request is no longer active." }; }
            previewUrlsRef.current.push(viewUrl);
            return {
              ...a,
              previewUrl: viewUrl,
              previewStatus: "ready" as const,
            };
          } catch (e) {
            return {
              ...a,
              previewStatus: "failed" as const,
              previewError: "Image preview could not be loaded.",
            };
          }
        }),
      );
      return resolved;
    },
    [artifacts, workspaceId, session],
  );

  const replaceFinalizedAssets = useCallback((assets: ImageGenerationFinalizedAssetReference[], completedRequestId?: string) => {
    const previous = finalizedAssetsRef.current;
    if (previous.length && JSON.stringify(previous.map((a) => a.assetId)) !== JSON.stringify(assets.map((a) => a.assetId))) setSessionGallery((history) => [{ id: `${completedRequestId ?? "generation"}-${Date.now()}`, requestId: completedRequestId, createdAt: new Date().toISOString(), assets: previous }, ...history].slice(0, 20));
    finalizedAssetsRef.current = assets; setFinalizedAssets(assets);
  }, []);

  const poll = useCallback(async (id: string) => {
    if (!session.active || !workspaceId || activePollRef.current === id) return;
    pollStopRef.current?.(); activePollRef.current = id;
    let finalizing = false;
    const scope = { workspaceId, family: "image-generation", requestId: id };
    const stop = observer.subscribe(scope, async () => {
      const response = await imageGenerationClient.readImageGeneration({ requestId: id, workspaceId });
      if (!response.ok) throw new Error("Image progress is unavailable.");
      if (response.value.requestId !== id) throw new Error("Image task identity is unconfirmed.");
      return { value: response.value, activity: ["succeeded", "failed", "cancelled"].includes(response.value.status) || "recordType" in response.value ? "terminal" : "active" };
    }, (snapshot) => {
      if (!isPollingStillActive(id)) return;
      if (!snapshot) { setError("Image progress is temporarily unavailable. It will retry automatically."); return; }
      const record = snapshot.value;
      if ("recordType" in record) { setStatus("unknown"); setError("The image task is no longer available on this host."); return; }
      const view: ImageGenerationTaskDataView = { status: record.status, progress: record.progress, outputs: normalizeImageGenerationOutputs(record) };
      setTaskData(view); setProgress(view.progress); setOutputs(view.outputs);
      if (record.status === "queued" || record.status === "running") { setStatus(record.status); setError(undefined); return; }
      if (record.status === "failed" || record.status === "cancelled") { activePollRef.current = undefined; setStatus(record.status); if (record.status === "failed") setError("Image generation failed. Review runtime diagnostics before trying again."); return; }
      if (record.status !== "succeeded") { setStatus("unknown"); setError("Runtime progress is unavailable. The task identity is retained."); return; }
      if (finalizing) return; finalizing = true; session.finalizing = true; setStatus("finalizing");
      void (async () => {
        try {
          const result = await imageGenerationClient.finalizeImageGenerationIfCompleted({ requestId: id, workspaceId });
          if (!isPollingStillActive(id)) return;
          if (!result.ok || !result.value.finalized) throw new Error("Image finalization is unavailable.");
          const assets = result.value.assets ?? [];
          if (!hasFinalizedAssets(assets)) throw new Error("Image output registration is incomplete.");
          const resolved = await hydratePreviews(assets);
          if (!isPollingStillActive(id)) return;
          replaceFinalizedAssets(resolved, id); setStatus("succeeded"); setError(undefined);
          pollStopRef.current?.(); activePollRef.current = undefined;
        } catch {
          if (isPollingStillActive(id)) { setStatus("failed"); setError("Image finalization could not finish. Retry finalization to keep the same generation."); }
        } finally { finalizing = false; session.finalizing = false; }
      })();
    });
    pollStopRef.current = stop;
  }, [imageGenerationClient, observer, isPollingStillActive, hydratePreviews, replaceFinalizedAssets, workspaceId, session]);

  useEffect(() => {
    try { const id = sessionStorage.getItem(taskStorageKey); if (session.active && id?.trim() && id.length <= 512) { setRequestId(id); setStatus("queued"); void poll(id); } } catch { /* Session storage is optional. */ }
    return () => { pollStopRef.current?.(); activePollRef.current = undefined; };
  }, [poll, taskStorageKey, session]);
  const retryFinalization = () => { if (workspaceId && requestId) observer.invalidate({ workspaceId, family: "image-generation", requestId }); };
  const canRetryFinalization = status === "failed" && taskData?.status === "succeeded";

  const start = useCallback(async () => {
    if (!session.active || session.action || session.finalizing || activePollRef.current || validationError || isStartDisabled) return false;
    session.action = "start";
    try {
    setStatus("starting");
    setError(undefined);
    setMessage(
      "Generating a new image. The previous result will stay visible until the new one is ready.",
    );
    setTaskData(undefined);
    setOutputs([]);
    const payload: ImageGenerationRequest = {
      prompt: form.prompt,
      width: parsePositiveNumber(form.width),
      height: parsePositiveNumber(form.height),
      steps: parsePositiveNumber(form.steps),
      cfg: Number(form.cfg),
      denoise: Number(form.denoise),
      numImages: parsePositiveNumber(form.numImages),
      latentSource: form.latentSourceArtifactId.trim()
        ? { kind: "artifact", artifactId: form.latentSourceArtifactId.trim() }
        : { kind: "empty" },
    };
    if (form.negativePrompt.trim())
      payload.negativePrompt = form.negativePrompt.trim();
    const seed = parseSeed(form.seed);
    if (seed !== undefined) payload.seed = seed;
    if (form.sampler.trim()) payload.sampler = form.sampler.trim();
    if (form.scheduler.trim()) payload.scheduler = form.scheduler.trim();
    if (form.model.trim()) payload.model = form.model.trim();
    if (form.faceIdEnabled) {
      const references = [
        form.faceIdArtifactId1,
        form.faceIdArtifactId2,
        form.faceIdArtifactId3,
      ]
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
      }
    }
    if (!workspaceId) {
      setStatus("failed");
      setError("Select a workspace before generating images.");
      return false;
    }
    const started = await imageGenerationClient.startImageGeneration({
      ...payload,
      workspaceId,
    } as never);
    if (!session.active) return false;
    if (!started.ok || typeof started.value.requestId !== "string" || !started.value.requestId.trim() || started.value.requestId.length > 512) {
      setStatus("failed");
      setError(
        "Image generation could not start. Check runtime status and try again.",
      );
      return false;
    }
    try { sessionStorage.setItem(taskStorageKey, started.value.requestId); } catch { /* Optional recovery identity. */ }
    setRequestId(started.value.requestId);
    setStatus("queued");
    void poll(started.value.requestId);
    return true;
    } catch { if (session.active) { setStatus("failed"); setError("Image generation could not start. Check runtime status and try again."); } return false; }
    finally { session.action = undefined; }
  }, [
    validationError,
    isStartDisabled,
    form,
    imageGenerationClient,
    poll,
    workspaceId,
    session,
  ]);
  const cancel = useCallback(async () => {
    if (!session.active || session.action || session.finalizing || !requestId || !isPollingStillActive(requestId)) return;
    session.action = "cancel";
    try {
    const cancelled = await imageGenerationClient.cancelImageGeneration({
      requestId,
      workspaceId,
    } as never);
    if (!isPollingStillActive(requestId) || session.finalizing) return;
    if (workspaceId) observer.invalidate({ workspaceId, family: "image-generation", requestId });
    if (cancelled.ok && cancelled.value.cancelled === true) {
      setStatus("cancelled");
      setMessage("Image generation was cancelled.");
      activePollRef.current = undefined;
      pollStopRef.current?.();
      return;
    }
    setMessage(
      "Cancellation remains unconfirmed. Runtime progress will continue to be checked.",
    );
    } catch { if (isPollingStillActive(requestId)) setError("Cancellation could not be confirmed. The task remains active."); }
    finally { session.action = undefined; }
  }, [imageGenerationClient, isPollingStillActive, requestId, workspaceId, session]);
  const refreshInstallStatus = async () => {
    const sequence = ++installStatusSequenceRef.current;
    recordSectionLoadMilestone("renderer.section.load.start", {
      pageKey: "image-generation",
      sectionKey: "image-generation.runtime-readiness",
      trigger: "refresh",
    });
    setInstallStatus("checking");
    try {
      const result = await imageGenerationClient.readComfyUiInstallStatus?.();
      if (!session.active || installStatusSequenceRef.current !== sequence)
        return;
      if (!result || !result.ok) {
        setInstallStatus("unknown");
        recordSectionLoadMilestone("renderer.section.load.failed", {
          pageKey: "image-generation",
          sectionKey: "image-generation.runtime-readiness",
          trigger: "refresh",
        });
        return;
      }
      setInstallStatus(normalizeInstallStatus(result.value.status));
      recordSectionLoadMilestone("renderer.section.load.resolved", {
        pageKey: "image-generation",
        sectionKey: "image-generation.runtime-readiness",
        trigger: "refresh",
      });
    } catch {
      if (session.active && installStatusSequenceRef.current === sequence)
        setInstallStatus("unknown");
      recordSectionLoadMilestone("renderer.section.load.failed", {
        pageKey: "image-generation",
        sectionKey: "image-generation.runtime-readiness",
        trigger: "refresh",
      });
    }
  };
  const repairInstall = async () => {
    if (!session.active || session.action || session.finalizing || activePollRef.current) return;
    session.action = "repair";
    const sequence = ++installStatusSequenceRef.current;
    setInstallStatus("installing");
    try {
      const result = await imageGenerationClient.repairComfyUiInstall?.();
      if (!session.active || installStatusSequenceRef.current !== sequence)
        return;
      if (!result || !result.ok) {
        setInstallStatus("failed");
        setError("ComfyUI repair could not be confirmed. Check runtime status and try again.");
        return;
      }
      setInstallStatus(normalizeInstallStatus(result.value.status));
      setError(undefined);
    } catch (e) {
      if (session.active && installStatusSequenceRef.current === sequence) { setInstallStatus("failed"); setError("ComfyUI repair could not be confirmed. Check runtime status and try again."); }
    } finally { session.action = undefined; }
  };
  return {
    form,
    setForm,
    status,
    requestId,
    message,
    error,
    progress,
    taskData,
    outputs,
    finalizedAssets,
    sessionGallery,
    validationError,
    isStartDisabled,
    start,
    cancel,
    retryFinalization,
    canRetryFinalization,
    refreshInstallStatus,
    repairInstall,
    installStatus,
    availableModels,
    availableImageArtifacts,
    artifactLoadMessage,
    modelLoadStatus,
    modelLoadMessage,
  };
}
