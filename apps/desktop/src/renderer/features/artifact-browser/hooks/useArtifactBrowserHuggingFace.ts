import { useState } from "react";

import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type {
  DesktopHuggingFaceDatasetParquetFile,
  DesktopHuggingFaceNamespaceDataset,
  DesktopLocalizedArtifactFromRepo,
} from "../../../lib/desktopApi";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";

interface UseArtifactBrowserHuggingFaceParams {
  client: DesktopArtifactBrowserClient;
  refreshArtifacts: () => Promise<void>;
  selectArtifact: (storageKey: string) => Promise<void>;
  selectedStorageKey?: string;
}

export function withHuggingFaceAuthGuidance(message: string): string {
  const normalized = message.toLowerCase();
  const mentionsAuth = normalized.includes("hugging face")
    && (
      normalized.includes("token")
      || normalized.includes("auth")
      || normalized.includes("401")
      || normalized.includes("403")
      || normalized.includes("access denied")
      || normalized.includes("private")
      || normalized.includes("gated")
    );
  if (!mentionsAuth) {
    return message;
  }

  return `${message} This Hugging Face repository may require an access token. Open Hugging Face token settings in this page to configure desktop-host access for private or gated repos.`;
}

export function useArtifactBrowserHuggingFace({
  client,
  refreshArtifacts,
  selectArtifact,
  selectedStorageKey,
}: UseArtifactBrowserHuggingFaceParams) {
  type DatasetFilesPanelState = {
    files: DesktopHuggingFaceDatasetParquetFile[];
    state: ArtifactBrowserViewState;
  };

  const [registerState, setRegisterState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [localizeState, setLocalizeState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [sourceVerifyState, setSourceVerifyState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [localizedArtifact, setLocalizedArtifact] = useState<DesktopLocalizedArtifactFromRepo | undefined>();
  const [registerRepository, setRegisterRepository] = useState("");
  const [registerNamespace, setRegisterNamespace] = useState("");
  const [registerPathInRepo, setRegisterPathInRepo] = useState("");
  const [registerRevision, setRegisterRevision] = useState("main");
  const [registerMediaType, setRegisterMediaType] = useState("");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [huggingFaceNamespaceDatasets, setHuggingFaceNamespaceDatasets] = useState<DesktopHuggingFaceNamespaceDataset[]>([]);
  const [datasetFilesByRepository, setDatasetFilesByRepository] = useState<Record<string, DatasetFilesPanelState>>({});
  const [expandedHuggingFaceDataset, setExpandedHuggingFaceDataset] = useState<string | undefined>();
  const [tokenInput, setTokenInput] = useState("");
  const [tokenState, setTokenState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [huggingFaceTokenStatus, setHuggingFaceTokenStatus] = useState<{ configured: boolean; maskedToken?: string }>({
    configured: false,
  });

  async function saveHuggingFaceToken(): Promise<void> {
    setTokenState({ status: "loading", message: "Saving Hugging Face token..." });
    try {
      const status = await client.setHuggingFaceToken({ token: tokenInput });
      setHuggingFaceTokenStatus(status);
      setTokenInput("");
      setTokenState({ status: "success", message: "Hugging Face token saved." });
    } catch (error) {
      setTokenState({ status: "error", message: error instanceof Error ? error.message : "Failed to save Hugging Face token." });
    }
  }

  async function clearHuggingFaceToken(): Promise<void> {
    setTokenState({ status: "loading", message: "Removing Hugging Face token..." });
    try {
      const status = await client.clearHuggingFaceToken();
      setHuggingFaceTokenStatus(status);
      setTokenInput("");
      setTokenState({ status: "success", message: "Hugging Face token removed." });
    } catch (error) {
      setTokenState({ status: "error", message: error instanceof Error ? error.message : "Failed to remove Hugging Face token." });
    }
  }

  async function registerArtifactFromHuggingFace(
    input: {
      repository?: string;
      pathInRepo?: string;
      revision?: string;
      mediaType?: string;
    } = {},
  ): Promise<void> {
    setRegisterState({ status: "loading", message: "Registering remote artifact..." });
    const repository = input.repository ?? registerRepository;
    const pathInRepo = input.pathInRepo ?? registerPathInRepo;
    const revision = input.revision ?? registerRevision;
    const mediaType = input.mediaType ?? registerMediaType;

    try {
      const registered = await client.registerArtifactFromRepo({
        repository,
        path: pathInRepo,
        revision,
        mediaType: mediaType || undefined,
      });
      setRegisterRepository(repository);
      setRegisterPathInRepo(pathInRepo);
      setRegisterRevision(revision);
      setRegisterMediaType(mediaType);
      await refreshArtifacts();
      await selectArtifact(registered.artifactId);
      setRegisterState({
        status: "success",
        message: `Registered ${registered.artifactId} from Hugging Face.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to register artifact from repo.";
      setRegisterState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  async function registerHuggingFaceNamespace(): Promise<void> {
    setRegisterState({ status: "loading", message: "Loading namespace datasets..." });
    try {
      if (!client.browseHuggingFaceNamespaceDatasets) {
        throw new Error("Namespace browsing is unavailable for this client.");
      }
      const datasets = await client.browseHuggingFaceNamespaceDatasets({
        namespace: registerNamespace,
      });
      setHuggingFaceNamespaceDatasets(datasets);
      setDatasetFilesByRepository({});
      setExpandedHuggingFaceDataset(undefined);
      setRegisterState({
        status: "success",
        message: datasets.length > 0
          ? `Registered namespace ${registerNamespace} and loaded datasets.`
          : `Registered namespace ${registerNamespace}. No datasets found.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load namespace datasets.";
      setRegisterState({ status: "error", message: withHuggingFaceAuthGuidance(message) });
    }
  }

  async function browseHuggingFaceDatasetParquetFiles(repository: string): Promise<void> {
    setExpandedHuggingFaceDataset(repository);
    setDatasetFilesByRepository((current) => ({
      ...current,
      [repository]: {
        files: current[repository]?.files ?? [],
        state: { status: "loading", message: `Loading files for ${repository}...` },
      },
    }));
    try {
      if (!client.browseHuggingFaceDatasetParquetFiles) {
        throw new Error("Dataset file browsing is unavailable for this client.");
      }
      const files = await client.browseHuggingFaceDatasetParquetFiles({
        repository,
        revision: registerRevision,
      });
      setRegisterRepository(repository);
      setDatasetFilesByRepository((current) => ({
        ...current,
        [repository]: {
          files,
          state: {
            status: "success",
            message: files.length > 0 ? `Loaded ${files.length} file(s).` : "No files found for this dataset.",
          },
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load dataset files.";
      setDatasetFilesByRepository((current) => ({
        ...current,
        [repository]: {
          files: current[repository]?.files ?? [],
          state: { status: "error", message: withHuggingFaceAuthGuidance(message) },
        },
      }));
    }
  }

  function closeHuggingFaceDatasetParquetFiles(): void {
    setExpandedHuggingFaceDataset(undefined);
  }

  function getHuggingFaceDatasetParquetFiles(repository: string): DesktopHuggingFaceDatasetParquetFile[] {
    return datasetFilesByRepository[repository]?.files ?? [];
  }

  function getHuggingFaceDatasetFilesState(repository: string): ArtifactBrowserViewState {
    return datasetFilesByRepository[repository]?.state ?? { status: "idle", message: "Select View Files to load files." };
  }

  async function localizeArtifactFromRepo(): Promise<void> {
    if (!selectedStorageKey) {
      setLocalizeState({ status: "error", message: "Select an artifact before localizing." });
      return;
    }

    setLocalizeState({ status: "loading", message: "Localizing imported artifact bytes..." });
    try {
      const localized = await client.localizeArtifactFromRepo({
        artifactId: selectedStorageKey,
      });
      setLocalizedArtifact(localized);
      await refreshArtifacts();
      await selectArtifact(selectedStorageKey);
      setLocalizeState({
        status: "success",
        message: `Localized ${localized.artifactId} to local object storage.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to localize imported artifact.";
      setLocalizeState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  async function recheckSourceBacking(): Promise<void> {
    if (!selectedStorageKey) {
      setSourceVerifyState({ status: "error", message: "Select an artifact before verification." });
      return;
    }

    setSourceVerifyState({ status: "loading", message: "Verifying imported source backing..." });
    try {
      if (!client.verifyImportedSourceBacking) {
        throw new Error("Source verification is unavailable for this client.");
      }
      await client.verifyImportedSourceBacking({
        artifactId: selectedStorageKey,
      });
      await refreshArtifacts();
      await selectArtifact(selectedStorageKey);
      setSourceVerifyState({
        status: "success",
        message: "Imported source backing verification refreshed.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify imported source backing.";
      setSourceVerifyState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  return {
    registerState,
    localizeState,
    sourceVerifyState,
    localizedArtifact,
    registerForm: {
      namespace: registerNamespace,
      repository: registerRepository,
      pathInRepo: registerPathInRepo,
      revision: registerRevision,
      mediaType: registerMediaType,
      showRegisterForm,
    },
    setRegisterRepository,
    setRegisterNamespace,
    setRegisterPathInRepo,
    setRegisterRevision,
    setRegisterMediaType,
    toggleRegisterForm: () => setShowRegisterForm((current) => !current),
    registerArtifactFromHuggingFace,
    registerHuggingFaceNamespace,
    browseHuggingFaceDatasetParquetFiles,
    closeHuggingFaceDatasetParquetFiles,
    huggingFaceNamespaceDatasets,
    getHuggingFaceDatasetParquetFiles,
    getHuggingFaceDatasetFilesState,
    expandedHuggingFaceDataset,
    localizeArtifactFromRepo,
    recheckSourceBacking,
    tokenInput,
    setTokenInput,
    tokenState,
    huggingFaceTokenStatus,
    setHuggingFaceTokenStatus,
    saveHuggingFaceToken,
    clearHuggingFaceToken,
  };
}
