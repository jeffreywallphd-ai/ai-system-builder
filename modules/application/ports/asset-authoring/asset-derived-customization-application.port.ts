import type {
  AbandonAssetDerivedCustomizationCommand,
  AbandonAssetDerivedCustomizationResult,
  AssetDerivedCustomizationDraftRecord,
  AssetDerivedCustomizationTargetDetail,
  CreateAssetDerivedCustomizationCommand,
  CreateAssetDerivedCustomizationResult,
  ListAssetDerivedCustomizationsQuery,
  ListAssetDerivedCustomizationTargetsQuery,
  ListAssetDerivedCustomizationTargetsResult,
  PublishAssetDerivedCustomizationCommand,
  PublishAssetDerivedCustomizationResult,
  ReadAssetDerivedCustomizationTargetQuery,
  ReviewAssetDerivedCustomizationCommand,
  ReviewAssetDerivedCustomizationResult,
  UpdateAssetDerivedCustomizationCommand,
  UpdateAssetDerivedCustomizationResult,
} from "../../../contracts/asset-authoring";
import type { AssetCustomizationId } from "../../../contracts/asset-authoring";
import type { WorkspaceId } from "../../../contracts/workspace";

import type { AssetDerivedCustomizationListResult } from "./asset-derived-customization-repository.port";

/** Host-neutral application facade used by API and desktop transport adapters. */
export interface AssetDerivedCustomizationApplicationPort {
  listTargets(
    query: ListAssetDerivedCustomizationTargetsQuery,
  ): Promise<ListAssetDerivedCustomizationTargetsResult>;
  readTarget(
    query: ReadAssetDerivedCustomizationTargetQuery,
  ): Promise<AssetDerivedCustomizationTargetDetail | undefined>;
  create(
    command: CreateAssetDerivedCustomizationCommand,
  ): Promise<CreateAssetDerivedCustomizationResult>;
  update(
    command: UpdateAssetDerivedCustomizationCommand,
  ): Promise<UpdateAssetDerivedCustomizationResult>;
  review(
    command: ReviewAssetDerivedCustomizationCommand,
  ): Promise<ReviewAssetDerivedCustomizationResult>;
  publish(
    command: PublishAssetDerivedCustomizationCommand,
  ): Promise<PublishAssetDerivedCustomizationResult>;
  abandon(
    command: AbandonAssetDerivedCustomizationCommand,
  ): Promise<AbandonAssetDerivedCustomizationResult>;
  read(
    workspaceId: WorkspaceId,
    customizationId: AssetCustomizationId,
  ): Promise<AssetDerivedCustomizationDraftRecord | undefined>;
  list(
    query: ListAssetDerivedCustomizationsQuery,
  ): Promise<AssetDerivedCustomizationListResult>;
}
