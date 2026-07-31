import { useRef, useState, type FormEvent } from "react";

import { ARTIFACT_UPLOAD_MAXIMUM_BYTES } from "../../../../../../../modules/contracts/artifact-upload";
import type { ArtifactUploadClient } from "../api/desktopArtifactUploadClient";
import type { UploadFileResult, UploadViewState } from "../components/ArtifactUploadForm";
import { resolveArtifactUploadMediaType } from "./resolveArtifactUploadMediaType";

export interface UseFileArtifactUploadResult {
  selectedFiles: readonly File[];
  viewState: UploadViewState;
  onFileChange: (event: FormEvent<HTMLInputElement>) => void;
  onUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onCancelUpload: () => void;
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

export function useFileArtifactUpload(
  uploadClient: ArtifactUploadClient,
  onUploadComplete?: () => void,
  options: { persistState?: boolean; workspaceId?: string; maximumBytes?: number } = {},
): UseFileArtifactUploadResult {
  const shouldPersistState = options.persistState ?? true;
  const [selectedFiles, setSelectedFiles] = useState<File[]>(shouldPersistState ? persistedFileUploadState.selectedFiles : []);
  const [viewState, setViewState] = useState<UploadViewState>(shouldPersistState ? persistedFileUploadState.viewState : { status: "idle" });
  const uploadInProgressRef = useRef(false);
  const cancelRequestedRef = useRef(false);

  function persist(nextSelectedFiles: File[], nextViewState: UploadViewState): void {
    if (!shouldPersistState) return;
    persistedFileUploadState = { selectedFiles: nextSelectedFiles, viewState: nextViewState };
  }

  function onFileChange(event: FormEvent<HTMLInputElement>): void {
    const files = filesFromInput(event);
    const nextViewState = files.length > 0
      ? { status: "idle" as const, message: files.length === 1 ? `Selected ${files[0].name}.` : `Selected ${files.length} files.` }
      : { status: "idle" as const, message: undefined };
    setSelectedFiles(files);
    setViewState(nextViewState);
    persist(files, nextViewState);
  }

  async function uploadFile(file: File): Promise<UploadFileResult> {
    try {
      const maximumBytes = Math.min(
        options.maximumBytes ?? ARTIFACT_UPLOAD_MAXIMUM_BYTES,
        ARTIFACT_UPLOAD_MAXIMUM_BYTES,
      );
      if (file.size > maximumBytes) {
        return {
          fileName: file.name,
          status: "error",
          message: `Artifact uploads must not exceed ${maximumBytes} bytes.`,
        };
      }
      const response = await uploadClient.uploadArtifact({
        workspaceId: options.workspaceId ?? "",
        fileName: file.name,
        mediaType: resolveArtifactUploadMediaType({
          fileName: file.name,
          browserMediaType: file.type,
        }),
        bytes: new Uint8Array(await file.arrayBuffer()),
      });

      if (!response.ok) {
        return {
          fileName: file.name,
          status: "error",
          message: response.error.message,
        };
      }

      return {
        fileName: file.name,
        status: "success",
        message: `Stored ${file.name}.`,
        key: response.value.descriptor.key,
        mediaType: response.value.descriptor.mediaType,
        sizeBytes: response.value.descriptor.sizeBytes,
      };
    } catch (error) {
      return {
        fileName: file.name,
        status: "error",
        message: error instanceof Error ? error.message : "Artifact upload failed.",
      };
    }
  }

  async function onUploadSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (uploadInProgressRef.current) {
      return;
    }

    if (!options.workspaceId) {
      const nextViewState = { status: "error" as const, message: "Select an active workspace before uploading." };
      setViewState(nextViewState);
      persist(selectedFiles, nextViewState);
      return;
    }

    if (selectedFiles.length === 0) {
      const nextViewState = { status: "error" as const, message: "Select one or more artifact files before uploading." };
      setViewState(nextViewState);
      persist(selectedFiles, nextViewState);
      return;
    }

    uploadInProgressRef.current = true;
    cancelRequestedRef.current = false;
    const uploadingState = {
      status: "uploading" as const,
      message: selectedFiles.length === 1 ? `Uploading ${selectedFiles[0].name}...` : `Uploading ${selectedFiles.length} files...`,
    };
    setViewState(uploadingState);
    persist(selectedFiles, uploadingState);

    const results: UploadFileResult[] = [];
    for (const file of selectedFiles) {
      if (cancelRequestedRef.current) {
        break;
      }

      const result = await uploadFile(file);
      results.push(result);

      if (cancelRequestedRef.current) {
        break;
      }

      if (results.length < selectedFiles.length) {
        const progressState = {
          status: "uploading",
          message: `Processed ${results.length} of ${selectedFiles.length} files...`,
          results: [...results],
        } as const;
        setViewState(progressState);
        persist(selectedFiles, progressState);
      }
    }

    const wasCanceled = cancelRequestedRef.current;
    const nextViewState = wasCanceled
      ? createCanceledViewState(results, selectedFiles.length)
      : createCompletedViewState(results);
    setViewState(nextViewState);
    persist(selectedFiles, nextViewState);
    uploadInProgressRef.current = false;
    cancelRequestedRef.current = false;

    if (results.some((result) => result.status === "success")) {
      onUploadComplete?.();
    }
  }

  function onCancelUpload(): void {
    if (uploadInProgressRef.current) {
      cancelRequestedRef.current = true;
      const nextViewState = {
        ...viewState,
        status: "uploading" as const,
        message: "Canceling upload after the current file finishes...",
      };
      setViewState(nextViewState);
      persist(selectedFiles, nextViewState);
      return;
    }

    const nextViewState = { status: "canceled" as const, message: "Upload selection cleared." };
    setSelectedFiles([]);
    setViewState(nextViewState);
    persist([], nextViewState);
  }

  return { selectedFiles, viewState, onFileChange, onUploadSubmit, onCancelUpload };
}
