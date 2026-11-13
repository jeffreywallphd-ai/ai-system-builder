import { systemBuilderFailure, systemBuilderSuccess, type SystemBuilderResult } from "../../../contracts/system-builder";
import {
  parseHeadlessSemanticBatchRequest,
  type HeadlessHostIncarnationId,
  type HeadlessSemanticBatchRequest,
} from "../../../contracts/headless";
import type { AssetDefinition, AssetReference } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import type { ValidateSystemBuilderRevisionService } from "../../services/system-builder";
import { reconcileSystemBuilderConversationInteractions } from "../../services/system-builder";
import { preserveDefaultFormPreference, type SaveSystemBuilderRevisionUseCase } from "./system-builder-use-cases";
import { prepareHeadlessEditDraft } from "./headless-semantic-edit-draft";

type EditOperation = HeadlessSemanticBatchRequest["operation"];
type BatchValue = {
  readonly kind: "preview";
  readonly previewDigest: string;
  readonly removedInstanceIds: readonly string[];
  readonly removedBindingIds: readonly string[];
  readonly validation: "valid" | "valid-with-warnings";
} | {
  readonly kind: "applied";
  readonly revisionId: string;
  readonly recordRevision: number;
};

const invalid = () => systemBuilderFailure("headless.invalid-edit-batch", "The batch does not match the saved system or would create an invalid revision.");
const forbidden = () => systemBuilderFailure("headless.forbidden", "Workspace access is unavailable.");
const stale = () => systemBuilderFailure("headless.stale-revision", "The saved system changed. Read its current revision and preview again.");
const unavailable = () => systemBuilderFailure("headless.unavailable", "The edit could not be completed.");

export class HeadlessSemanticEditUseCase {
  public constructor(private readonly dependencies: {
    readonly systems: Pick<SystemBuilderRepositoryPort, "readRecord" | "readRevision">;
    readonly access: WorkspaceAssetAccessPort;
    /** Resolve exact admitted definitions in this workspace, with no global fallback. */
    readonly resolveDefinition: (workspaceId: WorkspaceId, reference: AssetReference) => Promise<AssetDefinition | undefined>;
    readonly validator: Pick<ValidateSystemBuilderRevisionService, "execute">;
    readonly saveRevision: Pick<SaveSystemBuilderRevisionUseCase, "executeStrict">;
    readonly digest: (canonicalInput: string) => string;
  }) {}

  public async execute(raw: unknown, authority: {
    readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly actorId: string;
    readonly canUse: (workspaceId: WorkspaceId, operation: EditOperation) => Promise<boolean>;
  }): Promise<SystemBuilderResult<BatchValue>> {
    const { actorId, hostIncarnationId, canUse } = authority;
    const parsed = parseHeadlessSemanticBatchRequest(raw, hostIncarnationId);
    if (!parsed.ok) return parsed.code === "headless.host-changed"
      ? systemBuilderFailure("headless.host-changed", "The host restarted. Connect again before retrying.")
      : invalid();
    const { operation, input } = parsed.request;
    const { workspaceId, systemId, baseRecordRevision, baseRevisionId, edits } = input;
    if (!actorId || actorId !== actorId.trim() || actorId.length > 160 || /[\u0000-\u001f\u007f]/.test(actorId)) return forbidden();
    const matchesBase = (value: Awaited<ReturnType<SystemBuilderRepositoryPort["readRecord"]>>) =>
      value && value.targetWorkspaceId === workspaceId && value.systemId === systemId &&
      value.revision === baseRecordRevision && value.currentRevisionId === baseRevisionId && value.status !== "archived";
    const authorize = async () => {
      try {
        if (!await canUse(workspaceId, operation)) return false;
        await this.dependencies.access.authorize(workspaceId, operation, operation === "systems.preview-edits" ? "asset:read" : "asset:write");
        return await canUse(workspaceId, operation);
      } catch { return false; }
    };
    try {
      if (!await authorize()) return forbidden();
      const record = await this.dependencies.systems.readRecord(workspaceId, systemId);
      if (!record || !matchesBase(record)) return stale();
      const current = await this.dependencies.systems.readRevision(workspaceId, systemId, baseRevisionId);
      if (!current || current.targetWorkspaceId !== workspaceId || current.systemId !== systemId ||
          current.revisionId !== baseRevisionId || current.composition.compositionId !== record.composition.compositionId) return stale();

      let draft;
      try {
        draft = await prepareHeadlessEditDraft({
          ...current, composition: preserveDefaultFormPreference(current.composition, record.composition),
        }, edits,
          (reference) => this.dependencies.resolveDefinition(workspaceId, reference));
      } catch {
        return invalid();
      }
      // The interactive save can repair old reference templates. An approved batch
      // must have no unpreviewed writes; ask the editor to repair a legacy template first.
      if (reconcileSystemBuilderConversationInteractions({
        ...draft, systemId, actorId, timestamp: current.createdAt,
      }).addedBinding) return invalid();
      const validation = await this.dependencies.validator.execute({ ...draft, targetWorkspaceId: workspaceId });
      if (validation.status !== "valid" && validation.status !== "valid-with-warnings") return invalid();
      const previewDigest = this.dependencies.digest(canonicalJson({
        version: parsed.request.version, workspaceId, systemId, baseRecordRevision, baseRevisionId,
        edits, consequences: draft.consequences, instances: draft.instances, placements: draft.placements,
        bindings: draft.bindings, composition: draft.composition, structure: draft.structure,
      }));
      if (!/^[a-f0-9]{64}$/.test(previewDigest) || previewDigest.length !== 64) return unavailable();
      if (!matchesBase(await this.dependencies.systems.readRecord(workspaceId, systemId))) return stale();
      if (!await authorize()) return forbidden();
      if (operation === "systems.preview-edits") return systemBuilderSuccess({
        kind: "preview", previewDigest, validation: validation.status,
        removedInstanceIds: draft.consequences.removedIds, removedBindingIds: draft.consequences.disconnectedIds,
      });
      if (input.previewDigest !== previewDigest) return invalid();
      const saved = await this.dependencies.saveRevision.executeStrict({
        workspaceId, systemId, actorId, expectedRecordRevision: baseRecordRevision,
        composition: draft.composition, instances: draft.instances, placements: draft.placements,
        bindings: draft.bindings, structure: draft.structure,
      }, { baseRevisionId, authorizeCommit: authorize });
      if (!saved.ok) return saved.error.code === "system-builder.forbidden" ? forbidden()
        : saved.error.code === "system-builder.invalid-headless-revision" ? invalid() : stale();
      if (!await authorize()) return forbidden();
      return systemBuilderSuccess({
        kind: "applied", revisionId: saved.value.revisionId, recordRevision: baseRecordRevision + 1,
      });
    } catch {
      return unavailable();
    }
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const entries = Object.entries(item as Record<string, unknown>);
    return Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
}
