import type {
  ContextArtifactInspection,
  ContextChunkingSettings,
  ContextRetrievalMatch,
  ContextSourceCheckSettings,
  ContextSourceInformation,
  ContextSourceInspection,
} from "../../../contracts/context-management";
import type { WorkspaceId } from "../../../contracts/workspace";

interface ContextArtifactRuntimeInput {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly digest: string;
}

export interface InspectContextSourceInput extends ContextArtifactRuntimeInput {
  readonly originalName?: string;
  readonly chunking: ContextChunkingSettings;
  readonly sourceInformation?: ContextSourceInformation;
  readonly sourceChecks?: ContextSourceCheckSettings;
}

export interface InspectContextArtifactInput extends ContextArtifactRuntimeInput {}

export interface QueryContextArtifactInput extends ContextArtifactRuntimeInput {
  readonly query: string;
  readonly maximumResults: number;
}

export interface ContextArtifactRuntimePort {
  inspectSource(
    input: InspectContextSourceInput,
  ): Promise<ContextSourceInspection>;
  inspectArtifact(
    input: InspectContextArtifactInput,
  ): Promise<ContextArtifactInspection>;
  query(
    input: QueryContextArtifactInput,
  ): Promise<readonly ContextRetrievalMatch[]>;
}
