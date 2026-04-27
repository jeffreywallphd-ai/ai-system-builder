import { useEffect, useState, type FormEvent } from "react";

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
  selectedFile: File | null;
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
): UseArtifactUploadFeatureResult {
  const uploadClient = useArtifactUploadClient(client);
  const [acceptedFileTypes, setAcceptedFileTypes] = useState<string>("*");

  const fileUpload = useFileArtifactUpload(uploadClient, onUploadComplete);
  const websiteIngestion = useWebsiteArtifactIngestion(uploadClient, onUploadComplete);

  useEffect(() => {
    void uploadClient.getAcceptedTypes().then((policy) => {
      setAcceptedFileTypes(toHtmlFileAcceptAttribute(policy));
    }).catch(() => {
      setAcceptedFileTypes("*");
    });
  }, [uploadClient]);

  return {
    selectedFile: fileUpload.selectedFile,
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
    setWebsiteSingleUrl: websiteIngestion.setWebsiteSingleUrl,
    setWebsiteSingleMode: websiteIngestion.setWebsiteSingleMode,
    setWebsiteBatchInput: websiteIngestion.setWebsiteBatchInput,
    setWebsiteBatchMode: websiteIngestion.setWebsiteBatchMode,
    ingestWebsiteSingle: websiteIngestion.ingestWebsiteSingle,
    ingestWebsiteBatch: websiteIngestion.ingestWebsiteBatch,
  };
}

