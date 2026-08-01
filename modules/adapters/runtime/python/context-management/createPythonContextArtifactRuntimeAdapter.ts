import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextArtifactRuntimePort } from "../../../../application/ports/context-management";
import type { RuntimeTaskRegistryPort } from "../../../../application/ports/runtime";
import {
  CONTEXT_GENERATION_LIMITS,
  isContextArtifactMediaType,
  type ContextArtifactInspection,
  type ContextArtifactManifest,
  type ContextChunkCitation,
  type ContextRetrievalMatch,
  type ContextSourceCheckResult,
  type ContextSourceCheckSettings,
  type ContextSourceInformation,
  type ContextSourceInspection,
} from "../../../../contracts/context-management";
import { TaskType } from "../../../../contracts/runtime";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "../pythonRuntimeTaskTimeoutPolicy";

const INITIAL_POLL_INTERVAL_MS = 50;
const MAXIMUM_POLL_INTERVAL_MS = 1_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

interface OperationInput {
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly digest: string;
  readonly originalName?: string;
  readonly chunking?: unknown;
  readonly sourceInformation?: unknown;
  readonly sourceChecks?: unknown;
  readonly query?: string;
  readonly maximumResults?: number;
}

export function createPythonContextArtifactRuntimeAdapter(
  registry: RuntimeTaskRegistryPort,
): ContextArtifactRuntimePort {
  return {
    async inspectSource(input) {
      const data = await runOperation(registry, "inspect-source", input);
      if (data.operation !== "inspect-source" || !isRecord(data.inspection)) {
        throw new Error("Context source inspection result is invalid.");
      }
      return validateSourceInspection(data.inspection, input.artifactId);
    },
    async inspectArtifact(input) {
      const data = await runOperation(registry, "inspect-artifact", input);
      if (data.operation !== "inspect-artifact" || !isRecord(data.inspection)) {
        throw new Error("Context artifact inspection result is invalid.");
      }
      return validateArtifactInspection(data.inspection, input.mediaType);
    },
    async query(input) {
      const data = await runOperation(registry, "query", input);
      if (data.operation !== "query" || !Array.isArray(data.matches)) {
        throw new Error("Context retrieval result is invalid.");
      }
      if (
        data.matches.length > input.maximumResults ||
        data.matches.length > CONTEXT_GENERATION_LIMITS.maximumQueryResults
      ) {
        throw new Error("Context retrieval returned too many matches.");
      }
      return data.matches.map(validateMatch);
    },
  };
}

