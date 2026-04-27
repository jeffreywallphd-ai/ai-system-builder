import { useState } from "react";

import type { ArtifactUploadClient, WebsiteIngestionMode } from "../api/desktopArtifactUploadClient";
import { parseWebsiteBatchTargets } from "./parseWebsiteBatchTargets";
import type {
  DesktopWebsitePageIngestionResult,
  DesktopWebsitePagesBatchSummary,
} from "../../../lib/desktopApi";

interface WebsiteSingleIngestionViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  result?: DesktopWebsitePageIngestionResult;
}

interface WebsiteBatchIngestionViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
  summary?: DesktopWebsitePagesBatchSummary;
}

export interface UseWebsiteArtifactIngestionResult {
  websiteSingleUrl: string;
  websiteSingleMode: WebsiteIngestionMode;
  websiteBatchInput: string;
  websiteBatchMode: WebsiteIngestionMode;
  websiteSingleViewState: WebsiteSingleIngestionViewState;
  websiteBatchViewState: WebsiteBatchIngestionViewState;
  setWebsiteSingleUrl: (value: string) => void;
  setWebsiteSingleMode: (mode: WebsiteIngestionMode) => void;
  setWebsiteBatchInput: (value: string) => void;
  setWebsiteBatchMode: (mode: WebsiteIngestionMode) => void;
  ingestWebsiteSingle: () => Promise<void>;
  ingestWebsiteBatch: () => Promise<void>;
}

export function useWebsiteArtifactIngestion(
  uploadClient: ArtifactUploadClient,
  onUploadComplete?: () => void,
): UseWebsiteArtifactIngestionResult {
  const [websiteSingleUrl, setWebsiteSingleUrl] = useState("");
  const [websiteSingleMode, setWebsiteSingleMode] = useState<WebsiteIngestionMode>("automatic");
  const [websiteSingleViewState, setWebsiteSingleViewState] = useState<WebsiteSingleIngestionViewState>({ status: "idle" });
  const [websiteBatchInput, setWebsiteBatchInput] = useState("");
  const [websiteBatchMode, setWebsiteBatchMode] = useState<WebsiteIngestionMode>("automatic");
  const [websiteBatchViewState, setWebsiteBatchViewState] = useState<WebsiteBatchIngestionViewState>({ status: "idle" });

  async function ingestWebsiteSingle(): Promise<void> {
    const url = websiteSingleUrl.trim();
    if (url.length === 0) {
      setWebsiteSingleViewState({ status: "error", message: "Enter one URL to ingest." });
      return;
    }

    setWebsiteSingleViewState({ status: "loading", message: "Ingesting website page..." });

    try {
      const response = await uploadClient.ingestWebsitePage({ url, mode: websiteSingleMode });
      if (!response.ok) {
        setWebsiteSingleViewState({ status: "error", message: response.error.message });
        return;
      }

      setWebsiteSingleViewState({
        status: "success",
        message: `Stored website page from ${response.value.resolvedUrl}.`,
        result: response.value,
      });
      if (response.value.stagedArtifact?.storage.key) {
        onUploadComplete?.();
      }
    } catch (error) {
      setWebsiteSingleViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Website ingestion failed.",
      });
    }
  }

  async function ingestWebsiteBatch(): Promise<void> {
    const targets = parseWebsiteBatchTargets(websiteBatchInput);
    if (targets.length === 0) {
      setWebsiteBatchViewState({
        status: "error",
        message: "Enter at least one URL (one per line) for batch ingestion.",
      });
      return;
    }

    setWebsiteBatchViewState({ status: "loading", message: `Ingesting ${targets.length} website page(s)...` });

    try {
      const response = await uploadClient.ingestWebsitePagesBatch({ targets, mode: websiteBatchMode });
      if (!response.ok) {
        setWebsiteBatchViewState({ status: "error", message: response.error.message });
        return;
      }

      const hasSuccessfulStoredItem = response.value.items.some((item) => item.ok && item.result?.stagedArtifact?.storage.key);
      if (hasSuccessfulStoredItem) {
        onUploadComplete?.();
      }

      setWebsiteBatchViewState({
        status: "success",
        message: `Batch ingestion complete: ${response.value.summary.succeeded}/${response.value.summary.attempted} succeeded.`,
        summary: response.value.summary,
      });
    } catch (error) {
      setWebsiteBatchViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Website batch ingestion failed.",
      });
    }
  }

  return {
    websiteSingleUrl,
    websiteSingleMode,
    websiteBatchInput,
    websiteBatchMode,
    websiteSingleViewState,
    websiteBatchViewState,
    setWebsiteSingleUrl,
    setWebsiteSingleMode,
    setWebsiteBatchInput,
    setWebsiteBatchMode,
    ingestWebsiteSingle,
    ingestWebsiteBatch,
  };
}
