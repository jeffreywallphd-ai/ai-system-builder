import { useEffect, useRef, useState, type FormEvent } from "react";

import { type ApiArtifactUploadClient } from "../api/apiArtifactUploadClient";
import type { UploadFileResult, UploadViewState } from "../components/ArtifactUploadForm";
import { useArtifactUploadClient } from "./useArtifactUploadClient";
import { resolveArtifactUploadMediaType } from "./resolveArtifactUploadMediaType";
import { toHtmlFileAcceptAttribute } from "./toHtmlFileAcceptAttribute";
import { useWebsiteArtifactIngestion } from "./useWebsiteArtifactIngestion";

export interface UseArtifactUploadFeatureResult {
  selectedFiles: readonly File[];
  viewState: UploadViewState;
  acceptedFileTypes: string;
  websiteSingleUrl: string;
  websiteSingleMode: "automatic" | "rendered";
  websiteBatchInput: string;
  websiteBatchMode: "automatic" | "rendered";
  websiteSingleViewState: {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    result?: {
      acquisitionMechanismUsed: "simple-http" | "rendered-browser";
      stagedArtifact?: {
        storage: { key: string };
        originalName?: string;
      };
    };
  };
  websiteBatchViewState: {
    status: "idle" | "loading" | "success" | "error";
    message?: string;
    summary?: {
      attempted: number;
      succeeded: number;
      failed: number;
    };
  };
  onFileChange: (event: FormEvent<HTMLInputElement>) => void;
  onUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancelUpload: () => void;
  setWebsiteSingleUrl: (value: string) => void;
  setWebsiteSingleMode: (mode: "automatic" | "rendered") => void;
  setWebsiteBatchInput: (value: string) => void;
  setWebsiteBatchMode: (mode: "automatic" | "rendered") => void;
  ingestWebsiteSingle: () => Promise<void>;
  ingestWebsiteBatch: () => Promise<void>;
}

interface PersistedFileUploadState {
  selectedFiles: File[];
  viewState: UploadViewState;
}

let persistedFileUploadState: PersistedFileUploadState = {
  selectedFiles: [],
  viewState: { status: "idle" },
};

function filesFromInput(event: FormEvent<HTMLInputElement>): File[] {
  return Array.from(event.currentTarget.files ?? []);
}

function firstSuccessfulResult(results: readonly UploadFileResult[]): UploadFileResult | undefined {
  return results.find((result) => result.status === "success");
}

function createCompletedViewState(results: readonly UploadFileResult[]): UploadViewState {
  const successCount = results.filter((result) => result.status === "success").length;
  const failureCount = results.length - successCount;
  const firstSuccess = firstSuccessfulResult(results);

  if (results.length === 1) {
    const onlyResult = results[0];
    return {
      status: onlyResult.status,
      message: onlyResult.status === "success" ? `Stored ${onlyResult.fileName}.` : onlyResult.message,
      key: onlyResult.key,
      mediaType: onlyResult.mediaType,
      sizeBytes: onlyResult.sizeBytes,
      results,
    };
  }

  return {
    status: failureCount === 0 ? "success" : successCount > 0 ? "partial" : "error",
    message: failureCount === 0
      ? `Stored ${successCount} files.`
      : successCount > 0
        ? `Stored ${successCount} of ${results.length} files. ${failureCount} failed.`
        : `No files were stored. ${failureCount} failed.`,
    key: firstSuccess?.key,
    mediaType: firstSuccess?.mediaType,
    sizeBytes: firstSuccess?.sizeBytes,
    results,
  };
}

function createCanceledViewState(results: readonly UploadFileResult[], totalFileCount: number): UploadViewState {
  const successCount = results.filter((result) => result.status === "success").length;
  const failureCount = results.length - successCount;
  const firstSuccess = firstSuccessfulResult(results);

  return {
    status: "canceled",
    message: results.length === 0
      ? "Upload canceled. No files were stored."
      : `Upload canceled after ${results.length} of ${totalFileCount} files. ${successCount} stored, ${failureCount} failed.`,
    key: firstSuccess?.key,
    mediaType: firstSuccess?.mediaType,
    sizeBytes: firstSuccess?.sizeBytes,
    results,
  };
}

