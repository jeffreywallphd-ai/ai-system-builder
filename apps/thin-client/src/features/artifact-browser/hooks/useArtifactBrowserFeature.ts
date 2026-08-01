import { useEffect, useRef, useState } from "react";

import {
  ARTIFACT_PREVIEW_MAX_BYTES,
  ARTIFACT_PDF_PREVIEW_MAX_BYTES,
  createCompressedImagePreviewObjectUrl,
  createIdleArtifactPreview,
  createLoadingArtifactPreview,
  createMediaArtifactPreview,
  createPdfFirstPagePreviewObjectUrl,
  createTextArtifactPreview,
  createUnavailableArtifactPreview,
  createUnsupportedArtifactPreview,
  describeArtifactPreview,
  isArtifactBrowserVisible,
  isMediaArtifactPreviewKind,
  isTextArtifactPreviewKind,
  useArtifactBrowserPublishLogic,
  type ArtifactBrowserViewState,
  type ArtifactPreviewSource,
  type ArtifactPreviewView,
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

const ARTIFACT_MEDIA_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export interface UseArtifactBrowserFeatureResult {
  items: ThinClientArtifactBrowseItem[];
  selectedStorageKey?: string;
  detail?: ThinClientArtifactDetail;
  content?: ThinClientArtifactContentDescriptor;
  imageViewUrl?: string;
  artifactPreview: ArtifactPreviewView;
  canSelectPreviousImage: boolean;
  canSelectNextImage: boolean;
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
  pendingDeleteStorageKey?: string;
  deleteConfirmationInput: string;
  selectedArtifactKeys: string[];
  bulkDeleteConfirmationInput: string;
  selectArtifact: (storageKey: string) => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  selectPreviousImage: () => Promise<void>;
  selectNextImage: () => Promise<void>;
  requestDeleteRegisteredArtifact: (storageKey: string) => void;
  confirmPendingDelete: () => Promise<void>;
  cancelPendingDelete: () => void;
  setDeleteConfirmationInput: (value: string) => void;
  toggleSelectedArtifactKey: (storageKey: string) => void;
  clearSelectedArtifactKeys: () => void;
  toggleAllArtifactKeys: () => void;
  areAllArtifactKeysSelected: boolean;
  setBulkDeleteConfirmationInput: (value: string) => void;
  deleteSelectedArtifacts: () => Promise<void>;
  publishArtifactToHuggingFace: (input?: {
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
    repositoryCreation?: {
      approved: true;
      visibility: "private" | "public";
    };
  }) => Promise<void>;
  registerArtifactFromHuggingFace: (input?: {
    repository?: string;
    pathInRepo?: string;
    revision?: string;
    mediaType?: string;
    repositoryCreation?: {
      approved: true;
      visibility: "private" | "public";
    };
  }) => Promise<void>;
  registerHuggingFaceNamespace: () => Promise<void>;
  browseHuggingFaceDatasetParquetFiles: (repository: string) => Promise<void>;
  closeHuggingFaceDatasetParquetFiles: () => void;
  huggingFaceNamespaceDatasets: ThinClientHuggingFaceNamespaceDataset[];
  getHuggingFaceDatasetParquetFiles: (
    repository: string,
  ) => ThinClientHuggingFaceDatasetParquetFile[];
  getHuggingFaceDatasetFilesState: (
    repository: string,
  ) => ArtifactBrowserViewState;
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
}

export function useArtifactBrowserFeature(
  client?: ArtifactBrowserApiClient,
  workspaceId?: string,
): UseArtifactBrowserFeatureResult {
  type DatasetFilesPanelState = {
    files: ThinClientHuggingFaceDatasetParquetFile[];
    state: ArtifactBrowserViewState;
  };

  const withHuggingFaceAuthGuidance = (message: string): string => {
    const normalized = message.toLowerCase();
    const mentionsAuth =
      normalized.includes("hugging face") &&
      (normalized.includes("token") ||
        normalized.includes("auth") ||
        normalized.includes("401") ||
        normalized.includes("403") ||
        normalized.includes("access denied") ||
        normalized.includes("private") ||
        normalized.includes("gated"));
    if (!mentionsAuth) {
      return message;
    }

    return `${message} This Hugging Face repository may require a host/server Hugging Face token for private or gated repos.`;
  };

  const artifactClient = useArtifactBrowserClient(client);
  const [items, setItems] = useState<ThinClientArtifactBrowseItem[]>([]);
  const [selectedStorageKey, setSelectedStorageKey] = useState<
    string | undefined
  >();
  const [detail, setDetail] = useState<ThinClientArtifactDetail | undefined>();
  const [content, setContent] = useState<
    ThinClientArtifactContentDescriptor | undefined
  >();
  const [imageViewUrl, setImageViewUrl] = useState<string | undefined>();
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewView>(
    () => createIdleArtifactPreview(),
  );
  const activeImagePreviewObjectUrl = useRef<string | undefined>(undefined);
  const [viewState, setViewState] = useState<ArtifactBrowserViewState>({
    status: "idle",
  });
  const [registerState, setRegisterState] = useState<ArtifactBrowserViewState>({
    status: "idle",
  });
  const [localizeState, setLocalizeState] = useState<ArtifactBrowserViewState>({
    status: "idle",
  });
  const [sourceVerifyState, setSourceVerifyState] =
    useState<ArtifactBrowserViewState>({ status: "idle" });
  const [localizedArtifact, setLocalizedArtifact] = useState<
    ThinClientLocalizedArtifactFromRepo | undefined
  >();
  const [registerRepository, setRegisterRepository] = useState("");
  const [registerNamespace, setRegisterNamespace] = useState("");
  const [registerPathInRepo, setRegisterPathInRepo] = useState("");
  const [registerRevision, setRegisterRevision] = useState("main");
  const [registerMediaType, setRegisterMediaType] = useState("");
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [huggingFaceNamespaceDatasets, setHuggingFaceNamespaceDatasets] =
    useState<ThinClientHuggingFaceNamespaceDataset[]>([]);
  const [datasetFilesByRepository, setDatasetFilesByRepository] = useState<
    Record<string, DatasetFilesPanelState>
  >({});
  const [expandedHuggingFaceDataset, setExpandedHuggingFaceDataset] = useState<
    string | undefined
  >();
  const [pendingDeleteStorageKey, setPendingDeleteStorageKey] = useState<
    string | undefined
  >();
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("");
  const [selectedArtifactKeys, setSelectedArtifactKeys] = useState<string[]>(
    [],
  );
  const [bulkDeleteConfirmationInput, setBulkDeleteConfirmationInput] =
    useState("");

  function revokeManagedImagePreviewUrl(): void {
    if (!activeImagePreviewObjectUrl.current) {
      return;
    }

    URL.revokeObjectURL(activeImagePreviewObjectUrl.current);
    activeImagePreviewObjectUrl.current = undefined;
  }

  function setManagedImagePreviewUrl(nextUrl: string): void {
    if (activeImagePreviewObjectUrl.current !== nextUrl) {
      revokeManagedImagePreviewUrl();
    }

    activeImagePreviewObjectUrl.current = nextUrl;
    setImageViewUrl(nextUrl);
  }

  function setUnmanagedImagePreviewUrl(nextUrl?: string): void {
    revokeManagedImagePreviewUrl();
    setImageViewUrl(nextUrl);
  }

  const publishLogic = useArtifactBrowserPublishLogic<ThinClientArtifactDetail>(
    {
      workspaceId,
      selectedStorageKey,
      client: artifactClient,
      async readSelectedArtifactDetail() {
        if (!selectedStorageKey) {
          return undefined;
        }

        const artifactDetail = await artifactClient.readArtifactDetail(
          { storageKey: selectedStorageKey },
          { workspaceId },
        );
        setDetail(artifactDetail);
        return artifactDetail;
      },
    },
  );

  async function refreshArtifacts(): Promise<void> {
    setViewState({ status: "loading", message: "Loading data artifacts..." });
    try {
      if (!workspaceId) {
        setItems([]);
        setSelectedStorageKey(undefined);
        setDetail(undefined);
        setContent(undefined);
        setUnmanagedImagePreviewUrl(undefined);
        setArtifactPreview(createIdleArtifactPreview());
        setViewState({
          status: "success",
          message: "No data artifacts found yet.",
        });
        return;
      }
      const browseItems = (
        await artifactClient.browseArtifacts({ workspaceId })
      ).filter(isArtifactBrowserVisible);
      setItems(browseItems);
      setSelectedStorageKey((current) =>
        browseItems.some((item) => item.storageKey === current)
          ? current
          : undefined,
      );
      setViewState({
        status: "success",
        ...(browseItems.length > 0
          ? {}
          : { message: "No data artifacts found yet." }),
      });
    } catch (error) {
      setViewState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load data artifacts.",
      });
    }
  }

  useEffect(() => {
    void refreshArtifacts();
  }, [artifactClient, workspaceId]);

  useEffect(
    () => () => {
      revokeManagedImagePreviewUrl();
    },
    [],
  );

  async function selectArtifact(storageKey: string): Promise<void> {
    setSelectedStorageKey(storageKey);
    setArtifactPreview(createLoadingArtifactPreview({ storageKey }));
    setViewState({ status: "loading", message: `Loading ${storageKey}...` });

    try {
      const locator = { storageKey };
      const artifactDetail = await artifactClient.readArtifactDetail(locator, {
        workspaceId,
      });
      setDetail(artifactDetail);
      publishLogic.setPublishedBackingFromDetail(artifactDetail);

      try {
        const contentDescriptor = await artifactClient.readArtifactContent(
          locator,
          { workspaceId },
        );
        setContent(contentDescriptor);
        const previewSource: ArtifactPreviewSource = {
          storageKey,
          originalName: artifactDetail.originalName,
          mediaType: contentDescriptor.mediaType ?? artifactDetail.mediaType,
          artifactFamily: artifactDetail.artifactFamily,
        };
        const previewDescriptor = describeArtifactPreview(previewSource);

        if (contentDescriptor.availability !== "available") {
          setUnmanagedImagePreviewUrl(undefined);
          setArtifactPreview(createUnavailableArtifactPreview(previewSource));
        } else if (isMediaArtifactPreviewKind(previewDescriptor.kind)) {
          if (previewDescriptor.kind === "image") {
            if (artifactClient.readArtifactMedia) {
              try {
                const media = await artifactClient.readArtifactMedia(locator, {
                  workspaceId,
                  maximumBytes: ARTIFACT_MEDIA_PREVIEW_MAX_BYTES,
                });
                const compressedUrl =
                  await createCompressedImagePreviewObjectUrl(
                    media.bytes,
                    media.mediaType ?? previewSource.mediaType,
                  );
                setManagedImagePreviewUrl(compressedUrl);
                setArtifactPreview(
                  createMediaArtifactPreview(
                    {
                      ...previewSource,
                      mediaType: media.mediaType ?? previewSource.mediaType,
                    },
                    compressedUrl,
                  ),
                );
              } catch {
                const fallbackUrl = artifactClient.createArtifactMediaViewUrl(
                  locator,
                  {
                    workspaceId,
                    maximumBytes: ARTIFACT_MEDIA_PREVIEW_MAX_BYTES,
                  },
                );
                setUnmanagedImagePreviewUrl(fallbackUrl);
                setArtifactPreview(
                  createMediaArtifactPreview(previewSource, fallbackUrl),
                );
              }
            } else {
              const mediaUrl = artifactClient.createArtifactMediaViewUrl(
                locator,
                {
                  workspaceId,
                  maximumBytes: ARTIFACT_MEDIA_PREVIEW_MAX_BYTES,
                },
              );
              setUnmanagedImagePreviewUrl(mediaUrl);
              setArtifactPreview(
                createMediaArtifactPreview(previewSource, mediaUrl),
              );
            }
          } else if (previewDescriptor.kind === "pdf") {
            if (!artifactClient.readArtifactMedia) {
              setUnmanagedImagePreviewUrl(undefined);
              setArtifactPreview(
                createUnavailableArtifactPreview(
                  previewSource,
                  "PDF preview bytes are unavailable in this connection.",
                ),
              );
            } else {
              const media = await artifactClient.readArtifactMedia(locator, {
                workspaceId,
                maximumBytes: ARTIFACT_PDF_PREVIEW_MAX_BYTES,
              });
              const firstPageUrl =
                await createPdfFirstPagePreviewObjectUrl(media.bytes);
              setManagedImagePreviewUrl(firstPageUrl);
              setArtifactPreview(
                createMediaArtifactPreview(
                  { ...previewSource, mediaType: "application/pdf" },
                  firstPageUrl,
                ),
              );
            }
          } else {
            const mediaUrl = artifactClient.createArtifactMediaViewUrl(
              locator,
              {
                workspaceId,
                maximumBytes: ARTIFACT_MEDIA_PREVIEW_MAX_BYTES,
              },
            );
            setUnmanagedImagePreviewUrl(undefined);
            setArtifactPreview(
              createMediaArtifactPreview(previewSource, mediaUrl),
            );
          }
        } else if (isTextArtifactPreviewKind(previewDescriptor.kind)) {
          setUnmanagedImagePreviewUrl(undefined);
          if (artifactClient.readArtifactMedia) {
            try {
              const media = await artifactClient.readArtifactMedia(locator, {
                workspaceId,
                maximumBytes: ARTIFACT_PREVIEW_MAX_BYTES,
              });
              setArtifactPreview(
                createTextArtifactPreview(
                  {
                    ...previewSource,
                    mediaType: media.mediaType ?? previewSource.mediaType,
                  },
                  media.bytes,
                ),
              );
            } catch {
              setArtifactPreview(
                createUnavailableArtifactPreview(
                  previewSource,
                  "Preview text could not be prepared for this artifact.",
                ),
              );
            }
          } else {
            setArtifactPreview(
              createUnavailableArtifactPreview(
                previewSource,
                "Preview text is unavailable in this connection.",
              ),
            );
          }
        } else {
          setUnmanagedImagePreviewUrl(undefined);
          setArtifactPreview(createUnsupportedArtifactPreview(previewSource));
        }
      } catch {
        setContent({
          locator,
          availability: "unavailable",
          retrieval: "deferred",
        });
        setUnmanagedImagePreviewUrl(undefined);
        setArtifactPreview(createUnavailableArtifactPreview({ storageKey }));
      }

      setViewState({ status: "success" });
    } catch (error) {
      setDetail(undefined);
      setContent(undefined);
      setUnmanagedImagePreviewUrl(undefined);
      setArtifactPreview(createIdleArtifactPreview());
      publishLogic.setPublishedBackingFromDetail(undefined);
      setViewState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load artifact detail.",
      });
    }
  }

  function requestDeleteRegisteredArtifact(storageKey: string): void {
    setPendingDeleteStorageKey(storageKey);
    setDeleteConfirmationInput("");
  }

  function cancelPendingDelete(): void {
    setPendingDeleteStorageKey(undefined);
    setDeleteConfirmationInput("");
  }

  async function confirmPendingDelete(): Promise<void> {
    if (!pendingDeleteStorageKey) {
      return;
    }
    if (!workspaceId) {
      setViewState({
        status: "error",
        message: "Select a workspace before deleting artifacts.",
      });
      return;
    }
    if (deleteConfirmationInput !== "Delete") {
      setViewState({
        status: "error",
        message: "Type Delete to confirm artifact deletion.",
      });
      return;
    }

    const storageKey = pendingDeleteStorageKey;
    setViewState({ status: "loading", message: `Deleting ${storageKey}...` });
    try {
      await artifactClient.deleteRegisteredArtifact(
        { storageKey },
        { workspaceId },
      );
      setPendingDeleteStorageKey(undefined);
      setDeleteConfirmationInput("");
      if (selectedStorageKey === storageKey) {
        setSelectedStorageKey(undefined);
        setDetail(undefined);
        setContent(undefined);
        setUnmanagedImagePreviewUrl(undefined);
        setArtifactPreview(createIdleArtifactPreview());
        publishLogic.setPublishedBackingFromDetail(undefined);
      }
      await refreshArtifacts();
      setViewState({ status: "success", message: `Deleted ${storageKey}.` });
    } catch (error) {
      setViewState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Failed to delete artifact.",
      });
    }
  }
  function toggleSelectedArtifactKey(storageKey: string): void {
    setSelectedArtifactKeys((current) =>
      current.includes(storageKey)
        ? current.filter((key) => key !== storageKey)
        : [...current, storageKey],
    );
  }
  function clearSelectedArtifactKeys(): void {
    setSelectedArtifactKeys([]);
    setBulkDeleteConfirmationInput("");
  }

  const listedArtifactKeys = items.map((item) => item.storageKey);
  const areAllArtifactKeysSelected =
    listedArtifactKeys.length > 0 &&
    listedArtifactKeys.every((storageKey) =>
      selectedArtifactKeys.includes(storageKey),
    );

  function toggleAllArtifactKeys(): void {
    if (areAllArtifactKeysSelected) {
      clearSelectedArtifactKeys();
      return;
    }

    setSelectedArtifactKeys(listedArtifactKeys);
  }

  async function deleteSelectedArtifacts(): Promise<void> {
    if (selectedArtifactKeys.length === 0) return;
    if (!workspaceId) {
      setViewState({
        status: "error",
        message: "Select a workspace before deleting artifacts.",
      });
      return;
    }
    if (bulkDeleteConfirmationInput !== "Delete All") {
      setViewState({
        status: "error",
        message: "Type Delete All to confirm bulk artifact deletion.",
      });
      return;
    }
    setViewState({
      status: "loading",
      message: `Deleting ${selectedArtifactKeys.length} artifact(s)...`,
    });
    try {
      await Promise.all(
        selectedArtifactKeys.map(async (storageKey) =>
          artifactClient.deleteRegisteredArtifact(
            { storageKey },
            { workspaceId },
          ),
        ),
      );
      if (
        selectedStorageKey &&
        selectedArtifactKeys.includes(selectedStorageKey)
      ) {
        setSelectedStorageKey(undefined);
        setDetail(undefined);
        setContent(undefined);
        setUnmanagedImagePreviewUrl(undefined);
        setArtifactPreview(createIdleArtifactPreview());
        publishLogic.setPublishedBackingFromDetail(undefined);
      }
      const deletedCount = selectedArtifactKeys.length;
      clearSelectedArtifactKeys();
      await refreshArtifacts();
      setViewState({
        status: "success",
        message: `Deleted ${deletedCount} artifact(s).`,
      });
    } catch (error) {
      setViewState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to delete selected artifacts.",
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
    setRegisterState({
      status: "loading",
      message: "Registering remote artifact...",
    });
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
      const message =
        error instanceof Error
          ? error.message
          : "Failed to register artifact from repo.";
      setRegisterState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  async function registerHuggingFaceNamespace(): Promise<void> {
    setRegisterState({
      status: "loading",
      message: "Loading namespace datasets...",
    });
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
        message:
          datasets.length > 0
            ? `Registered namespace ${registerNamespace} and loaded datasets.`
            : `Registered namespace ${registerNamespace}. No datasets found.`,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load namespace datasets.";
      setRegisterState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  async function browseHuggingFaceDatasetParquetFiles(
    repository: string,
  ): Promise<void> {
    setExpandedHuggingFaceDataset(repository);
    setDatasetFilesByRepository((current) => ({
      ...current,
      [repository]: {
        files: current[repository]?.files ?? [],
        state: {
          status: "loading",
          message: `Loading files for ${repository}...`,
        },
      },
    }));
    try {
      if (!artifactClient.browseHuggingFaceDatasetParquetFiles) {
        throw new Error(
          "Dataset file browsing is unavailable for this client.",
        );
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
            ...(files.length > 0
              ? {}
              : { message: "No files found for this dataset." }),
          },
        },
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load dataset files.";
      setDatasetFilesByRepository((current) => ({
        ...current,
        [repository]: {
          files: current[repository]?.files ?? [],
          state: {
            status: "error",
            message: withHuggingFaceAuthGuidance(message),
          },
        },
      }));
    }
  }

  function closeHuggingFaceDatasetParquetFiles(): void {
    setExpandedHuggingFaceDataset(undefined);
  }

  function getHuggingFaceDatasetParquetFiles(
    repository: string,
  ): ThinClientHuggingFaceDatasetParquetFile[] {
    return datasetFilesByRepository[repository]?.files ?? [];
  }

  function getHuggingFaceDatasetFilesState(
    repository: string,
  ): ArtifactBrowserViewState {
    return (
      datasetFilesByRepository[repository]?.state ?? {
        status: "idle",
        message: "Select View Files to load files.",
      }
    );
  }

  async function localizeArtifactFromRepo(): Promise<void> {
    if (!selectedStorageKey) {
      setLocalizeState({
        status: "error",
        message: "Select an artifact before localizing.",
      });
      return;
    }
    if (!workspaceId) {
      setLocalizeState({
        status: "error",
        message: "Choose a workspace before localizing.",
      });
      return;
    }

    setLocalizeState({
      status: "loading",
      message: "Localizing imported artifact bytes...",
    });
    try {
      const localized = await artifactClient.localizeArtifactFromRepo({
        workspaceId,
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
      const message =
        error instanceof Error
          ? error.message
          : "Failed to localize imported artifact.";
      setLocalizeState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  async function recheckSourceBacking(): Promise<void> {
    if (!selectedStorageKey) {
      setSourceVerifyState({
        status: "error",
        message: "Select an artifact before verification.",
      });
      return;
    }

    setSourceVerifyState({
      status: "loading",
      message: "Verifying imported source backing...",
    });
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
      const message =
        error instanceof Error
          ? error.message
          : "Failed to verify imported source backing.";
      setSourceVerifyState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  async function publishArtifactToHuggingFace(input?: {
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
  }): Promise<void> {
    await publishLogic.publishArtifactToHuggingFace(input);
    await refreshArtifacts();
  }

  async function recheckPublishedBacking(): Promise<void> {
    await publishLogic.recheckPublishedBacking();
    await refreshArtifacts();
  }

  const imageItems = items.filter(
    (item) =>
      item.artifactFamily === "image" || item.mediaType?.startsWith("image/"),
  );
  const selectedImageIndex = selectedStorageKey
    ? imageItems.findIndex((item) => item.storageKey === selectedStorageKey)
    : -1;
  const canSelectPreviousImage = selectedImageIndex > 0;
  const canSelectNextImage =
    selectedImageIndex >= 0 && selectedImageIndex < imageItems.length - 1;

  async function selectAdjacentImage(offset: -1 | 1): Promise<void> {
    const nextItem = imageItems[selectedImageIndex + offset];
    if (!nextItem) {
      return;
    }

    await selectArtifact(nextItem.storageKey);
  }

  return {
    items,
    selectedStorageKey,
    detail,
    content,
    imageViewUrl,
    artifactPreview,
    canSelectPreviousImage,
    canSelectNextImage,
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
    pendingDeleteStorageKey,
    deleteConfirmationInput,
    selectedArtifactKeys,
    bulkDeleteConfirmationInput,
    selectArtifact,
    refreshArtifacts,
    selectPreviousImage: () => selectAdjacentImage(-1),
    selectNextImage: () => selectAdjacentImage(1),
    requestDeleteRegisteredArtifact,
    confirmPendingDelete,
    cancelPendingDelete,
    toggleSelectedArtifactKey,
    clearSelectedArtifactKeys,
    toggleAllArtifactKeys,
    areAllArtifactKeysSelected,
    setBulkDeleteConfirmationInput,
    deleteSelectedArtifacts,
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
    setDeleteConfirmationInput,
    setRegisterRepository,
    setRegisterNamespace,
    setRegisterPathInRepo,
    setRegisterRevision,
    setRegisterMediaType,
    toggleRegisterForm: () => setShowRegisterForm((current) => !current),
  };
}
