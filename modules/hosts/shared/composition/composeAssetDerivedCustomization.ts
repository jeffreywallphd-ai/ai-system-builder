import { createHash, randomUUID } from "node:crypto";

import { createStructuredAssetDerivedCustomizationRepository } from "../../../adapters/persistence/asset-authoring";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { AssetDefinitionRepositoryPort } from "../../../application/ports/asset";
import type {
  AssetDerivedCustomizationApplicationPort,
  AuthoredAssetRepositoryPort,
} from "../../../application/ports/asset-authoring";
import type { AssetImplementationArtifactPort } from "../../../application/ports/asset-implementation";
import { AssetDerivedCustomizationTargetCatalogService } from "../../../application/services/asset";
import { AssetDerivedCustomizationWorkflowUseCase } from "../../../application/use-cases/asset-authoring";
import { normalizeAssetCustomizationId } from "../../../contracts/asset-authoring";
import {
  normalizeSha256Digest,
  type Sha256Digest,
} from "../../../contracts/asset-implementation";

import type { AssetImplementationKernelComposition } from "./composeAssetImplementationKernel";

export function composeAssetDerivedCustomization(options: {
  readonly documents: StructuredDocumentStore;
  readonly definitions: AssetDefinitionRepositoryPort;
  readonly implementations: AssetImplementationKernelComposition;
  readonly artifacts: AssetImplementationArtifactPort;
  readonly authoredAssets?: AuthoredAssetRepositoryPort;
  readonly ensureReady?: () => Promise<void>;
  readonly now: () => string;
}) {
  const repository = createStructuredAssetDerivedCustomizationRepository(
    options.documents,
  );
  const targets = new AssetDerivedCustomizationTargetCatalogService({
    definitions: options.definitions,
    implementations: options.implementations.repository,
    backingResources: options.implementations.backingResources,
    artifacts: options.artifacts,
    ...(options.authoredAssets ? { authoredAssets: options.authoredAssets } : {}),
  });
  const workflow = new AssetDerivedCustomizationWorkflowUseCase({
    customizations: repository,
    targets,
    definitions: options.definitions,
    implementations: options.implementations.repository,
    artifacts: options.artifacts,
    digestText,
    nextCustomizationId: () =>
      normalizeAssetCustomizationId(`customization.${randomUUID()}`),
    now: options.now,
  });
  const ready = options.ensureReady ?? (async () => undefined);
  const service: AssetDerivedCustomizationApplicationPort = {
    async listTargets(query) {
      await ready();
      return targets.list(query);
    },
    async readTarget(query) {
      await ready();
      return targets.read(query);
    },
    async create(command) {
      await ready();
      return workflow.create(command);
    },
    async update(command) {
      await ready();
      return workflow.update(command);
    },
    async review(command) {
      await ready();
      return workflow.review(command);
    },
    async publish(command) {
      await ready();
      return workflow.publish(command);
    },
    async abandon(command) {
      await ready();
      return workflow.abandon(command);
    },
    async read(workspaceId, customizationId) {
      await ready();
      return workflow.read(workspaceId, customizationId);
    },
    async list(query) {
      await ready();
      return workflow.list(query);
    },
  };
  return { repository, targets, workflow, service };
}

export type AssetDerivedCustomizationComposition = ReturnType<
  typeof composeAssetDerivedCustomization
>;

function digestText(value: string): Sha256Digest {
  return normalizeSha256Digest(
    `sha256:${createHash("sha256").update(value).digest("hex")}`,
  );
}
