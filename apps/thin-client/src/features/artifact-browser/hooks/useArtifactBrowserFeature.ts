import { useEffect, useState } from "react";

import {
  useArtifactBrowserPublishLogic,
  type ArtifactBrowserViewState,
  type UseArtifactBrowserPublishLogicResult,
} from "../../../../../../modules/ui/shared";
import {
  type ArtifactBrowserApiClient,
  type ThinClientArtifactBrowseItem,
  type ThinClientArtifactContentDescriptor,
  type ThinClientArtifactDetail,
  type ThinClientHuggingFaceDatasetParquetFile,
  type ThinClientHuggingFaceNamespaceDataset,
  type ThinClientLocalizedArtifactFromRepo,
  type ThinClientPublishedBacking,
} from "../api/apiArtifactBrowserClient";
import { useArtifactBrowserClient } from "./useArtifactBrowserClient";

export interface UseArtifactBrowserFeatureResult {
  huggingFaceTokenStatus: { configured: boolean; maskedToken?: string };
  tokenInput: string;
  tokenState: ArtifactBrowserViewState;
  items: ThinClientArtifactBrowseItem[];
  selectedStorageKey?: string;
  detail?: ThinClientArtifactDetail;
  content?: ThinClientArtifactContentDescriptor;
  imageViewUrl?: string;
  publishState: ArtifactBrowserViewState;
  registerState: ArtifactBrowserViewState;
  localizeState: ArtifactBrowserViewState;
  sourceVerifyState: ArtifactBrowserViewState;
  publishedBacking?: ThinClientPublishedBacking;
  localizedArtifact?: ThinClientLocalizedArtifactFromRepo;
  publishForm: UseArtifactBrowserPublishLogicResult["publishForm"];
  registerForm: {
    namespace: string;
    repository: string;
    pathInRepo: string;
    revision: string;
    mediaType: string;
    showRegisterForm: boolean;
  };
  viewState: ArtifactBrowserViewState;
  selectArtifact: (storageKey: string) => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  publishArtifactToHuggingFace: () => Promise<void>;
  registerArtifactFromHuggingFace: (input?: {
    repository?: string;
    pathInRepo?: string;
    revision?: string;
    mediaType?: string;
  }) => Promise<void>;
  registerHuggingFaceNamespace: () => Promise<void>;
  browseHuggingFaceDatasetParquetFiles: (repository: string) => Promise<void>;
  closeHuggingFaceDatasetParquetFiles: () => void;
  huggingFaceNamespaceDatasets: ThinClientHuggingFaceNamespaceDataset[];
  getHuggingFaceDatasetParquetFiles: (repository: string) => ThinClientHuggingFaceDatasetParquetFile[];
  getHuggingFaceDatasetFilesState: (repository: string) => ArtifactBrowserViewState;
  expandedHuggingFaceDataset?: string;
  localizeArtifactFromRepo: () => Promise<void>;
  recheckPublishedBacking: () => Promise<void>;
  recheckSourceBacking: () => Promise<void>;
  setRepository: (value: string) => void;
  setPathInRepo: (value: string) => void;
  setRevision: (value: string) => void;
  setMediaType: (value: string) => void;
  togglePublishForm: () => void;
  setRegisterRepository: (value: string) => void;
  setRegisterNamespace: (value: string) => void;
  setRegisterPathInRepo: (value: string) => void;
  setRegisterRevision: (value: string) => void;
  setRegisterMediaType: (value: string) => void;
  toggleRegisterForm: () => void;
  setTokenInput: (value: string) => void;
  saveHuggingFaceToken: () => Promise<void>;
  clearHuggingFaceToken: () => Promise<void>;
}

