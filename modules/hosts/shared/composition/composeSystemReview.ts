import type { ArtifactBrowserMetadataReadPort } from "../../../application/ports/artifact-browser";
import type { ArtifactContentRetrievalPort } from "../../../application/ports/artifact-content";
import type {
  SystemBuildArtifactPort,
  SystemBuildRepositoryPort,
} from "../../../application/ports/system-build";
import { ReleaseBoundSystemReviewDefinitionService } from "../../../application/services/system-review";
import { ReleaseBoundSystemReviewUseCases } from "../../../application/use-cases/system-review";
import { createStructuredSystemReviewAuditRepository } from "../../../adapters/persistence/system-review";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";

export interface ComposeSystemReviewOptions {
  readonly documents: StructuredDocumentStore;
  readonly builds: SystemBuildRepositoryPort;
  readonly buildArtifacts: SystemBuildArtifactPort;
  readonly artifacts: ArtifactBrowserMetadataReadPort;
  readonly content: ArtifactContentRetrievalPort;
  readonly generateAuditId: () => string;
  readonly now?: () => string;
}

export function composeSystemReview(options: ComposeSystemReviewOptions) {
  const audit = createStructuredSystemReviewAuditRepository(options.documents);
  const definitions = new ReleaseBoundSystemReviewDefinitionService(
    options.builds,
    options.buildArtifacts,
  );
  const runtime = new ReleaseBoundSystemReviewUseCases({
    definitions,
    artifacts: options.artifacts,
    content: options.content,
    audit,
    generateAuditId: options.generateAuditId,
    now: options.now,
  });
  return { audit, definitions, runtime };
}

export type SystemReviewCompositionRoot = ReturnType<
  typeof composeSystemReview
>;
