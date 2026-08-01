import type { ContextArtifactMediaType } from "./context-media-types";
import type {
  ContextArtifactKind,
  ContextArtifactManifest,
  ContextChunkCitation,
  ContextChunkingSettings,
  ContextSourceCheckResult,
  ContextSourceCheckSettings,
  ContextSourceInformation,
} from "./context-contracts";

export type ContextSourceFreshnessState = "current" | "stale" | "unavailable";

export interface ContextConversionReadiness {
  readonly artifactId: string;
  readonly ready: boolean;
  readonly locallyReadable: boolean;
  readonly digest?: string;
  readonly mediaType?: string;
  readonly originalName?: string;
  readonly sizeBytes?: number;
  readonly format?: string;
  readonly sourceKind?: "structured" | "document";
  readonly textFields: readonly string[];
  readonly alreadyChunked: boolean;
  readonly chunkCount?: number;
  readonly sourceInformation?: ContextSourceInformation;
  readonly checks?: ContextSourceCheckResult;
  readonly reasonCode?: string;
  readonly message?: string;
  readonly action?: string;
}

export interface ContextBrowserItem {
  readonly artifactId: string;
  readonly storageKey: string;
  readonly kind: ContextArtifactKind;
  readonly name: string;
  readonly mediaType: ContextArtifactMediaType;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly createdAt?: string;
}

export interface ContextSourceFreshness {
  readonly artifactId: string;
  readonly expectedDigest: string;
  readonly actualDigest?: string;
  readonly state: ContextSourceFreshnessState;
}

export interface ContextPackTopicDetail {
  readonly title: string;
  readonly summary: string;
  readonly citations: readonly string[];
}

export interface ContextArtifactInspection {
  readonly manifest: ContextArtifactManifest;
  readonly chunkCount: number;
  readonly packageEntries: readonly string[];
  readonly topics: readonly ContextPackTopicDetail[];
}

export interface ContextBrowserDetail {
  readonly item: ContextBrowserItem;
  readonly manifest: ContextArtifactManifest;
  readonly freshness: readonly ContextSourceFreshness[];
  readonly chunkCount: number;
  readonly packageEntries: readonly string[];
  readonly topics: readonly ContextPackTopicDetail[];
  readonly rebuildAllowed: boolean;
  readonly rebuildAction?: string;
}

export interface ContextRetrievalRequest {
  readonly artifactId: string;
  readonly query: string;
  readonly maximumResults?: number;
}

export interface ContextRetrievalMatch {
  readonly id: string;
  readonly excerpt: string;
  readonly score: number;
  readonly citation: ContextChunkCitation;
}

export interface ContextRetrievalResult {
  readonly artifactId: string;
  readonly matches: readonly ContextRetrievalMatch[];
}

export interface ContextSourceInspectionInput {
  readonly artifactId: string;
  readonly mediaType: string;
  readonly originalName?: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly chunking: ContextChunkingSettings;
  readonly sourceChecks?: ContextSourceCheckSettings;
}
