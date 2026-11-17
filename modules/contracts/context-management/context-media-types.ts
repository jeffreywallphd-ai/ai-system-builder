export const CONTEXT_RAG_DATABASE_MEDIA_TYPE =
  "application/vnd.ai-system-builder.rag-database+lancedb+zip";

export const CONTEXT_MARKDOWN_PACK_MEDIA_TYPE =
  "application/vnd.ai-system-builder.markdown-context-pack+zip";

export const CONTEXT_CHUNK_SET_MEDIA_TYPE =
  "application/vnd.ai-system-builder.context-chunks+json";

export const CONTEXT_ARTIFACT_MEDIA_TYPES = [
  CONTEXT_RAG_DATABASE_MEDIA_TYPE,
  CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
] as const;

export type ContextArtifactMediaType =
  (typeof CONTEXT_ARTIFACT_MEDIA_TYPES)[number];

export function isContextArtifactMediaType(
  value: string | undefined,
): value is ContextArtifactMediaType {
  return CONTEXT_ARTIFACT_MEDIA_TYPES.includes(
    value as ContextArtifactMediaType,
  );
}

export function resolveContextArtifactKind(
  mediaType: string | undefined,
): "rag-database" | "markdown-context-pack" | undefined {
  if (mediaType === CONTEXT_RAG_DATABASE_MEDIA_TYPE) {
    return "rag-database";
  }
  if (mediaType === CONTEXT_MARKDOWN_PACK_MEDIA_TYPE) {
    return "markdown-context-pack";
  }
  return undefined;
}
