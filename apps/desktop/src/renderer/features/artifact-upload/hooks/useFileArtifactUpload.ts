import { useState, type FormEvent } from "react";

import type { ArtifactUploadClient } from "../api/desktopArtifactUploadClient";
import type { UploadViewState } from "../components/ArtifactUploadForm";
import { resolveArtifactUploadMediaType } from "./resolveArtifactUploadMediaType";

export interface UseFileArtifactUploadResult {
  selectedFile: File | null;
  viewState: UploadViewState;
  onFileChange: (event: FormEvent<HTMLInputElement>) => void;
  onUploadSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

export function useFileArtifactUpload(
  uploadClient: ArtifactUploadClient,
  onUploadComplete?: () => void,
): UseFileArtifactUploadResult {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [viewState, setViewState] = useState<UploadViewState>({ status: "idle" });

  function onFileChange(event: FormEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0] ?? null;
    setSelectedFile(file);

    setViewState(file
      ? { status: "idle", message: `Selected ${file.name}.` }
      : { status: "idle", message: undefined });
  }

  async function onUploadSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedFile) {
      setViewState({ status: "error", message: "Select one artifact file before uploading." });
      return;
    }

    setViewState({ status: "uploading", message: `Uploading ${selectedFile.name}...` });

    try {
      const response = await uploadClient.uploadArtifact({
        fileName: selectedFile.name,
        mediaType: resolveArtifactUploadMediaType({
          fileName: selectedFile.name,
          browserMediaType: selectedFile.type,
        }),
        bytes: new Uint8Array(await selectedFile.arrayBuffer()),
      });

      if (!response.ok) {
        setViewState({ status: "error", message: response.error.message });
        return;
      }

      setViewState({
        status: "success",
        message: `Stored ${selectedFile.name}.`,
        key: response.value.descriptor.key,
        mediaType: response.value.descriptor.mediaType,
        sizeBytes: response.value.descriptor.sizeBytes,
      });
      onUploadComplete?.();
    } catch (error) {
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Artifact upload failed.",
      });
    }
  }

  return { selectedFile, viewState, onFileChange, onUploadSubmit };
}

