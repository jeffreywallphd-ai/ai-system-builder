import { isWorkspaceId } from "../workspace";
import { CONTEXT_GENERATION_LIMITS } from "./context-limits";
import type {
  ContextChunkCitation,
  ContextLaunchIntent,
  ContextPersistedChunkRecord,
  ContextSourceCheckSettings,
  StartContextGenerationCommand,
} from "./context-contracts";

const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

export function normalizeContextSourceChecks(
  value: ContextSourceCheckSettings,
): ContextSourceCheckSettings {
  const allowedLanguages = [
    ...new Set(
      (value?.allowedLanguages ?? []).map((language) => language.trim()),
    ),
  ].sort();
  if (
    !value ||
    !["recommended", "strict"].includes(value.preset) ||
    allowedLanguages.length < 1 ||
    allowedLanguages.length > 16 ||
    allowedLanguages.some(
      (language) => language.length > 16 || !LANGUAGE_PATTERN.test(language),
    ) ||
    typeof value.requireLicenseMetadata !== "boolean" ||
    typeof value.requireConsentMetadata !== "boolean" ||
    typeof value.includeSourceAttribution !== "boolean"
  ) {
    throw new Error("Context source check settings are invalid.");
  }
  return {
    preset: value.preset,
    allowedLanguages,
    requireLicenseMetadata: value.requireLicenseMetadata,
    requireConsentMetadata: value.requireConsentMetadata,
    includeSourceAttribution: value.includeSourceAttribution,
  };
}

export function normalizeContextSaveName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < 1 ||
    normalized.length > CONTEXT_GENERATION_LIMITS.maximumNameCharacters ||
    !SAFE_NAME_PATTERN.test(normalized) ||
    normalized.includes("..")
  ) {
    throw new Error(
      "Context save name must use letters, numbers, spaces, periods, underscores, or hyphens.",
    );
  }
  return normalized;
}

export function normalizeContextLaunchIntent(
  value: ContextLaunchIntent,
): ContextLaunchIntent {
  if (!isWorkspaceId(value.workspaceId)) {
    throw new Error("Context launch workspace is invalid.");
  }
  const artifactId = value.artifactId.trim();
  if (artifactId.length < 1 || artifactId.length > 512) {
    throw new Error("Context launch artifact is invalid.");
  }
  if (value.targetTab !== "rag-databases") {
    throw new Error("Context launch target is invalid.");
  }
  return {
    workspaceId: value.workspaceId,
    artifactId,
    targetTab: value.targetTab,
  };
}

export function normalizeContextRetrievalRequest(value: {
  readonly artifactId: string;
  readonly query: string;
  readonly maximumResults?: number;
}): {
  readonly artifactId: string;
  readonly query: string;
  readonly maximumResults: number;
} {
  const artifactId = value.artifactId.trim();
  const query = value.query.trim();
  const maximumResults = value.maximumResults ?? 5;
  if (
    artifactId.length < 1 ||
    artifactId.length > 512 ||
    query.length < 1 ||
    query.length > CONTEXT_GENERATION_LIMITS.maximumQueryCharacters ||
    !Number.isSafeInteger(maximumResults) ||
    maximumResults < 1 ||
    maximumResults > CONTEXT_GENERATION_LIMITS.maximumQueryResults
  ) {
    throw new Error("Context retrieval request is invalid.");
  }
  return { artifactId, query, maximumResults };
}

export function validateContextChunkCitation(
  value: ContextChunkCitation,
): ContextChunkCitation {
  if (
    !value.sourceArtifactId.trim() ||
    !DIGEST_PATTERN.test(value.sourceDigest) ||
    !Number.isSafeInteger(value.chunkIndex) ||
    value.chunkIndex < 0
  ) {
    throw new Error("Context chunk citation is invalid.");
  }
  if (
    value.rowIndex !== undefined &&
    (!Number.isSafeInteger(value.rowIndex) || value.rowIndex < 0)
  ) {
    throw new Error("Context chunk row citation is invalid.");
  }
  if (value.field !== undefined && !FIELD_PATTERN.test(value.field)) {
    throw new Error("Context chunk field citation is invalid.");
  }
  if (
    (value.normalizedStart === undefined) !==
      (value.normalizedEnd === undefined) ||
    (value.normalizedStart !== undefined &&
      (!Number.isSafeInteger(value.normalizedStart) ||
        !Number.isSafeInteger(value.normalizedEnd) ||
        value.normalizedStart < 0 ||
        value.normalizedEnd! <= value.normalizedStart))
  ) {
    throw new Error("Context chunk span citation is invalid.");
  }
  if (
    value.pageNumber !== undefined &&
    (!Number.isSafeInteger(value.pageNumber) || value.pageNumber < 1)
  ) {
    throw new Error("Context chunk page citation is invalid.");
  }
  return { ...value, sourceArtifactId: value.sourceArtifactId.trim() };
}

