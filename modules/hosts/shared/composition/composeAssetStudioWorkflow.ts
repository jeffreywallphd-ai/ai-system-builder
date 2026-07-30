import { createHash, randomUUID } from "node:crypto";

import type { AssetDefinitionRepositoryPort } from "../../../application/ports/asset";
import type { AssetCodingModelPort } from "../../../application/ports/asset-studio";
import {
  AssetStudioAssetDraftWorkflowUseCase,
  ListAssetStudioWorkflowsUseCase,
  ProposeAssetStudioChangeUseCase,
  ReadAssetStudioProposalUseCase,
  ReviewAssetStudioProposalUseCase,
  StartAssetStudioUseCase,
} from "../../../application/use-cases/asset-studio";
import {
  createStructuredAssetStudioAssetDraftRepository,
  createStructuredAssetStudioWorkflowRepository,
} from "../../../adapters/persistence/asset-studio";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { AssetImplementationArtifactPort } from "../../../application/ports/asset-implementation";
import type { AssetImplementationKernelComposition } from "./composeAssetImplementationKernel";
import { normalizeSha256Digest } from "../../../contracts/asset-implementation";
import {
  normalizeAssetImplementationDraftId,
  normalizeAssetSourceSnapshotId,
} from "../../../contracts/asset-implementation";

export function composeAssetStudioWorkflow(options: {
  readonly documents: StructuredDocumentStore;
  readonly implementations: AssetImplementationKernelComposition;
  readonly artifacts: AssetImplementationArtifactPort;
  readonly definitions: AssetDefinitionRepositoryPort;
  readonly codingModel?: AssetCodingModelPort;
  readonly codingModelTimeoutMs?: number;
  readonly now: () => string;
}) {
  const workflows = createStructuredAssetStudioWorkflowRepository(
    options.documents,
  );
  const assetDrafts = createStructuredAssetStudioAssetDraftRepository(
    options.documents,
  );
  const snapshotSource = options.implementations.useCases.snapshotSource;
  if (!snapshotSource)
    throw new Error(
      "Asset Studio requires immutable implementation artifact storage.",
    );
  return {
    repository: workflows,
    assetDraftRepository: assetDrafts,
    useCases: {
      assetDrafts: new AssetStudioAssetDraftWorkflowUseCase({
        drafts: assetDrafts,
        definitions: options.definitions,
        implementations: options.implementations.repository,
        artifacts: options.artifacts,
        nextDraftId: () => `studio-asset-draft.${randomUUID()}`,
        now: options.now,
      }),
      propose: new ProposeAssetStudioChangeUseCase({
        workflows,
        implementations: options.implementations.repository,
        artifacts: options.artifacts,
        codingModel: options.codingModel,
        digestText: (value) =>
          normalizeSha256Digest(
            `sha256:${createHash("sha256").update(value).digest("hex")}`,
          ),
        now: options.now,
        timeoutMs: options.codingModelTimeoutMs,
      }),
      start: new StartAssetStudioUseCase(
        options.implementations.useCases.createDraft,
        () =>
          normalizeAssetImplementationDraftId(
            `implementation-draft.${randomUUID()}`,
          ),
      ),
      review: new ReviewAssetStudioProposalUseCase({
        workflows,
        artifacts: options.artifacts,
        snapshotSource,
        nextSnapshotId: () =>
          normalizeAssetSourceSnapshotId(`source-snapshot.${randomUUID()}`),
        now: options.now,
      }),
      read: new ReadAssetStudioProposalUseCase(workflows, options.artifacts),
      list: new ListAssetStudioWorkflowsUseCase(workflows),
    },
  };
}

export type AssetStudioWorkflowComposition = ReturnType<
  typeof composeAssetStudioWorkflow
>;