export function useArtifactBrowserFeature(
  client?: ArtifactBrowserApiClient,
): UseArtifactBrowserFeatureResult {
  type DatasetFilesPanelState = {
    files: ThinClientHuggingFaceDatasetParquetFile[];
    state: ArtifactBrowserViewState;
  };

  const withHuggingFaceAuthGuidance = (message: string): string => {
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

    return `${message} This Hugging Face repository may require an access token. Open Hugging Face token settings in this page to configure host/server access for private or gated repos.`;
  };

  const artifactClient = useArtifactBrowserClient(client);
  const [items, setItems] = useState<ThinClientArtifactBrowseItem[]>([]);
  const [selectedStorageKey, setSelectedStorageKey] = useState<string | undefined>();
  const [detail, setDetail] = useState<ThinClientArtifactDetail | undefined>();
  const [content, setContent] = useState<ThinClientArtifactContentDescriptor | undefined>();
  const [imageViewUrl, setImageViewUrl] = useState<string | undefined>();
  const [viewState, setViewState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [registerState, setRegisterState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [localizeState, setLocalizeState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [sourceVerifyState, setSourceVerifyState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [localizedArtifact, setLocalizedArtifact] = useState<ThinClientLocalizedArtifactFromRepo | undefined>();
  const [registerRepository, setRegisterRepository] = useState("");
  const [registerNamespace, setRegisterNamespace] = useState("");
  const [registerPathInRepo, setRegisterPathInRepo] = useState("");
  const [registerRevision, setRegisterRevision] = useState("main");
  const [registerMediaType, setRegisterMediaType] = useState("");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [huggingFaceNamespaceDatasets, setHuggingFaceNamespaceDatasets] = useState<ThinClientHuggingFaceNamespaceDataset[]>([]);
  const [datasetFilesByRepository, setDatasetFilesByRepository] = useState<Record<string, DatasetFilesPanelState>>({});
  const [expandedHuggingFaceDataset, setExpandedHuggingFaceDataset] = useState<string | undefined>();
  const [tokenInput, setTokenInput] = useState("");
  const [tokenState, setTokenState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [huggingFaceTokenStatus, setHuggingFaceTokenStatus] = useState<{ configured: boolean; maskedToken?: string }>({
    configured: false,
  });

  const publishLogic = useArtifactBrowserPublishLogic<ThinClientArtifactDetail>({
    selectedStorageKey,
    client: artifactClient,
    async readSelectedArtifactDetail() {
      if (!selectedStorageKey) {
        return undefined;
      }

      const artifactDetail = await artifactClient.readArtifactDetail({ storageKey: selectedStorageKey });
      setDetail(artifactDetail);
      return artifactDetail;
    },
  });

  async function refreshArtifacts(): Promise<void> {
    setViewState({ status: "loading", message: "Loading data artifacts..." });
    try {
      const browseItems = await artifactClient.browseArtifacts();
      setItems(browseItems);
      setViewState({
        status: "success",
        message: browseItems.length > 0 ? "Loaded data artifacts." : "No data artifacts found yet.",
      });
    } catch (error) {
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load data artifacts.",
      });
    }
  }

  useEffect(() => {
    void refreshArtifacts();
    void artifactClient.getHuggingFaceTokenStatus().then(setHuggingFaceTokenStatus).catch(() => {
      setHuggingFaceTokenStatus({ configured: false });
    });
  }, [artifactClient]);

  async function saveHuggingFaceToken(): Promise<void> {
    setTokenState({ status: "loading", message: "Saving Hugging Face token..." });
    try {
      const status = await artifactClient.setHuggingFaceToken({ token: tokenInput });
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
      const status = await artifactClient.clearHuggingFaceToken();
      setHuggingFaceTokenStatus(status);
      setTokenInput("");
      setTokenState({ status: "success", message: "Hugging Face token removed." });
    } catch (error) {
      setTokenState({ status: "error", message: error instanceof Error ? error.message : "Failed to remove Hugging Face token." });
    }
  }

  async function selectArtifact(storageKey: string): Promise<void> {
    setSelectedStorageKey(storageKey);
    setViewState({ status: "loading", message: `Loading ${storageKey}...` });

    try {
      const locator = { storageKey };
      const artifactDetail = await artifactClient.readArtifactDetail(locator);
      setDetail(artifactDetail);
      publishLogic.setPublishedBackingFromDetail(artifactDetail);

      try {
        const contentDescriptor = await artifactClient.readArtifactContent(locator);
        setContent(contentDescriptor);
        if (contentDescriptor.mediaType?.startsWith("image/")) {
          setImageViewUrl(artifactClient.createArtifactMediaViewUrl(locator));
        } else {
          setImageViewUrl(undefined);
        }
      } catch {
        setContent({
          locator,
          availability: "unavailable",
          retrieval: "deferred",
        });
        setImageViewUrl(undefined);
      }

      setViewState({ status: "success", message: `Loaded ${storageKey}.` });
    } catch (error) {
      setDetail(undefined);
      setContent(undefined);
      setImageViewUrl(undefined);
      publishLogic.setPublishedBackingFromDetail(undefined);
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load artifact detail.",
      });
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
      const registered = await artifactClient.registerArtifactFromRepo({
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
      if (!artifactClient.browseHuggingFaceNamespaceDatasets) {
        throw new Error("Namespace browsing is unavailable for this client.");
      }
      const datasets = await artifactClient.browseHuggingFaceNamespaceDatasets({
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
      if (!artifactClient.browseHuggingFaceDatasetParquetFiles) {
        throw new Error("Dataset file browsing is unavailable for this client.");
      }
      const files = await artifactClient.browseHuggingFaceDatasetParquetFiles({
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

  function getHuggingFaceDatasetParquetFiles(repository: string): ThinClientHuggingFaceDatasetParquetFile[] {
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
      const localized = await artifactClient.localizeArtifactFromRepo({
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
      if (!artifactClient.verifyImportedSourceBacking) {
        throw new Error("Source verification is unavailable for this client.");
      }
      await artifactClient.verifyImportedSourceBacking({
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

  async function publishArtifactToHuggingFace(): Promise<void> {
    await publishLogic.publishArtifactToHuggingFace();
    await refreshArtifacts();
  }

  async function recheckPublishedBacking(): Promise<void> {
    await publishLogic.recheckPublishedBacking();
    await refreshArtifacts();
  }

  return {
    huggingFaceTokenStatus,
    tokenInput,
    tokenState,
    items,
    selectedStorageKey,
    detail,
    content,
    imageViewUrl,
    publishState: publishLogic.publishState,
    registerState,
    localizeState,
    sourceVerifyState,
    publishedBacking: publishLogic.publishedBacking,
    localizedArtifact,
    publishForm: publishLogic.publishForm,
    registerForm: {
      namespace: registerNamespace,
      repository: registerRepository,
      pathInRepo: registerPathInRepo,
      revision: registerRevision,
      mediaType: registerMediaType,
      showRegisterForm,
    },
    viewState,
    selectArtifact,
    refreshArtifacts,
    publishArtifactToHuggingFace,
    registerArtifactFromHuggingFace,
    registerHuggingFaceNamespace,
    browseHuggingFaceDatasetParquetFiles,
    closeHuggingFaceDatasetParquetFiles,
    huggingFaceNamespaceDatasets,
    getHuggingFaceDatasetParquetFiles,
    getHuggingFaceDatasetFilesState,
    expandedHuggingFaceDataset,
    localizeArtifactFromRepo,
    recheckPublishedBacking,
    recheckSourceBacking,
    setRepository: publishLogic.setRepository,
    setPathInRepo: publishLogic.setPathInRepo,
    setRevision: publishLogic.setRevision,
    setMediaType: publishLogic.setMediaType,
    togglePublishForm: publishLogic.togglePublishForm,
    setRegisterRepository,
    setRegisterNamespace,
    setRegisterPathInRepo,
    setRegisterRevision,
    setRegisterMediaType,
    toggleRegisterForm: () => setShowRegisterForm((current) => !current),
    setTokenInput,
    saveHuggingFaceToken,
    clearHuggingFaceToken,
  };
}

