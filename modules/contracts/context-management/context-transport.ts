import { CONTEXT_GENERATION_LIMITS } from "./context-limits";
import {
  normalizeContextRetrievalRequest,
  normalizeContextSourceChecks,
  validateStartContextGenerationCommand,
} from "./context-validation";
import type {
  ContextBrowserDetail,
  ContextBrowserItem,
  ContextConversionReadiness,
  ContextRetrievalRequest,
  ContextRetrievalResult,
} from "./context-browser-contracts";
import type {
  ContextChunkingSettings,
  ContextGenerationStatus,
  ContextSourceCheckSettings,
  StartContextGenerationCommand,
} from "./context-contracts";

export type ContextManagementTransportCommand =
  | {
      readonly action: "source-inspect";
      readonly artifactId: string;
      readonly chunking: ContextChunkingSettings;
      readonly sourceChecks?: ContextSourceCheckSettings;
    }
  | {
      readonly action: "generation-start";
      readonly command: StartContextGenerationCommand;
    }
  | {
      readonly action:
        | "generation-read"
        | "generation-save"
        | "generation-discard"
        | "generation-cancel";
      readonly requestId: string;
    }
  | { readonly action: "browser-list" }
  | {
      readonly action: "browser-detail" | "browser-rebuild" | "browser-delete";
      readonly artifactId: string;
    }
  | {
      readonly action: "browser-query";
      readonly request: ContextRetrievalRequest;
    }
  | { readonly action: "task-list" };

export interface ContextTaskSummary {
  readonly requestId: string;
  readonly taskType: "context-generation" | "context-retrieval";
  readonly status:
    "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  readonly progress?: {
    readonly message?: string;
    readonly current?: number;
    readonly total?: number;
    readonly unit?: string;
    readonly percent?: number;
  };
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly completedAt?: string;
}

export type ContextManagementTransportValue =
  | {
      readonly action: "source-inspect";
      readonly readiness: ContextConversionReadiness;
    }
  | {
      readonly action: "generation-start" | "browser-rebuild";
      readonly value: {
        readonly requestId: string;
        readonly taskType: "generate-context-artifact";
        readonly accepted: true;
        readonly status: "queued" | "running";
      };
    }
  | {
      readonly action:
        | "generation-read"
        | "generation-save"
        | "generation-discard"
        | "generation-cancel";
      readonly status: ContextGenerationStatus;
    }
  | {
      readonly action: "browser-list";
      readonly items: readonly ContextBrowserItem[];
    }
  | { readonly action: "browser-detail"; readonly detail: ContextBrowserDetail }
  | {
      readonly action: "browser-query";
      readonly result: ContextRetrievalResult;
    }
  | { readonly action: "browser-delete"; readonly storageKey: string }
  | {
      readonly action: "task-list";
      readonly tasks: readonly ContextTaskSummary[];
    };

export function normalizeContextManagementTransportCommand(
  value: ContextManagementTransportCommand,
): ContextManagementTransportCommand {
  if (!value || typeof value !== "object") {
    throw new Error("Context command is invalid.");
  }
  switch (value.action) {
    case "source-inspect":
      return {
        action: value.action,
        artifactId: normalizeId(value.artifactId, "artifact"),
        chunking: normalizeChunking(value.chunking),
        ...(value.sourceChecks
          ? { sourceChecks: normalizeContextSourceChecks(value.sourceChecks) }
          : {}),
      };
    case "generation-start":
      return {
        action: value.action,
        command: validateStartContextGenerationCommand(value.command),
      };
    case "generation-read":
    case "generation-save":
    case "generation-discard":
    case "generation-cancel":
      return {
        action: value.action,
        requestId: normalizeId(value.requestId, "request"),
      };
    case "browser-list":
    case "task-list":
      return { action: value.action };
    case "browser-detail":
    case "browser-rebuild":
    case "browser-delete":
      return {
        action: value.action,
        artifactId: normalizeId(value.artifactId, "artifact"),
      };
    case "browser-query":
      return {
        action: value.action,
        request: normalizeContextRetrievalRequest(value.request),
      };
    default:
      throw new Error("Context command action is invalid.");
  }
}

function normalizeId(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 512) {
    throw new Error(`Context ${label} id is invalid.`);
  }
  return normalized;
}

function normalizeChunking(
  value: ContextChunkingSettings,
): ContextChunkingSettings {
  if (
    !value ||
    ![
      "fixed-length",
      "topic-aware",
      "sentence",
      "section",
      "structure-aware",
    ].includes(value.strategy) ||
    !Number.isSafeInteger(value.chunkCharacters) ||
    value.chunkCharacters < CONTEXT_GENERATION_LIMITS.minimumChunkCharacters ||
    value.chunkCharacters > CONTEXT_GENERATION_LIMITS.maximumChunkCharacters ||
    !Number.isSafeInteger(value.overlapCharacters) ||
    value.overlapCharacters < 0 ||
    value.overlapCharacters >= value.chunkCharacters ||
    value.overlapCharacters >
      CONTEXT_GENERATION_LIMITS.maximumChunkOverlapCharacters ||
    (value.maximumTokensPerChunk !== undefined &&
      (!Number.isSafeInteger(value.maximumTokensPerChunk) ||
        value.maximumTokensPerChunk < 32 ||
        value.maximumTokensPerChunk > 4096)) ||
    (value.strategy === "fixed-length" &&
      value.maximumTokensPerChunk !== undefined) ||
    (value.topicBoundarySensitivity !== undefined &&
      (value.strategy !== "topic-aware" ||
        !Number.isFinite(value.topicBoundarySensitivity) ||
        value.topicBoundarySensitivity < 0 ||
        value.topicBoundarySensitivity > 1)) ||
    (value.textFields?.length ?? 0) >
      CONTEXT_GENERATION_LIMITS.maximumTextFieldCount ||
    value.textFields?.some(
      (field) => !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(field),
    ) ||
    (value.maximumChunks !== undefined &&
      (!Number.isSafeInteger(value.maximumChunks) ||
        value.maximumChunks < 1 ||
        value.maximumChunks > CONTEXT_GENERATION_LIMITS.maximumChunkCount))
  ) {
    throw new Error("Context chunking settings are invalid.");
  }
  return {
    strategy: value.strategy,
    chunkCharacters: value.chunkCharacters,
    overlapCharacters: value.overlapCharacters,
    ...(value.maximumTokensPerChunk !== undefined
      ? { maximumTokensPerChunk: value.maximumTokensPerChunk }
      : {}),
    ...(value.topicBoundarySensitivity !== undefined
      ? { topicBoundarySensitivity: value.topicBoundarySensitivity }
      : {}),
    ...(value.textFields ? { textFields: [...value.textFields] } : {}),
    ...(value.maximumChunks !== undefined
      ? { maximumChunks: value.maximumChunks }
      : {}),
  };
}