export function useArtifactUploadFeature(client?: ApiArtifactUploadClient, onUploadComplete?: () => void, workspaceId?: string): UseArtifactUploadFeatureResult {
  const uploadClient = useArtifactUploadClient(client);
  const shouldPersistFileUploadState = client === undefined;
  const [selectedFiles, setSelectedFiles] = useState<File[]>(shouldPersistFileUploadState ? persistedFileUploadState.selectedFiles : []);
  const [acceptedFileTypes, setAcceptedFileTypes] = useState<string>("*");
  const [viewState, setViewState] = useState<UploadViewState>(shouldPersistFileUploadState ? persistedFileUploadState.viewState : { status: "idle" });
  const selectedFilesRef = useRef<File[]>(selectedFiles);
  const uploadInProgressRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const websiteIngestion = useWebsiteArtifactIngestion(uploadClient, onUploadComplete, workspaceId);

  useEffect(() => {
    if (!shouldPersistFileUploadState) return;
    persistedFileUploadState = { selectedFiles, viewState };
  }, [selectedFiles, shouldPersistFileUploadState, viewState]);

  useEffect(() => {
    void uploadClient.getAcceptedTypes().then((policy) => {
      setAcceptedFileTypes(toHtmlFileAcceptAttribute(policy));
    }).catch(() => {
      setAcceptedFileTypes("*");
    });
  }, [uploadClient]);

  async function uploadFile(file: File): Promise<UploadFileResult> {
    try {
      const response = await uploadClient.uploadArtifact({
        workspaceId: workspaceId ?? "",
        fileName: file.name,
        mediaType: resolveArtifactUploadMediaType({
          fileName: file.name,
          browserMediaType: file.type,
        }),
        bytes: new Uint8Array(await file.arrayBuffer()),
      });

      if (response.ok) {
        return {
          fileName: file.name,
          status: "success",
          message: `Stored ${file.name}.`,
          key: response.value.descriptor.key,
          mediaType: response.value.descriptor.mediaType,
          sizeBytes: response.value.descriptor.sizeBytes,
        };
      }

      return {
        fileName: file.name,
        status: "error",
        message: response.error.message,
      };
    } catch (error) {
      return {
        fileName: file.name,
        status: "error",
        message: error instanceof Error ? error.message : "Artifact upload failed.",
      };
    }
  }

  async function uploadSelectedFiles(files: readonly File[]): Promise<void> {
    if (uploadInProgressRef.current) {
      return;
    }

    if (files.length === 0) {
      setViewState({ status: "error", message: "Select one or more artifact files before uploading." });
      return;
    }

    if (!workspaceId) {
      setViewState({ status: "error", message: "Select an active workspace before uploading." });
      return;
    }

    uploadInProgressRef.current = true;
    cancelRequestedRef.current = false;
    setViewState({
      status: "uploading",
      message: files.length === 1 ? `Uploading ${files[0].name}...` : `Uploading ${files.length} files...`,
    });

    const results: UploadFileResult[] = [];
    for (const file of files) {
      if (cancelRequestedRef.current) {
        break;
      }

      const result = await uploadFile(file);
      results.push(result);

      if (cancelRequestedRef.current) {
        break;
      }

      if (results.length < files.length) {
        setViewState({
          status: "uploading",
          message: `Processed ${results.length} of ${files.length} files...`,
          results: [...results],
        });
      }
    }

    const wasCanceled = cancelRequestedRef.current;
    setViewState(wasCanceled ? createCanceledViewState(results, files.length) : createCompletedViewState(results));
    uploadInProgressRef.current = false;
    cancelRequestedRef.current = false;

    if (results.some((result) => result.status === "success")) {
      onUploadComplete?.();
    }
  }

  function onFileChange(event: FormEvent<HTMLInputElement>): void {
    const files = filesFromInput(event);
    selectedFilesRef.current = files;
    setSelectedFiles(files);

    if (files.length > 0) {
      setViewState({
        status: "idle",
        message: files.length === 1 ? `Selected ${files[0].name}.` : `Selected ${files.length} files.`,
      });
      void uploadSelectedFiles(files);
      return;
    }

    setViewState({ status: "idle", message: undefined });
  }

  async function onUploadSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const files = selectedFilesRef.current;
    if (files.length === 0) {
      setViewState({ status: "error", message: "Select one or more artifact files before uploading." });
      return;
    }

    await uploadSelectedFiles(files);
  }

  function onCancelUpload(): void {
    if (uploadInProgressRef.current) {
      cancelRequestedRef.current = true;
      setViewState({
        ...viewState,
        status: "uploading",
        message: "Canceling upload after the current file finishes...",
      });
      return;
    }

    selectedFilesRef.current = [];
    setSelectedFiles([]);
    setViewState({ status: "canceled", message: "Upload selection cleared." });
  }

  return {
    selectedFiles,
    viewState,
    acceptedFileTypes,
    websiteSingleUrl: websiteIngestion.websiteSingleUrl,
    websiteSingleMode: websiteIngestion.websiteSingleMode,
    websiteBatchInput: websiteIngestion.websiteBatchInput,
    websiteBatchMode: websiteIngestion.websiteBatchMode,
    websiteSingleViewState: websiteIngestion.websiteSingleViewState,
    websiteBatchViewState: websiteIngestion.websiteBatchViewState,
    onFileChange,
    onUploadSubmit,
    onCancelUpload,
    setWebsiteSingleUrl: websiteIngestion.setWebsiteSingleUrl,
    setWebsiteSingleMode: websiteIngestion.setWebsiteSingleMode,
    setWebsiteBatchInput: websiteIngestion.setWebsiteBatchInput,
    setWebsiteBatchMode: websiteIngestion.setWebsiteBatchMode,
    ingestWebsiteSingle: websiteIngestion.ingestWebsiteSingle,
    ingestWebsiteBatch: websiteIngestion.ingestWebsiteBatch,
  };
}
