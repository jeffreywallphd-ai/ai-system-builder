import type { DesktopPythonRuntimeStatusSnapshot } from "../../../lib/desktopApi";

export interface DatasetPreparationModelDownloadProgress {
  message: string;
  percent?: number;
  completedFiles?: number;
  totalFiles?: number;
}

const HUGGING_FACE_FETCHING_PATTERN = /Fetching\s+(\d+)\s+files:\s+(\d+)%\|.*?\|\s+(\d+)\/(\d+)/i;
const HUGGING_FACE_FETCHING_PERCENT_PATTERN = /Fetching\s+(\d+)\s+files:\s+(\d+)%/i;

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
