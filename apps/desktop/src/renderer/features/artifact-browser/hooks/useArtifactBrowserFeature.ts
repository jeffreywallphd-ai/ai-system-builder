import { useEffect, useState } from "react";

import {
  useArtifactBrowserPublishLogic,
  type ArtifactBrowserViewState,
  type ArtifactPreviewView,
  type UseArtifactBrowserPublishLogicResult,
} from "../../../../../../../modules/ui/shared";
import type {
  DesktopArtifactBrowseItem,
  DesktopArtifactContentDescriptor,
  DesktopArtifactDetail,
  DesktopArtifactFamily,
  DesktopLocalizedArtifactFromRepo,
  DesktopHuggingFaceDatasetParquetFile,
  DesktopHuggingFaceNamespaceDataset,
  DesktopPublishedBacking,
  DesktopUnregisteredArtifactBrowseItem,
} from "../../../lib/desktopApi";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { useArtifactBrowserClient } from "./useArtifactBrowserClient";
import { type PendingDeleteConfirmation } from "./useArtifactDeleteConfirmation";
import { useArtifactSelectionContent } from "./useArtifactSelectionContent";
import { useArtifactBrowserHuggingFace } from "./useArtifactBrowserHuggingFace";
import { useArtifactBrowserArtifacts } from "./useArtifactBrowserArtifacts";
import { useArtifactDeleteFlow } from "./useArtifactDeleteFlow";
import { useArtifactBrowserMutations } from "./useArtifactBrowserMutations";

