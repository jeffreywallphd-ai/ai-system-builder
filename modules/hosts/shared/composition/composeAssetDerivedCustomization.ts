import { captureDerivedCreate, captureDerivedUpdate, captureDerivedTransition, captureDerivedList, captureDerivedTargetList, captureDerivedTargetRead } from "../../../application/services/asset/capture-derived-customization-requests";
import type { AssetDefinitionPublicationPort } from "../../../application/ports/asset-publication";
import { requireWorkspaceAssetAccess } from "../../../application/services/asset/workspace-asset-access.service";
import type { WorkspaceAssetAccessPort } from "../../../application/ports/asset/workspace-asset-access.port";
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
  readonly workspaceAccess: WorkspaceAssetAccessPort;
  readonly publication: AssetDefinitionPublicationPort;
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
    workspaceAccess: options.workspaceAccess,
    definitions: options.definitions,
    implementations: options.implementations.repository,
    backingResources: options.implementations.backingResources,
    artifacts: options.artifacts,
    ...(options.authoredAssets ? { authoredAssets: options.authoredAssets } : {}),
  });
  const workflow = new AssetDerivedCustomizationWorkflowUseCase({
        publication: options.publication,
    workspaceAccess: options.workspaceAccess,
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
      query = captureDerivedTargetList(query);
      await requireWorkspaceAssetAccess(options.workspaceAccess, query.workspaceId, "asset-authoring.customization.listTargets", "asset:read");
      await ready();
      return targets.list(query);
    },
    async readTarget(query) {
      query = captureDerivedTargetRead(query);
      await requireWorkspaceAssetAccess(options.workspaceAccess, query.workspaceId, "asset-authoring.customization.readTarget", "asset:read");
      await ready();
      return targets.read(query);
    },
    async create(command) {
      command = captureDerivedCreate(command);
      await requireWorkspaceAssetAccess(options.workspaceAccess, command.workspaceId, "asset-authoring.customization.create", "asset:write");
      await ready();
      return workflow.create(command);
    },
    async update(command) {
      command = captureDerivedUpdate(command);
      await requireWorkspaceAssetAccess(options.workspaceAccess, command.workspaceId, "asset-authoring.customization.update", "asset:write");
      await ready();
      return workflow.update(command);
    },
    async review(command) {
      command = captureDerivedTransition(command);
      await requireWorkspaceAssetAccess(options.workspaceAccess, command.workspaceId, "asset-authoring.customization.review", "asset:write");
      await ready();
      return workflow.review(command);
    },
    async publish(command) {
      command = captureDerivedTransition(command);
      await requireWorkspaceAssetAccess(options.workspaceAccess, command.workspaceId, "asset-authoring.customization.publish", "asset:write");
      await ready();
      return workflow.publish(command);
    },
    async abandon(command) {
      command = captureDerivedTransition(command);
      await requireWorkspaceAssetAccess(options.workspaceAccess, command.workspaceId, "asset-authoring.customization.abandon", "asset:write");
      await ready();
      return workflow.abandon(command);
    },
    async read(workspaceId, customizationId) {
      await requireWorkspaceAssetAccess(options.workspaceAccess, workspaceId, "asset-authoring.customization.read", "asset:read");
      await ready();
      return workflow.read(workspaceId, customizationId);
    },
    async list(query) {
      query = captureDerivedList(query);
      await requireWorkspaceAssetAccess(options.workspaceAccess, query.workspaceId, "asset-authoring.customization.list", "asset:read");
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