async function runOperation(
  registry: RuntimeTaskRegistryPort,
  operation: "inspect-source" | "inspect-artifact" | "query",
  input: OperationInput,
): Promise<Record<string, unknown>> {
  if (
    !(input.content instanceof Uint8Array) ||
    input.content.byteLength < 1 ||
    input.content.byteLength > CONTEXT_GENERATION_LIMITS.maximumArtifactBytes ||
    !DIGEST_PATTERN.test(input.digest) ||
    digest(input.content) !== input.digest
  ) {
    throw new Error("Context artifact bytes do not match their descriptor.");
  }
  const workingDirectory = await mkdtemp(
    join(tmpdir(), "ai-system-builder-context-operation-"),
  );
  const inputPath = join(workingDirectory, "input.bin");
  const requestId = randomUUID();
  try {
    await writeFile(inputPath, input.content, { flag: "wx" });
    await registry.startTask({
      requestId,
      workspaceId: input.workspaceId as never,
      taskType: TaskType.CONTEXT_RETRIEVAL,
      payload: {
        workspaceId: input.workspaceId,
        operation,
        artifactId: input.artifactId,
        localPath: inputPath,
        mediaType: input.mediaType,
        digest: input.digest,
        sizeBytes: input.content.byteLength,
        ...(input.originalName ? { originalName: input.originalName } : {}),
        ...(input.chunking ? { chunking: input.chunking } : {}),
        ...(input.sourceInformation
          ? { sourceInformation: input.sourceInformation }
          : {}),
        ...(input.sourceChecks ? { sourceChecks: input.sourceChecks } : {}),
        ...(input.query ? { query: input.query } : {}),
        ...(input.maximumResults !== undefined
          ? { maximumResults: input.maximumResults }
          : {}),
        runtime: { runtimeWorkingDirectory: workingDirectory },
      },
      metadata: { operation: "context-artifact-operation" },
    });
    const deadline = Date.now() + PYTHON_RUNTIME_TASK_TIMEOUTS.contextRetrieval;
    let pollInterval = INITIAL_POLL_INTERVAL_MS;
    while (Date.now() < deadline) {
      const status = await registry.getTaskStatus(requestId);
      if (status.status === "succeeded") {
        if (!("data" in status) || !isRecord(status.data)) {
          throw new Error("Context artifact operation returned invalid data.");
        }
        return status.data;
      }
      if (
        status.status === "failed" ||
        status.status === "cancelled" ||
        status.status === "unknown"
      ) {
        throw new Error(
          "error" in status && status.error?.message
            ? status.error.message
            : "Context artifact operation could not be completed.",
        );
      }
      await delay(pollInterval);
      pollInterval = Math.min(pollInterval * 2, MAXIMUM_POLL_INTERVAL_MS);
    }
    await registry.cancelTask(requestId);
    throw new Error("Context artifact operation timed out.");
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function validateSourceInspection(
  value: Record<string, unknown>,
  artifactId: string,
): ContextSourceInspection {
  if (
    value.artifactId !== artifactId ||
    typeof value.digest !== "string" ||
    !DIGEST_PATTERN.test(value.digest) ||
    typeof value.mediaType !== "string" ||
    typeof value.sizeBytes !== "number" ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.sizeBytes > CONTEXT_GENERATION_LIMITS.maximumSourceBytes ||
    typeof value.ready !== "boolean" ||
    (value.sourceKind !== "structured" && value.sourceKind !== "document") ||
    typeof value.format !== "string" ||
    !Array.isArray(value.textFields) ||
    value.textFields.length > CONTEXT_GENERATION_LIMITS.maximumTextFieldCount ||
    value.textFields.some(
      (field) =>
        typeof field !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(field),
    ) ||
    typeof value.alreadyChunked !== "boolean" ||
    !Number.isSafeInteger(value.chunkCount) ||
    (value.chunkCount as number) < 1 ||
    (value.chunkCount as number) > CONTEXT_GENERATION_LIMITS.maximumChunkCount
  ) {
    throw new Error("Context source inspection result is invalid.");
  }
  const sourceInformation = validateSourceInformation(value.sourceInformation);
  const checks = validateSourceChecks(value.checks);
  if (
    (value.sourceInformation !== undefined && !sourceInformation) ||
    (value.checks !== undefined && !checks) ||
    (checks && value.ready !== (checks.status === "ready"))
  ) {
    throw new Error("Context source inspection result is invalid.");
  }
  return {
    artifactId,
    digest: value.digest,
    mediaType: value.mediaType,
    ...(typeof value.originalName === "string"
      ? { originalName: value.originalName.slice(0, 512) }
      : {}),
    sizeBytes: value.sizeBytes as number,
    ready: value.ready,
    sourceKind: value.sourceKind,
    format: value.format.slice(0, 80),
    textFields: value.textFields as string[],
    alreadyChunked: value.alreadyChunked,
    chunkCount: value.chunkCount as number,
    ...(sourceInformation ? { sourceInformation } : {}),
    ...(checks ? { checks } : {}),
  };
}

function validateSourceInformation(
  value: unknown,
): ContextSourceInformation | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const limits: Record<keyof ContextSourceInformation, number> = {
    author: 512,
    license: 512,
    consent: 512,
    sourceUrl: 2_048,
    language: 16,
  };
  const result: Record<string, string> = {};
  for (const [key, maximum] of Object.entries(limits)) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (
      typeof candidate !== "string" ||
      !candidate.trim() ||
      candidate.length > maximum
    ) {
      return undefined;
    }
    result[key] = candidate.trim();
  }
  if (result.sourceUrl && !/^https?:\/\/[^\s]+$/i.test(result.sourceUrl)) {
    return undefined;
  }
  return Object.keys(result).length
    ? (result as ContextSourceInformation)
    : undefined;
}

function validateSourceChecks(
  value: unknown,
): ContextSourceCheckResult | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    (value.status !== "ready" && value.status !== "blocked") ||
    !Number.isSafeInteger(value.checkedChunkCount) ||
    (value.checkedChunkCount as number) < 1 ||
    (value.checkedChunkCount as number) >
      CONTEXT_GENERATION_LIMITS.maximumChunkCount ||
    !isRecord(value.issueCounts) ||
    !Array.isArray(value.checkedSurfaces) ||
    value.checkedSurfaces.length < 1 ||
    value.checkedSurfaces.length > 16 ||
    !Array.isArray(value.limitations) ||
    value.limitations.length > 16
  ) {
    return undefined;
  }
  const issueKeys = [
    "exactDuplicate",
    "fuzzyDuplicate",
    "textTooShort",
    "textTooLong",
    "languageNotAllowed",
    "languageUncertain",
    "sensitivePersonalData",
    "secretLikeContent",
    "licenseMetadataMissing",
    "consentMetadataMissing",
  ] as const;
  const issueCounts = value.issueCounts as Record<string, unknown>;
  if (
    issueKeys.some(
      (key) =>
        !Number.isSafeInteger(issueCounts[key]) ||
        (issueCounts[key] as number) < 0 ||
        (issueCounts[key] as number) >
          CONTEXT_GENERATION_LIMITS.maximumChunkCount,
    ) ||
    [...value.checkedSurfaces, ...value.limitations].some(
      (entry) =>
        typeof entry !== "string" || !entry.trim() || entry.length > 512,
    )
  ) {
    return undefined;
  }
  return value as unknown as ContextSourceCheckResult;
}

