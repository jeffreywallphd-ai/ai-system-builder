import { useCallback, useEffect, useMemo, useState } from "react";

import type { ModelArtifactForm, ModelLifecycleStatus, ModelSource, ModelTaskTag } from "../../../../../../../modules/contracts/model";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import type { DesktopModelBrowseItem, DesktopModelDetailsResult } from "../../../lib/desktopApi";
import type {
  DesktopManagedModelInventoryRecord,
  DesktopModelsClient,
} from "../api/desktopModelsClient";
import { recordSectionLoadMilestone } from "../../../diagnostics/sectionLoadDiagnostics";
import { useModelsClient } from "./useModelsClient";

interface ViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
}

function normalizeOptionalNumber(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalTaskTag(value: string): ModelTaskTag | undefined {
  const normalized = value.trim().toLowerCase();
  const allowed: ModelTaskTag[] = ["text-generation", "text2text-generation", "chat", "embeddings", "classification", "summarization", "question-answering", "code-generation", "text-to-image"];
  return allowed.includes(normalized as ModelTaskTag) ? normalized as ModelTaskTag : undefined;
}

function resolveBrowseTaskFilter(
  selection: string,
  otherTaskTag: string,
): { taskTags?: ModelTaskTag[]; customTaskTag?: string } {
  const value = selection === "other" ? otherTaskTag.trim() : selection.trim();
  const taskTag = normalizeOptionalTaskTag(value);
  return taskTag
    ? { taskTags: [taskTag] }
    : value.length > 0
      ? { customTaskTag: value }
      : {};
}

function normalizeOptionalSelect<TOption extends string>(value: string, options: readonly TOption[]): TOption | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return options.includes(normalized as TOption) ? normalized as TOption : undefined;
}

