import type { SystemBuildArtifactPort, SystemBuildRepositoryPort } from "../../../application/ports/system-build";
import { ReleaseBoundSystemDataDefinitionService } from "../../../application/services/system-data";
import { ReleaseBoundSystemDataUseCases } from "../../../application/use-cases/system-data";
import { createStructuredSystemDataRepository } from "../../../adapters/persistence/system-data";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";

export interface ComposeSystemDataOptions {
  readonly documents: StructuredDocumentStore;
  readonly builds: SystemBuildRepositoryPort;
  readonly artifacts: SystemBuildArtifactPort;
  readonly generateAuditId: () => string;
  readonly now?: () => string;
}

export function composeSystemData(options: ComposeSystemDataOptions) {
  const repository = createStructuredSystemDataRepository(options.documents);
  const definitions = new ReleaseBoundSystemDataDefinitionService(options.builds, options.artifacts);
  const runtime = new ReleaseBoundSystemDataUseCases({
    repository,
    definitions,
    generateAuditId: options.generateAuditId,
    now: options.now,
  });
  return { repository, definitions, runtime };
}

export type SystemDataCompositionRoot = ReturnType<typeof composeSystemData>;