function validateArtifactInspection(
  value: Record<string, unknown>,
  expectedMediaType: string,
): ContextArtifactInspection {
  const manifest = validateManifest(value.manifest, expectedMediaType);
  if (
    !Number.isSafeInteger(value.chunkCount) ||
    (value.chunkCount as number) < 1 ||
    (value.chunkCount as number) >
      CONTEXT_GENERATION_LIMITS.maximumChunkCount ||
    !Array.isArray(value.packageEntries) ||
    value.packageEntries.length >
      CONTEXT_GENERATION_LIMITS.maximumPackageEntryCount ||
    value.packageEntries.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length < 1 ||
        entry.length > 200 ||
        entry.includes("..") ||
        entry.includes("\\"),
    ) ||
    !Array.isArray(value.topics) ||
    value.topics.length > CONTEXT_GENERATION_LIMITS.maximumTopicCount
  ) {
    throw new Error("Context artifact inspection result is invalid.");
  }
  const topics = value.topics.map((topic) => {
    if (
      !isRecord(topic) ||
      typeof topic.title !== "string" ||
      topic.title.length < 1 ||
      topic.title.length > CONTEXT_GENERATION_LIMITS.maximumTitleCharacters ||
      typeof topic.summary !== "string" ||
      topic.summary.length < 1 ||
      topic.summary.length > 64_000 ||
      (manifest.contextPack?.maximumSummaryLines !== undefined &&
        topic.summary.split(/\r?\n/).length >
          manifest.contextPack.maximumSummaryLines) ||
      !Array.isArray(topic.citations) ||
      topic.citations.length < 1 ||
      topic.citations.length > 10 ||
      topic.citations.some(
        (citation) =>
          typeof citation !== "string" ||
          citation.length < 1 ||
          citation.length > 640,
      )
    ) {
      throw new Error("Context pack topic result is invalid.");
    }
    return {
      title: topic.title,
      summary: topic.summary,
      citations: topic.citations as string[],
    };
  });
  return {
    manifest,
    chunkCount: value.chunkCount as number,
    packageEntries: value.packageEntries as string[],
    topics,
  };
}