export interface UseArtifactBrowserFeatureResult {
  huggingFaceTokenStatus: { configured: boolean; maskedToken?: string };
  tokenInput: string;
  tokenState: ArtifactBrowserViewState;
  items: DesktopArtifactBrowseItem[];
  uploadedItems: DesktopArtifactBrowseItem[];
  generatedItems: DesktopArtifactBrowseItem[];
  otherItems: DesktopArtifactBrowseItem[];
  unregisteredItems: DesktopUnregisteredArtifactBrowseItem[];
  selectedStorageKey?: string;
  detail?: DesktopArtifactDetail;
  content?: DesktopArtifactContentDescriptor;
  imageViewUrl?: string;
  htmlPreview?: string;
  artifactPreview: ArtifactPreviewView;
  publishState: ArtifactBrowserViewState;
  registerState: ArtifactBrowserViewState;
  localizeState: ArtifactBrowserViewState;
  sourceVerifyState: ArtifactBrowserViewState;
  publishedBacking?: DesktopPublishedBacking;
  localizedArtifact?: DesktopLocalizedArtifactFromRepo;
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
  pendingDeleteConfirmation?: PendingDeleteConfirmation;
  deleteConfirmationInput: string;
  selectArtifact: (storageKey: string) => Promise<void>;
  refreshArtifacts: () => Promise<void>;
  registerUnregisteredArtifact: (storageKey: string) => Promise<void>;
  requestDeleteUnregisteredArtifact: (storageKey: string) => void;
  requestDeleteRegisteredArtifact: (storageKey: string) => void;
  setDeleteConfirmationInput: (value: string) => void;
  confirmPendingDelete: () => Promise<void>;
  cancelPendingDelete: () => void;
  selectedArtifactFamily: DesktopArtifactFamily | "all";
  setSelectedArtifactFamily: (value: DesktopArtifactFamily | "all") => void;
  selectedStorageFilter: "all" | "uploaded" | "generated";
  setSelectedStorageFilter: (value: "all" | "uploaded" | "generated") => void;
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
  }) => Promise<void>;
  registerHuggingFaceNamespace: () => Promise<void>;
  browseHuggingFaceDatasetParquetFiles: (repository: string) => Promise<void>;
  closeHuggingFaceDatasetParquetFiles: () => void;
  huggingFaceNamespaceDatasets: DesktopHuggingFaceNamespaceDataset[];
  getHuggingFaceDatasetParquetFiles: (
    repository: string,
  ) => DesktopHuggingFaceDatasetParquetFile[];
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
  setCreateRepositoryIfMissing: (value: boolean) => void;
  setRepositoryVisibility: (value: "private" | "public") => void;
  togglePublishForm: () => void;
  readArtifactMedia: (
    storageKey: string,
  ) => Promise<{ mediaType?: string; bytes: Uint8Array }>;
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
  client?: DesktopArtifactBrowserClient,
  workspaceId?: string,
): UseArtifactBrowserFeatureResult {
  const artifactClient = useArtifactBrowserClient(client);
  const [viewState, setViewState] = useState<ArtifactBrowserViewState>({
    status: "idle",
  });
  const artifacts = useArtifactBrowserArtifacts({
    client: artifactClient,
    setViewState,
    workspaceId,
  });

  const selection = useArtifactSelectionContent(
    artifactClient,
    setViewState,
    workspaceId,
  );

  const publishLogic = useArtifactBrowserPublishLogic<DesktopArtifactDetail>({
    workspaceId,
    selectedStorageKey: selection.selectedStorageKey,
    client: artifactClient,
    async readSelectedArtifactDetail() {
      if (!selection.selectedStorageKey) {
        return undefined;
      }

      return artifactClient.readArtifactDetail(
        { storageKey: selection.selectedStorageKey },
        { workspaceId },
      );
    },
  });

  const mutations = useArtifactBrowserMutations({
    client: artifactClient,
    workspaceId,
    refreshArtifacts: artifacts.refreshArtifacts,
    setViewState,
  });
  const deleteFlow = useArtifactDeleteFlow({
    client: artifactClient,
    workspaceId,
    refreshArtifacts: artifacts.refreshArtifacts,
    clearSelectedArtifact: selection.clearSelectedArtifact,
    setViewState,
  });

  const huggingFace = useArtifactBrowserHuggingFace({
    client: artifactClient,
    workspaceId,
    refreshArtifacts: artifacts.refreshArtifacts,
    selectArtifact: selection.selectArtifact,
    selectedStorageKey: selection.selectedStorageKey,
  });

  useEffect(() => {
    publishLogic.setPublishedBackingFromDetail(selection.detail);
  }, [selection.detail]);

  useEffect(() => {
    void artifacts.refreshArtifacts();
    void artifactClient
      .getHuggingFaceTokenStatus()
      .then(huggingFace.setHuggingFaceTokenStatus)
      .catch(() => {
        huggingFace.setHuggingFaceTokenStatus({ configured: false });
      });
  }, [artifactClient, artifacts.refreshArtifacts, workspaceId]);

  async function publishArtifactToHuggingFace(input?: {
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
    repositoryCreation?: {
      approved: true;
      visibility: "private" | "public";
    };
  }): Promise<void> {
    await publishLogic.publishArtifactToHuggingFace(input);
    await artifacts.refreshArtifacts();
  }

  async function recheckPublishedBacking(): Promise<void> {
    await publishLogic.recheckPublishedBacking();
    await artifacts.refreshArtifacts();
  }

  return {
    huggingFaceTokenStatus: huggingFace.huggingFaceTokenStatus,
    tokenInput: huggingFace.tokenInput,
    tokenState: huggingFace.tokenState,
    items: artifacts.items,
    uploadedItems: artifacts.uploadedItems,
    generatedItems: artifacts.generatedItems,
    otherItems: artifacts.otherItems,
    unregisteredItems: artifacts.unregisteredItems,
    selectedStorageKey: selection.selectedStorageKey,
    detail: selection.detail,
    content: selection.content,
    imageViewUrl: selection.imageViewUrl,
    htmlPreview: selection.htmlPreview,
    artifactPreview: selection.artifactPreview,
    publishState: publishLogic.publishState,
    registerState: huggingFace.registerState,
    localizeState: huggingFace.localizeState,
    sourceVerifyState: huggingFace.sourceVerifyState,
    publishedBacking: publishLogic.publishedBacking,
    localizedArtifact: huggingFace.localizedArtifact,
    publishForm: publishLogic.publishForm,
    registerForm: huggingFace.registerForm,
    viewState,
    pendingDeleteConfirmation: deleteFlow.pendingDeleteConfirmation,
    deleteConfirmationInput: deleteFlow.deleteConfirmationInput,
    selectArtifact: selection.selectArtifact,
    refreshArtifacts: artifacts.refreshArtifacts,
    registerUnregisteredArtifact: mutations.registerUnregisteredArtifact,
    requestDeleteUnregisteredArtifact:
      deleteFlow.requestDeleteUnregisteredArtifact,
    requestDeleteRegisteredArtifact: deleteFlow.requestDeleteRegisteredArtifact,
    setDeleteConfirmationInput: deleteFlow.setDeleteConfirmationInput,
    confirmPendingDelete: deleteFlow.confirmPendingDelete,
    cancelPendingDelete: deleteFlow.cancelPendingDelete,
    selectedArtifactFamily: artifacts.selectedArtifactFamily,
    setSelectedArtifactFamily: artifacts.setSelectedArtifactFamily,
    selectedStorageFilter: artifacts.selectedStorageFilter,
    setSelectedStorageFilter: artifacts.setSelectedStorageFilter,
    publishArtifactToHuggingFace,
    registerArtifactFromHuggingFace:
      huggingFace.registerArtifactFromHuggingFace,
    registerHuggingFaceNamespace: huggingFace.registerHuggingFaceNamespace,
    browseHuggingFaceDatasetParquetFiles:
      huggingFace.browseHuggingFaceDatasetParquetFiles,
    closeHuggingFaceDatasetParquetFiles:
      huggingFace.closeHuggingFaceDatasetParquetFiles,
    huggingFaceNamespaceDatasets: huggingFace.huggingFaceNamespaceDatasets,
    getHuggingFaceDatasetParquetFiles:
      huggingFace.getHuggingFaceDatasetParquetFiles,
    getHuggingFaceDatasetFilesState:
      huggingFace.getHuggingFaceDatasetFilesState,
    expandedHuggingFaceDataset: huggingFace.expandedHuggingFaceDataset,
    localizeArtifactFromRepo: huggingFace.localizeArtifactFromRepo,
    recheckPublishedBacking,
    recheckSourceBacking: huggingFace.recheckSourceBacking,
    setRepository: publishLogic.setRepository,
    setPathInRepo: publishLogic.setPathInRepo,
    setRevision: publishLogic.setRevision,
    setMediaType: publishLogic.setMediaType,
    setCreateRepositoryIfMissing: publishLogic.setCreateRepositoryIfMissing,
    setRepositoryVisibility: publishLogic.setRepositoryVisibility,
    togglePublishForm: publishLogic.togglePublishForm,
    readArtifactMedia: (storageKey: string) =>
      artifactClient.readArtifactMedia({ storageKey }),
    setRegisterRepository: huggingFace.setRegisterRepository,
    setRegisterNamespace: huggingFace.setRegisterNamespace,
    setRegisterPathInRepo: huggingFace.setRegisterPathInRepo,
    setRegisterRevision: huggingFace.setRegisterRevision,
    setRegisterMediaType: huggingFace.setRegisterMediaType,
    toggleRegisterForm: huggingFace.toggleRegisterForm,
    setTokenInput: huggingFace.setTokenInput,
    saveHuggingFaceToken: huggingFace.saveHuggingFaceToken,
    clearHuggingFaceToken: huggingFace.clearHuggingFaceToken,
  };
}