export function useModelsFeature(client?: DesktopModelsClient, workspaceId?: string) {
  const modelClient = useModelsClient(client);
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseTaskTag, setBrowseTaskTag] = useState("");
  const [browseOtherTaskTag, setBrowseOtherTaskTag] = useState("");
  const [browseLimit, setBrowseLimit] = useState("25");
  const [browseState, setBrowseState] = useState<ViewState>({ status: "idle" });
  const [browseItems, setBrowseItems] = useState<DesktopModelBrowseItem[]>([]);
  const [browsePageIndex, setBrowsePageIndex] = useState(0);
  const [browsePageCursors, setBrowsePageCursors] = useState<Array<string | undefined>>([undefined]);
  const [browseNextCursor, setBrowseNextCursor] = useState<string>();
  const [selectedBrowseModel, setSelectedBrowseModel] = useState<DesktopModelBrowseItem>();
  const [selectedBrowseModelDetails, setSelectedBrowseModelDetails] = useState<DesktopModelDetailsResult["model"]>();
  const [detailsState, setDetailsState] = useState<ViewState>({ status: "idle" });
  const [saveState, setSaveState] = useState<ViewState>({ status: "idle" });
  const [downloadState, setDownloadState] = useState<ViewState>({ status: "idle" });

  const [manageState, setManageState] = useState<ViewState>({ status: "idle" });
  const [models, setModels] = useState<DesktopManagedModelInventoryRecord[]>([]);
  const [manageSource, setManageSource] = useState("");
  const [manageLifecycleStatus, setManageLifecycleStatus] = useState("");
  const [manageArtifactForm, setManageArtifactForm] = useState("");
  const [manageSearch, setManageSearch] = useState("");
  const [selectedManagedModel, setSelectedManagedModel] = useState<DesktopManagedModelInventoryRecord>();
  const [pendingDeleteModelRecordId, setPendingDeleteModelRecordId] = useState<string>();
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("");
  const [publishRepository, setPublishRepository] = useState("");
  const [folderOpenState, setFolderOpenState] = useState<ViewState>({ status: "idle" });

  const executeModelSearch = useCallback(async (
    cursor: string | undefined,
    targetPageIndex: number,
    targetPageCursors: Array<string | undefined>,
  ) => {
    if (browseTaskTag === "other" && browseOtherTaskTag.trim().length === 0) {
      setBrowseState({ status: "error", message: "Enter a task tag for Other, then retry." });
      return;
    }
    recordSectionLoadMilestone("renderer.section.load.start", { pageKey: "models", sectionKey: "models.remote-browse", trigger: "search" });
    setBrowseState({ status: "loading", message: "Searching models..." });
    try {
      const taskFilter = resolveBrowseTaskFilter(browseTaskTag, browseOtherTaskTag);
      const result = await modelClient.browseModels({
        provider: "huggingface",
        query: browseQuery || undefined,
        ...taskFilter,
        limit: normalizeOptionalNumber(browseLimit),
        cursor,
      });
      setBrowseItems(result.models);
      setBrowsePageIndex(targetPageIndex);
      setBrowsePageCursors(targetPageCursors);
      setBrowseNextCursor(result.nextCursor);
      setSelectedBrowseModel(undefined);
      setSelectedBrowseModelDetails(undefined);
      setDetailsState({ status: "idle" });
      setBrowseState(result.models.length > 0
        ? { status: "success" }
        : { status: "success", message: "No model results found." });
      recordSectionLoadMilestone("renderer.section.load.resolved", { pageKey: "models", sectionKey: "models.remote-browse", trigger: "search" });
    } catch (error) {
      setBrowseState({ status: "error", message: error instanceof Error ? error.message : "Failed to browse models." });
      recordSectionLoadMilestone("renderer.section.load.failed", { pageKey: "models", sectionKey: "models.remote-browse", trigger: "search" });
    }
  }, [browseLimit, browseOtherTaskTag, browseQuery, browseTaskTag, modelClient]);

  const searchModels = useCallback(async () => {
    await executeModelSearch(undefined, 0, [undefined]);
  }, [executeModelSearch]);

  const searchNextPage = useCallback(async () => {
    if (!browseNextCursor) {
      return;
    }
    await executeModelSearch(
      browseNextCursor,
      browsePageIndex + 1,
      [...browsePageCursors.slice(0, browsePageIndex + 1), browseNextCursor],
    );
  }, [browseNextCursor, browsePageCursors, browsePageIndex, executeModelSearch]);

  const searchPreviousPage = useCallback(async () => {
    if (browsePageIndex === 0) {
      return;
    }
    const previousPageIndex = browsePageIndex - 1;
    await executeModelSearch(
      browsePageCursors[previousPageIndex],
      previousPageIndex,
      browsePageCursors.slice(0, browsePageIndex + 1),
    );
  }, [browsePageCursors, browsePageIndex, executeModelSearch]);

  const loadPopularModels = useCallback(async () => {
    setBrowseState({ status: "loading", message: "Loading popular models..." });
    try {
      const result = await modelClient.browseModels({
        provider: "huggingface",
        limit: normalizeOptionalNumber(browseLimit),
        sort: "downloads",
        direction: "desc",
      });
      setBrowseItems(result.models);
      setSelectedBrowseModel(undefined);
      setSelectedBrowseModelDetails(undefined);
      setDetailsState({ status: "idle" });
      setBrowseState(result.models.length > 0
        ? { status: "success" }
        : { status: "success", message: "No popular models available right now." });
    } catch (error) {
      setBrowseState({ status: "error", message: error instanceof Error ? error.message : "Failed to load popular models." });
    }
  }, [browseLimit, modelClient]);

  const selectBrowseModel = useCallback(async (model: DesktopModelBrowseItem) => {
    setSelectedBrowseModel(model);
    setSelectedBrowseModelDetails(undefined);
    setDetailsState({ status: "loading", message: "Loading model details..." });
    try {
      const details = await modelClient.getModelDetails({ provider: "huggingface", modelId: model.modelId });
      setSelectedBrowseModelDetails(details);
      setDetailsState({ status: "success" });
    } catch (error) {
      setSelectedBrowseModelDetails(undefined);
      setDetailsState({ status: "error", message: error instanceof Error ? error.message : "Failed to load model details." });
    }
  }, [modelClient]);

  const saveModelReference = useCallback(async (model?: DesktopModelBrowseItem) => {
    const modelToSave = model ?? selectedBrowseModel;
    if (!modelToSave) {
      return;
    }
    setSaveState({ status: "loading", message: "Saving model reference..." });
    try {
      if (!workspaceId) { setSaveState({ status: "error", message: "Select a workspace before saving model references." }); return; }
      await modelClient.saveModelReference({
        workspaceId,
        modelId: modelToSave.modelId,
        displayName: modelToSave.displayName,
        inferenceMode: modelToSave.inferenceMode,
        taskTags: modelToSave.taskTags,
        metadata: {
          source: "huggingface",
          likes: modelToSave.likes,
          downloads: modelToSave.downloads,
          gated: modelToSave.gated,
          private: modelToSave.private,
          license: modelToSave.license,
        },
      });
      setSaveState({ status: "success", message: "Model reference saved." });
      await refreshModels();
    } catch (error) {
      setSaveState({ status: "error", message: error instanceof Error ? error.message : "Failed to save model reference." });
    }
  }, [modelClient, selectedBrowseModel, workspaceId]);

  const refreshModels = useCallback(async () => {
    recordSectionLoadMilestone("renderer.section.load.start", { pageKey: "models", sectionKey: "models.local-list", trigger: "initial" });
    setManageState({ status: "loading", message: "Loading model inventory..." });
    try {
      const listed = workspaceId ? await modelClient.listModels({
        workspaceId: createWorkspaceId(workspaceId),
        source: normalizeOptionalSelect<ModelSource>(manageSource, ["huggingface", "local", "generated"]),
        lifecycleStatus: normalizeOptionalSelect<ModelLifecycleStatus>(manageLifecycleStatus, ["remote-reference", "saved-reference", "downloaded", "generated", "validated", "invalid"]),
        artifactForm: normalizeOptionalSelect<ModelArtifactForm>(manageArtifactForm, ["full-model", "adapter", "merged-model", "quantized-model", "checkpoint"]),
        search: manageSearch || undefined,
      }) : [];
      setModels(listed);
      setSelectedManagedModel((current) => listed.find((item) => item.modelRecordId === current?.modelRecordId));
      setManageState(listed.length > 0
        ? { status: "success" }
        : { status: "success", message: "No model records found." });
      recordSectionLoadMilestone("renderer.section.load.resolved", { pageKey: "models", sectionKey: "models.local-list", trigger: "initial" });
    } catch (error) {
      setManageState({ status: "error", message: error instanceof Error ? error.message : "Failed to list model records." });
      recordSectionLoadMilestone("renderer.section.load.failed", { pageKey: "models", sectionKey: "models.local-list", trigger: "initial" });
    }
  }, [manageArtifactForm, manageLifecycleStatus, manageSearch, manageSource, modelClient, workspaceId]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    recordSectionLoadMilestone("renderer.section.load.skipped", { pageKey: "models", sectionKey: "models.remote-browse", trigger: "initial" });
    recordSectionLoadMilestone("renderer.section.load.skipped", { pageKey: "models", sectionKey: "models.training", trigger: "initial" });
    recordSectionLoadMilestone("renderer.section.load.skipped", { pageKey: "models", sectionKey: "models.validation", trigger: "initial" });
    recordSectionLoadMilestone("renderer.section.load.skipped", { pageKey: "models", sectionKey: "models.publish", trigger: "initial" });
  }, []);

  const downloadModel = useCallback(async (model?: DesktopModelBrowseItem) => {
    const modelToDownload = model ?? selectedBrowseModel;
    if (!modelToDownload) {
      return;
    }
    setDownloadState({ status: "loading", message: "Downloading model..." });
    try {
      if (!workspaceId) { setDownloadState({ status: "error", message: "Select a workspace before downloading models." }); return; }
      const downloadRequest = {
        workspaceId,
        modelId: modelToDownload.modelId,
        displayName: modelToDownload.displayName,
        inferenceMode: modelToDownload.inferenceMode,
        taskTags: modelToDownload.taskTags,
        metadata: {
          source: "huggingface",
          likes: modelToDownload.likes,
          downloads: modelToDownload.downloads,
          gated: modelToDownload.gated,
          private: modelToDownload.private,
          license: modelToDownload.license,
        },
      };
      if (modelClient.startModelDownload) {
        await modelClient.startModelDownload(downloadRequest);
        setDownloadState({ status: "success" });
      } else {
        await modelClient.downloadModel(downloadRequest);
        setDownloadState({ status: "success", message: "Model downloaded." });
        await refreshModels();
      }
    } catch (error) {
      setDownloadState({ status: "error", message: error instanceof Error ? error.message : "Failed to download model." });
    }
  }, [modelClient, refreshModels, selectedBrowseModel, workspaceId]);

  const confirmDeleteModelRecord = useCallback(async () => {
    if (!pendingDeleteModelRecordId || deleteConfirmationInput !== "Delete") {
      return;
    }
    if (!workspaceId) { setManageState({ status: "error", message: "Select a workspace before deleting model records." }); return; }
    try {
      await modelClient.deleteModelRecord({ workspaceId, modelRecordId: pendingDeleteModelRecordId, deleteBackingArtifacts: false, deleteLocalFiles: false });
      setPendingDeleteModelRecordId(undefined);
      setDeleteConfirmationInput("");
      await refreshModels();
    } catch (error) {
      setManageState({ status: "error", message: error instanceof Error ? error.message : "Failed to delete the model record." });
    }
  }, [deleteConfirmationInput, modelClient, pendingDeleteModelRecordId, refreshModels, workspaceId]);

  const revealManagedModelInFolder = useCallback(async () => {
    if (!selectedManagedModel) {
      return;
    }
    if (!workspaceId) {
      setFolderOpenState({ status: "error", message: "Select a workspace before opening model files." });
      return;
    }
    setFolderOpenState({ status: "loading" });
    try {
      await modelClient.revealModelInFolder({
        workspaceId,
        modelRecordId: selectedManagedModel.modelRecordId,
      });
      setFolderOpenState({ status: "success" });
    } catch (error) {
      setFolderOpenState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to open the model folder.",
      });
    }
  }, [modelClient, selectedManagedModel, workspaceId]);

  const lifecycleCounts = useMemo(() => ({
    saved: models.filter((item) => item.lifecycleStatus === "saved-reference").length,
    generated: models.filter((item) => item.lifecycleStatus === "generated").length,
    downloaded: models.filter((item) => item.lifecycleStatus === "downloaded").length,
    shared: models.filter((item) => item.storageScope === "shared").length,
  }), [models]);

  const validateManagedModel = useCallback(async () => {
    if (!selectedManagedModel) {
      return;
    }
    setManageState({ status: "loading", message: "Validating model..." });
    try {
      if (!workspaceId) { setManageState({ status: "error", message: "Select a workspace before validating models." }); return; }
      const result = await modelClient.validateModel({ workspaceId, modelRecordId: selectedManagedModel.modelRecordId });
      await refreshModels();
      setManageState({ status: result.status === "invalid" ? "error" : "success", message: `Validation ${result.status}.` });
    } catch (error) {
      setManageState({ status: "error", message: error instanceof Error ? error.message : "Validation failed." });
    }
  }, [modelClient, refreshModels, selectedManagedModel, workspaceId]);

  const publishManagedModel = useCallback(async () => {
    if (!selectedManagedModel || publishRepository.trim().length === 0) {
      return;
    }
    setManageState({ status: "loading", message: "Publishing model..." });
    try {
      if (!workspaceId) { setManageState({ status: "error", message: "Select a workspace before publishing models." }); return; }
      const result = await modelClient.publishModel({ workspaceId, modelRecordId: selectedManagedModel.modelRecordId, repository: publishRepository.trim() });
      await refreshModels();
      setManageState({ status: result.published ? "success" : "error", message: result.published ? "Model published." : "Publish failed." });
    } catch (error) {
      setManageState({ status: "error", message: error instanceof Error ? error.message : "Publish failed." });
    }
  }, [modelClient, publishRepository, refreshModels, selectedManagedModel, workspaceId]);

  return {
    workspaceId,
    browseQuery,
    setBrowseQuery,
    browseTaskTag,
    setBrowseTaskTag,
    browseOtherTaskTag,
    setBrowseOtherTaskTag,
    browseLimit,
    setBrowseLimit,
    browseState,
    browseItems,
    browsePageIndex,
    browseNextCursor,
    selectedBrowseModel,
    selectedBrowseModelDetails,
    detailsState,
    saveState,
    downloadState,
    searchModels,
    searchNextPage,
    searchPreviousPage,
    selectBrowseModel,
    saveModelReference,
    downloadModel,
    manageState,
    models,
    manageSource,
    setManageSource,
    manageLifecycleStatus,
    setManageLifecycleStatus,
    manageArtifactForm,
    setManageArtifactForm,
    manageSearch,
    setManageSearch,
    selectedManagedModel,
    setSelectedManagedModel,
    refreshModels,
    pendingDeleteModelRecordId,
    setPendingDeleteModelRecordId,
    deleteConfirmationInput,
    setDeleteConfirmationInput,
    confirmDeleteModelRecord,
    revealManagedModelInFolder,
    folderOpenState,
    lifecycleCounts,
    validateManagedModel,
    publishManagedModel,
    publishRepository,
    setPublishRepository,
  };
}