function validateManifest(
  value: unknown,
  expectedMediaType: string,
): ContextArtifactManifest {
  if (
    !isRecord(value) ||
    !isContextArtifactMediaType(expectedMediaType) ||
    value.schemaVersion !== "1" ||
    value.mediaType !== expectedMediaType ||
    (value.kind !== "rag-database" && value.kind !== "markdown-context-pack") ||
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > CONTEXT_GENERATION_LIMITS.maximumNameCharacters ||
    typeof value.createdAt !== "string" ||
    !Array.isArray(value.sources) ||
    value.sources.length > CONTEXT_GENERATION_LIMITS.maximumSourceCount ||
    !Array.isArray(value.manualEntries) ||
    value.manualEntries.length >
      CONTEXT_GENERATION_LIMITS.maximumManualEntryCount ||
    !isRecord(value.chunking) ||
    JSON.stringify(value).length > 512 * 1024
  ) {
    throw new Error("Context artifact manifest is invalid.");
  }
  const expectedKind = expectedMediaType.includes("rag-database")
    ? "rag-database"
    : "markdown-context-pack";
  if (value.kind !== expectedKind) {
    throw new Error("Context artifact manifest kind is invalid.");
  }
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      typeof source.artifactId !== "string" ||
      !source.artifactId ||
      typeof source.digest !== "string" ||
      !DIGEST_PATTERN.test(source.digest) ||
      typeof source.mediaType !== "string" ||
      !Number.isSafeInteger(source.sizeBytes) ||
      !Number.isSafeInteger(source.chunkCount) ||
      (source.chunkCount as number) < 1 ||
      (source.chunkingMode !== "persisted" &&
        source.chunkingMode !== "extracted")
    ) {
      throw new Error("Context artifact source manifest is invalid.");
    }
    const sourceInformation = validateSourceInformation(
      source.sourceInformation,
    );
    if (source.sourceInformation !== undefined && !sourceInformation) {
      throw new Error("Context artifact source information is invalid.");
    }
  }
  if (
    value.kind === "rag-database" &&
    value.sourceChecks !== undefined &&
    !validateSourceCheckSettings(value.sourceChecks)
  ) {
    throw new Error("Context artifact source-check settings are invalid.");
  }
  if (
    value.kind === "markdown-context-pack" &&
    value.sourceChecks !== undefined
  ) {
    throw new Error("Context pack source-check settings are invalid.");
  }
  if (value.kind === "markdown-context-pack") {
    const settings = value.contextPack;
    if (!isRecord(settings)) {
      throw new Error("Context pack manifest settings are invalid.");
    }
    if (settings.inputMode === undefined) {
      if (
        (settings.method !== "deterministic" &&
          settings.method !== "local-model") ||
        !Number.isSafeInteger(settings.topicCount) ||
        (settings.topicCount as number) < 1 ||
        (settings.topicCount as number) >
          CONTEXT_GENERATION_LIMITS.maximumTopicCount ||
        !Number.isSafeInteger(settings.maximumSummaryCharacters) ||
        (settings.maximumSummaryCharacters as number) < 64 ||
        (settings.maximumSummaryCharacters as number) >
          CONTEXT_GENERATION_LIMITS.maximumSummaryCharacters
      ) {
        throw new Error("Legacy context pack manifest settings are invalid.");
      }
    } else {
      const summaryLimitValid =
        Number.isSafeInteger(settings.maximumSummaryLines) &&
        (settings.maximumSummaryLines as number) >= 1 &&
        (settings.maximumSummaryLines as number) <=
          CONTEXT_GENERATION_LIMITS.maximumSummaryLines;
      if (
        (settings.inputMode !== "manual" &&
          settings.inputMode !== "source-materials") ||
        (settings.method !== "none" && settings.method !== "local-model") ||
        (settings.inputMode === "manual" && settings.method !== "none") ||
        (settings.inputMode === "manual" &&
          settings.cleaningPreset !== undefined) ||
        (settings.inputMode === "source-materials" &&
          settings.cleaningPreset !== "standard" &&
          settings.cleaningPreset !== "strict") ||
        (settings.method === "local-model" && !summaryLimitValid) ||
        (settings.method === "none" &&
          settings.maximumSummaryLines !== undefined)
      ) {
        throw new Error("Context pack manifest settings are invalid.");
      }
    }
    const modelIdValid =
      typeof settings.modelId === "string" &&
      settings.modelId.length >= 1 &&
      settings.modelId.length <= 193;
    if (
      (settings.method === "local-model") !== modelIdValid ||
      (settings.modelId !== undefined && !modelIdValid)
    ) {
      throw new Error("Context pack manifest model settings are invalid.");
    }
  }
  return value as unknown as ContextArtifactManifest;
}

function validateSourceCheckSettings(
  value: unknown,
): value is ContextSourceCheckSettings {
  return (
    isRecord(value) &&
    (value.preset === "recommended" || value.preset === "strict") &&
    Array.isArray(value.allowedLanguages) &&
    value.allowedLanguages.length >= 1 &&
    value.allowedLanguages.length <= 16 &&
    new Set(value.allowedLanguages).size === value.allowedLanguages.length &&
    value.allowedLanguages.every(
      (language) =>
        typeof language === "string" &&
        /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language),
    ) &&
    typeof value.requireLicenseMetadata === "boolean" &&
    typeof value.requireConsentMetadata === "boolean" &&
    typeof value.includeSourceAttribution === "boolean"
  );
}

function validateMatch(value: unknown): ContextRetrievalMatch {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 640 ||
    typeof value.excerpt !== "string" ||
    value.excerpt.length < 1 ||
    value.excerpt.length >
      CONTEXT_GENERATION_LIMITS.maximumRetrievalExcerptCharacters ||
    typeof value.score !== "number" ||
    !Number.isFinite(value.score) ||
    value.score < -1 ||
    value.score > 1
  ) {
    throw new Error("Context retrieval match is invalid.");
  }
  return {
    id: value.id,
    excerpt: value.excerpt,
    score: value.score,
    citation: validateCitation(value.citation),
  };
}

function validateCitation(value: unknown): ContextChunkCitation {
  if (
    !isRecord(value) ||
    typeof value.sourceArtifactId !== "string" ||
    !value.sourceArtifactId ||
    typeof value.sourceDigest !== "string" ||
    !DIGEST_PATTERN.test(value.sourceDigest) ||
    !Number.isSafeInteger(value.chunkIndex) ||
    (value.chunkIndex as number) < 0
  ) {
    throw new Error("Context retrieval citation is invalid.");
  }
  return value as unknown as ContextChunkCitation;
}

function digest(content: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
