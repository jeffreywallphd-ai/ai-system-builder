import type { DesktopPythonRuntimeStatusSnapshot } from "../../../lib/desktopApi";

export interface DatasetPreparationModelDownloadProgress {
  message: string;
  percent?: number;
  completedFiles?: number;
  totalFiles?: number;
}

export interface DatasetPreparationChunkProgress {
  message: string;
  processedChunkCount: number;
  totalChunkCount: number;
}

interface ParsedDatasetPreparationGenerationProgressEvent {
  event?: string;
  requestId?: string;
  processedChunkCount?: number;
  totalChunkCount?: number;
}

const HUGGING_FACE_FETCHING_PATTERN = /Fetching\s+(\d+)\s+files:\s+(\d+)%\|.*?\|\s+(\d+)\/(\d+)/i;
const HUGGING_FACE_FETCHING_PERCENT_PATTERN = /Fetching\s+(\d+)\s+files:\s+(\d+)%/i;
const MODEL_LOAD_PATTERN = /Generation model\s+(.+?)\s+will be loaded from/i;
const STARTING_RUNTIME_PATTERN = /Starting Python runtime\.?/i;

function splitLogMessage(message: string): string[] {
  return message
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatProgressMessage(
  modelId: string,
  progress: Omit<DatasetPreparationModelDownloadProgress, "message">,
): string {
  if (
    typeof progress.percent === "number"
    && typeof progress.completedFiles === "number"
    && typeof progress.totalFiles === "number"
  ) {
    return `Downloading model ${modelId}: ${progress.percent}% (${progress.completedFiles}/${progress.totalFiles} files).`;
  }

  if (typeof progress.percent === "number" && typeof progress.totalFiles === "number") {
    return `Downloading model ${modelId}: ${progress.percent}% of ${progress.totalFiles} files.`;
  }

  return `Downloading model ${modelId} from Hugging Face.`;
}

function parseProgressLine(modelId: string, line: string): DatasetPreparationModelDownloadProgress | undefined {
  const fetchingMatch = line.match(HUGGING_FACE_FETCHING_PATTERN);
  if (fetchingMatch) {
    const totalFiles = Number(fetchingMatch[1]);
    const percent = Number(fetchingMatch[2]);
    const completedFiles = Number(fetchingMatch[3]);
    return {
      percent,
      completedFiles,
      totalFiles,
      message: formatProgressMessage(modelId, { percent, completedFiles, totalFiles }),
    };
  }

  const percentMatch = line.match(HUGGING_FACE_FETCHING_PERCENT_PATTERN);
  if (percentMatch) {
    const totalFiles = Number(percentMatch[1]);
    const percent = Number(percentMatch[2]);
    return {
      percent,
      totalFiles,
      message: formatProgressMessage(modelId, { percent, totalFiles }),
    };
  }

  if (line.includes(`Downloading generation model ${modelId}`)) {
    return {
      message: formatProgressMessage(modelId, {}),
    };
  }

  return undefined;
}

function parseJsonLogLine(line: string): unknown | undefined {
  const prefixIndex = line.indexOf("{");
  if (prefixIndex < 0) {
    return undefined;
  }

  try {
    return JSON.parse(line.slice(prefixIndex));
  } catch {
    return undefined;
  }
}

export function resolveLatestDatasetPreparationChunkProgress(
  snapshot: Pick<DesktopPythonRuntimeStatusSnapshot, "logs">,
  options: { requestId?: string; sinceEpochMs?: number } = {},
): DatasetPreparationChunkProgress | undefined {
  for (const log of [...snapshot.logs].reverse()) {
    if (typeof options.sinceEpochMs === "number") {
      const logEpochMs = Date.parse(log.timestamp);
      if (Number.isFinite(logEpochMs) && logEpochMs < options.sinceEpochMs) {
        continue;
      }
    }

    for (const line of splitLogMessage(log.message).reverse()) {
      const payload = parseJsonLogLine(line) as ParsedDatasetPreparationGenerationProgressEvent | undefined;
      if (payload?.event !== "runtime.dataset_preparation.generation.progress") {
        continue;
      }
      if (options.requestId && payload.requestId !== options.requestId) {
        continue;
      }

      if (typeof payload.processedChunkCount !== "number" || typeof payload.totalChunkCount !== "number") {
        continue;
      }

      return {
        processedChunkCount: payload.processedChunkCount,
        totalChunkCount: payload.totalChunkCount,
        message: `Processing chunk ${Math.min(payload.processedChunkCount + 1, payload.totalChunkCount)}/${payload.totalChunkCount}...`,
      };
    }
  }

  return undefined;
}

export function resolveModelInMemoryLoadMessage(
  snapshot: Pick<DesktopPythonRuntimeStatusSnapshot, "logs">,
  modelId: string,
  options: { sinceEpochMs?: number } = {},
): string | undefined {
  for (const log of [...snapshot.logs].reverse()) {
    if (typeof options.sinceEpochMs === "number") {
      const logEpochMs = Date.parse(log.timestamp);
      if (Number.isFinite(logEpochMs) && logEpochMs < options.sinceEpochMs) {
        continue;
      }
    }

    for (const line of splitLogMessage(log.message).reverse()) {
      const modelLoadMatch = line.match(MODEL_LOAD_PATTERN);
      if (modelLoadMatch && modelLoadMatch[1]?.trim() === modelId) {
        return `Loading model ${modelId} into memory...`;
      }
    }
  }

  return undefined;
}

export function sawPythonRuntimeStartup(
  snapshot: Pick<DesktopPythonRuntimeStatusSnapshot, "logs">,
  options: { sinceEpochMs?: number } = {},
): boolean {
  for (const log of [...snapshot.logs].reverse()) {
    if (typeof options.sinceEpochMs === "number") {
      const logEpochMs = Date.parse(log.timestamp);
      if (Number.isFinite(logEpochMs) && logEpochMs < options.sinceEpochMs) {
        continue;
      }
    }

    for (const line of splitLogMessage(log.message)) {
      if (STARTING_RUNTIME_PATTERN.test(line)) {
        return true;
      }
    }
  }

  return false;
}

export function resolveLatestModelDownloadProgress(
  snapshot: Pick<DesktopPythonRuntimeStatusSnapshot, "logs">,
  modelId: string,
  options: { sinceEpochMs?: number } = {},
): DatasetPreparationModelDownloadProgress | undefined {
  for (const log of [...snapshot.logs].reverse()) {
    if (typeof options.sinceEpochMs === "number") {
      const logEpochMs = Date.parse(log.timestamp);
      if (Number.isFinite(logEpochMs) && logEpochMs < options.sinceEpochMs) {
        continue;
      }
    }

    for (const line of splitLogMessage(log.message).reverse()) {
      const progress = parseProgressLine(modelId, line);
      if (progress) {
        return progress;
      }
    }
  }

  return undefined;
}
