import type { DatasetPreparationTaskType } from "./dataset-preparation";

export const DATASET_PREPARATION_SOURCE_FORMATS = [
  "csv",
  "json",
  "jsonl",
  "parquet",
  "text",
  "markdown",
  "html",
  "pdf",
  "docx",
  "image",
] as const;

export type DatasetPreparationSourceFormat =
  (typeof DATASET_PREPARATION_SOURCE_FORMATS)[number];

export type DatasetPreparationSourceKind = "structured" | "document" | "image";

export interface DatasetPreparationSourceCapability {
  format: DatasetPreparationSourceFormat;
  kind: DatasetPreparationSourceKind;
  label: string;
  extensions: readonly string[];
  mediaTypes: readonly string[];
  taskTypes: readonly DatasetPreparationTaskType[];
}

export interface DatasetPreparationSourceReadiness {
  ready: boolean;
  capability?: DatasetPreparationSourceCapability;
  code?: "source-format-unsupported" | "source-task-incompatible";
  message?: string;
  action?: string;
}

const LLM_TASK_TYPES = [
  "llm-instruction",
  "llm-classification",
  "llm-extraction",
  "llm-embedding",
  "llm-reranker",
] as const satisfies readonly DatasetPreparationTaskType[];

const IMAGE_TASK_TYPES = [
  "diffusion-lora",
  "vision-classification",
  "vision-detection",
  "vision-segmentation",
] as const satisfies readonly DatasetPreparationTaskType[];

const ALL_TASK_TYPES = [...LLM_TASK_TYPES, ...IMAGE_TASK_TYPES] as const;

export const DATASET_PREPARATION_SOURCE_CAPABILITIES = [
  {
    format: "csv",
    kind: "structured",
    label: "CSV",
    extensions: [".csv"],
    mediaTypes: ["text/csv", "application/csv"],
    taskTypes: ALL_TASK_TYPES,
  },
  {
    format: "json",
    kind: "structured",
    label: "JSON",
    extensions: [".json"],
    mediaTypes: ["application/json", "text/json"],
    taskTypes: ALL_TASK_TYPES,
  },
  {
    format: "jsonl",
    kind: "structured",
    label: "JSON Lines",
    extensions: [".jsonl", ".ndjson"],
    mediaTypes: ["application/x-ndjson", "application/jsonl"],
    taskTypes: ALL_TASK_TYPES,
  },
  {
    format: "parquet",
    kind: "structured",
    label: "Parquet",
    extensions: [".parquet"],
    mediaTypes: ["application/x-parquet", "application/vnd.apache.parquet"],
    taskTypes: ALL_TASK_TYPES,
  },
  {
    format: "text",
    kind: "document",
    label: "Text",
    extensions: [".txt"],
    mediaTypes: ["text/plain"],
    taskTypes: LLM_TASK_TYPES,
  },
  {
    format: "markdown",
    kind: "document",
    label: "Markdown",
    extensions: [".md", ".markdown"],
    mediaTypes: ["text/markdown", "text/x-markdown"],
    taskTypes: LLM_TASK_TYPES,
  },
  {
    format: "html",
    kind: "document",
    label: "HTML",
    extensions: [".html", ".htm"],
    mediaTypes: ["text/html"],
    taskTypes: LLM_TASK_TYPES,
  },
  {
    format: "pdf",
    kind: "document",
    label: "PDF",
    extensions: [".pdf"],
    mediaTypes: ["application/pdf"],
    taskTypes: LLM_TASK_TYPES,
  },
  {
    format: "docx",
    kind: "document",
    label: "Word document",
    extensions: [".docx"],
    mediaTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    taskTypes: LLM_TASK_TYPES,
  },
  {
    format: "image",
    kind: "image",
    label: "Image",
    extensions: [
      ".bmp",
      ".gif",
      ".jpeg",
      ".jpg",
      ".png",
      ".tif",
      ".tiff",
      ".webp",
    ],
    mediaTypes: [
      "image/bmp",
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/tiff",
      "image/webp",
    ],
    taskTypes: IMAGE_TASK_TYPES,
  },
] as const satisfies readonly DatasetPreparationSourceCapability[];

function normalizeMediaType(mediaType: string | undefined): string {
  return mediaType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function extensionOf(fileName: string | undefined): string {
  const normalized = fileName?.trim().split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  const dotIndex = normalized.lastIndexOf(".");
  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
}

export function resolveDatasetPreparationSourceCapability(input: {
  fileName?: string;
  mediaType?: string;
}): DatasetPreparationSourceCapability | undefined {
  const mediaType = normalizeMediaType(input.mediaType);
  const extension = extensionOf(input.fileName);
  return DATASET_PREPARATION_SOURCE_CAPABILITIES.find(
    (capability) =>
      capability.extensions.some((candidate) => candidate === extension) ||
      capability.mediaTypes.some((candidate) =>
        candidate.endsWith("/")
          ? mediaType.startsWith(candidate)
          : mediaType === candidate,
      ),
  );
}

export function evaluateDatasetPreparationSourceReadiness(input: {
  fileName?: string;
  mediaType?: string;
  taskType: DatasetPreparationTaskType;
}): DatasetPreparationSourceReadiness {
  const capability = resolveDatasetPreparationSourceCapability(input);
  if (!capability) {
    return {
      ready: false,
      code: "source-format-unsupported",
      message: "This file type cannot be prepared as a training dataset yet.",
      action:
        "Use CSV, JSON, JSON Lines, Parquet, TXT, Markdown, HTML, PDF, DOCX, or a supported image file.",
    };
  }
  if (!capability.taskTypes.some((taskType) => taskType === input.taskType)) {
    return {
      ready: false,
      capability,
      code: "source-task-incompatible",
      message: `${capability.label} is not available for this training goal.`,
      action:
        capability.kind === "image"
          ? "Choose an image training goal or select a text or table source."
          : "Choose a text training goal or select an image source.",
    };
  }
  return { ready: true, capability };
}