export function validatePersistedContextChunks(
  chunks: readonly ContextPersistedChunkRecord[],
  expectedSource: { readonly artifactId: string; readonly digest: string },
): readonly ContextPersistedChunkRecord[] {
  if (
    chunks.length < 1 ||
    chunks.length > CONTEXT_GENERATION_LIMITS.maximumChunkCount
  ) {
    throw new Error("Persisted context chunk count is invalid.");
  }
  const ids = new Set<string>();
  return chunks.map((chunk) => {
    const id = chunk.id.trim();
    const citation = validateContextChunkCitation(chunk.citation);
    if (
      !id ||
      ids.has(id) ||
      citation.sourceArtifactId !== expectedSource.artifactId ||
      citation.sourceDigest !== expectedSource.digest ||
      chunk.text.length < 1 ||
      chunk.text.length > CONTEXT_GENERATION_LIMITS.maximumChunkCharacters
    ) {
      throw new Error(
        "Persisted context chunks do not match their source lineage.",
      );
    }
    ids.add(id);
    return { id, text: chunk.text, citation };
  });
}

export function validateStartContextGenerationCommand(
  value: StartContextGenerationCommand,
): StartContextGenerationCommand {
  const name = normalizeContextSaveName(value.name);
  const sources = [...value.sources];
  const manualEntries = [...(value.manualEntries ?? [])];
  if (
    sources.length > CONTEXT_GENERATION_LIMITS.maximumSourceCount ||
    manualEntries.length > CONTEXT_GENERATION_LIMITS.maximumManualEntryCount ||
    sources.length + manualEntries.length < 1
  ) {
    throw new Error("Context generation source count is invalid.");
  }
  const sourceIds = new Set<string>();
  for (const source of sources) {
    const artifactId = source.artifactId.trim();
    if (!artifactId || artifactId.length > 512 || sourceIds.has(artifactId)) {
      throw new Error("Context source artifact selection is invalid.");
    }
    sourceIds.add(artifactId);
  }
  let manualCharacters = 0;
  const manualIds = new Set<string>();
  for (const entry of manualEntries) {
    manualCharacters += entry.content.length;
    if (
      !entry.id.trim() ||
      manualIds.has(entry.id.trim()) ||
      !entry.title.trim() ||
      entry.title.length > CONTEXT_GENERATION_LIMITS.maximumTitleCharacters ||
      entry.content.length < 1 ||
      entry.content.length >
        CONTEXT_GENERATION_LIMITS.maximumManualEntryCharacters
    ) {
      throw new Error("Manual context entry is invalid.");
    }
    manualIds.add(entry.id.trim());
    validateContextMarkdown(entry.content);
  }
  if (
    manualCharacters >
    CONTEXT_GENERATION_LIMITS.maximumAggregateManualCharacters
  ) {
    throw new Error("Manual context exceeds the aggregate safe limit.");
  }
  const chunking = value.chunking;
  const sourceChecks = value.sourceChecks
    ? normalizeContextSourceChecks(value.sourceChecks)
    : undefined;
  if (
    !Number.isSafeInteger(chunking.chunkCharacters) ||
    chunking.chunkCharacters <
      CONTEXT_GENERATION_LIMITS.minimumChunkCharacters ||
    chunking.chunkCharacters >
      CONTEXT_GENERATION_LIMITS.maximumChunkCharacters ||
    !Number.isSafeInteger(chunking.overlapCharacters) ||
    chunking.overlapCharacters < 0 ||
    chunking.overlapCharacters >= chunking.chunkCharacters ||
    chunking.overlapCharacters >
      CONTEXT_GENERATION_LIMITS.maximumChunkOverlapCharacters ||
    (chunking.maximumTokensPerChunk !== undefined &&
      (!Number.isSafeInteger(chunking.maximumTokensPerChunk) ||
        chunking.maximumTokensPerChunk < 32 ||
        chunking.maximumTokensPerChunk > 4096)) ||
    (chunking.strategy === "fixed-length" &&
      chunking.maximumTokensPerChunk !== undefined) ||
    (chunking.topicBoundarySensitivity !== undefined &&
      (chunking.strategy !== "topic-aware" ||
        !Number.isFinite(chunking.topicBoundarySensitivity) ||
        chunking.topicBoundarySensitivity < 0 ||
        chunking.topicBoundarySensitivity > 1)) ||
    (chunking.maximumChunks !== undefined &&
      (!Number.isSafeInteger(chunking.maximumChunks) ||
        chunking.maximumChunks < 1 ||
        chunking.maximumChunks >
          CONTEXT_GENERATION_LIMITS.maximumChunkCount)) ||
    (chunking.textFields?.length ?? 0) >
      CONTEXT_GENERATION_LIMITS.maximumTextFieldCount ||
    chunking.textFields?.some((field) => !FIELD_PATTERN.test(field))
  ) {
    throw new Error("Context chunking settings are invalid.");
  }
  if (value.kind === "rag-database") {
    if (
      !value.embedding ||
      value.contextPack !== undefined ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(
        value.embedding.modelId,
      ) ||
      (value.embedding.dimensions !== undefined &&
        (!Number.isSafeInteger(value.embedding.dimensions) ||
          value.embedding.dimensions < 1 ||
          value.embedding.dimensions >
            CONTEXT_GENERATION_LIMITS.maximumEmbeddingDimensions))
    ) {
      throw new Error("RAG embedding settings are invalid.");
    }
  } else {
    const pack = value.contextPack;
    const hasValidSummaryLineLimit =
      Number.isSafeInteger(pack?.maximumSummaryLines) &&
      (pack?.maximumSummaryLines ?? 0) >= 1 &&
      (pack?.maximumSummaryLines ?? 0) <=
        CONTEXT_GENERATION_LIMITS.maximumSummaryLines;
    if (
      value.embedding !== undefined ||
      sourceChecks !== undefined ||
      !pack ||
      !["manual", "source-materials"].includes(pack.inputMode) ||
      (pack.inputMode === "manual" &&
        (sources.length !== 0 ||
          manualEntries.length !== 1 ||
          pack.cleaningPreset !== undefined)) ||
      (pack.inputMode === "source-materials" &&
        (sources.length < 1 ||
          manualEntries.length !== 0 ||
          chunking.strategy !== "topic-aware" ||
          (pack.cleaningPreset !== "standard" &&
            pack.cleaningPreset !== "strict"))) ||
      (pack.method === "local-model" &&
        (!pack.model || !hasValidSummaryLineLimit)) ||
      (pack.method === "none" &&
        (pack.model !== undefined || pack.maximumSummaryLines !== undefined)) ||
      (pack.inputMode === "manual" && pack.method !== "none")
    ) {
      throw new Error("Context-pack generation settings are invalid.");
    }
  }
  return {
    ...value,
    name,
    sources: sources.map((source) => ({
      artifactId: source.artifactId.trim(),
    })),
    manualEntries: manualEntries.map((entry) => ({
      id: entry.id.trim(),
      title: entry.title.trim(),
      content: entry.content,
    })),
    ...(sourceChecks ? { sourceChecks } : {}),
  };
}

export function validateContextMarkdown(value: string): string {
  if (!value.trim()) {
    throw new Error("Context pack Markdown must not be empty.");
  }
  if (/[^\t\n\r\x20-\uFFFF]/u.test(value)) {
    throw new Error("Context pack Markdown contains unsupported control characters.");
  }
  let fence: { readonly marker: "`" | "~"; readonly length: number } | undefined;
  for (const line of value.split(/\r?\n/)) {
    const match = /^\s*(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    const marker = match[1][0] as "`" | "~";
    if (!fence) {
      fence = { marker, length: match[1].length };
    } else if (fence.marker === marker && match[1].length >= fence.length) {
      fence = undefined;
    }
  }
  if (fence) {
    throw new Error("Context pack Markdown contains an unclosed fenced code block.");
  }
  return value;
}
