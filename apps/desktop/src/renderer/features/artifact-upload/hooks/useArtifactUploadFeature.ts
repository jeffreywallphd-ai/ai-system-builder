import { useEffect, useState, type FormEvent } from "react";

import { ARTIFACT_UPLOAD_MAXIMUM_BYTES } from "../../../../../../../modules/contracts/artifact-upload";
import { useArtifactUploadClient } from "./useArtifactUploadClient";
import type { ArtifactUploadClient, WebsiteIngestionMode } from "../api/desktopArtifactUploadClient";
import type { UploadViewState } from "../components/ArtifactUploadForm";
import { toHtmlFileAcceptAttribute } from "./toHtmlFileAcceptAttribute";
import { useFileArtifactUpload } from "./useFileArtifactUpload";
import { useWebsiteArtifactIngestion } from "./useWebsiteArtifactIngestion";
import type {
  DesktopWebsitePageIngestionResult,
  DesktopWebsitePagesBatchSummary,
} from "../../../lib/desktopApi";

export interface UseArtifactUploadFeatureResult {
  selectedFiles: readonly File[];
  viewState: UploadViewState;
  acceptedFileTypes: string;
  websiteSingleUrl: string;
  websiteSingleMode: WebsiteIngestionMode;
  websiteBatchInput: string;
  websiteBatchMode: WebsiteIngestionMode;
  websiteSingleViewState: {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    result?: DesktopWebsitePageIngestionResult;
  };
  websiteBatchViewState: {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    summary?: DesktopWebsitePagesBatchSummary;
  };
  onFileChange: (event: FormEvent<HTMLInputElement>) => void;
  onUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancelUpload: () => void;
  setWebsiteSingleUrl: (value: string) => void;
  setWebsiteSingleMode: (mode: WebsiteIngestionMode) => void;
  setWebsiteBatchInput: (value: string) => void;
  setWebsiteBatchMode: (mode: WebsiteIngestionMode) => void;
  ingestWebsiteSingle: () => Promise<void>;
  ingestWebsiteBatch: () => Promise<void>;
}

export function useArtifactUploadFeature(
  client?: ArtifactUploadClient,
  onUploadComplete?: () => void,
  workspaceId?: string,
): UseArtifactUploadFeatureResult {
  const uploadClient = useArtifactUploadClient(client);
  const [acceptedFileTypes, setAcceptedFileTypes] = useState<string>("*");
  const [maximumUploadBytes, setMaximumUploadBytes] = useState(
    ARTIFACT_UPLOAD_MAXIMUM_BYTES,
  );

  const fileUpload = useFileArtifactUpload(uploadClient, onUploadComplete, {
    persistState: client === undefined,
    workspaceId,
    maximumBytes: maximumUploadBytes,
  });
  const websiteIngestion = useWebsiteArtifactIngestion(uploadClient, onUploadComplete, workspaceId);

  useEffect(() => {
    void uploadClient.getAcceptedTypes().then((policy) => {
      setAcceptedFileTypes(toHtmlFileAcceptAttribute(policy));
      setMaximumUploadBytes(
        typeof policy.maximumBytes === "number" && Number.isFinite(policy.maximumBytes) && policy.maximumBytes > 0
          ? Math.min(policy.maximumBytes, ARTIFACT_UPLOAD_MAXIMUM_BYTES)
          : ARTIFACT_UPLOAD_MAXIMUM_BYTES,
      );
    }).catch(() => {
      setAcceptedFileTypes("*");
      setMaximumUploadBytes(ARTIFACT_UPLOAD_MAXIMUM_BYTES);
    });
  }, [uploadClient]);

  return {
    selectedFiles: fileUpload.selectedFiles,
    viewState: fileUpload.viewState,
    acceptedFileTypes,
    websiteSingleUrl: websiteIngestion.websiteSingleUrl,
    websiteSingleMode: websiteIngestion.websiteSingleMode,
    websiteBatchInput: websiteIngestion.websiteBatchInput,
    websiteBatchMode: websiteIngestion.websiteBatchMode,
    websiteSingleViewState: websiteIngestion.websiteSingleViewState,
    websiteBatchViewState: websiteIngestion.websiteBatchViewState,
    onFileChange: fileUpload.onFileChange,
    onUploadSubmit: fileUpload.onUploadSubmit,
    onCancelUpload: fileUpload.onCancelUpload,
    setWebsiteSingleUrl: websiteIngestion.setWebsiteSingleUrl,
    setWebsiteSingleMode: websiteIngestion.setWebsiteSingleMode,
    setWebsiteBatchInput: websiteIngestion.setWebsiteBatchInput,
    setWebsiteBatchMode: websiteIngestion.setWebsiteBatchMode,
    ingestWebsiteSingle: websiteIngestion.ingestWebsiteSingle,
    ingestWebsiteBatch: websiteIngestion.ingestWebsiteBatch,
  };
}

