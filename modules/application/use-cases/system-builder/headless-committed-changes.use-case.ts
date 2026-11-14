import type { HeadlessOperationScope, HeadlessOperationStorePort, SystemBuilderRepositoryPort } from "../../ports/system-builder";
import { isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "../../../contracts/headless";
import { isOrganizationId, type OrganizationId } from "../../../contracts/organization";
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../contracts/shared";
import {
  isSystemBuilderStatus, isSystemBuilderSystemId, normalizeSystemBuilderRevisionId, systemBuilderFailure,
  systemBuilderSuccess, type SystemBuilderRecord,
} from "../../../contracts/system-builder";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";

const MAX_SYSTEMS = 128;
type SavedSystemSummary = Pick<SystemBuilderRecord, "systemId" | "revision" | "currentRevisionId" | "status" | "targetWorkspaceId">;
const unavailable = () => systemBuilderFailure("headless.unavailable", "The change feed is unavailable.");
const forbidden = () => systemBuilderFailure("headless.forbidden", "Workspace access is unavailable.");
const snapshotTooLarge = () => systemBuilderFailure("headless.result-too-large", "Too many systems to read in one snapshot.");
type Scope = Pick<HeadlessOperationScope, "organizationId" | "workspaceId">;
type Cursor = { readonly hostIncarnationId: HeadlessHostIncarnationId; readonly sequence: number; readonly scopeTag: string };
type TrustedReader = {
  readonly organizationId: OrganizationId;
  readonly scopeId: string;
  readonly canRead: (workspaceId: WorkspaceId) => Promise<boolean>;
};

/** A pull feed for saved state; it carries no draft, private data, focus or window instructions. */
export class HeadlessCommittedChangesUseCase {
  public constructor(private readonly dependencies: {
    readonly organizationId: OrganizationId;
    readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly systems: { readonly listRecords: (
      ...input: Parameters<SystemBuilderRepositoryPort["listRecords"]>
    ) => Promise<readonly SavedSystemSummary[]> };
    readonly feed: Pick<HeadlessOperationStorePort, "watermark" | "readChanges">;
    readonly access: WorkspaceAssetAccessPort;
    /** Bind the caller, workspace and host with a private host key. */
    readonly digest: (canonicalCursor: string) => string;
  }) {}

  public async snapshot(workspaceId: WorkspaceId, identity: TrustedReader) {
    const access = this.access(workspaceId, identity);
    if (!access || !await access.authorize()) return forbidden();
    try {
      // Read the watermark first. Writes racing the snapshot may appear twice,
      // but their committed notification cannot be lost behind the cursor.
      const sequence = await this.dependencies.feed.watermark(access.scope);
      const records = await this.dependencies.systems.listRecords(workspaceId, false);
      if (!await access.authorize()) return forbidden();
      if (records.length > MAX_SYSTEMS) return snapshotTooLarge();
      if (records.some((record) => record.targetWorkspaceId !== workspaceId || record.status === "archived")) return unavailable();
      return systemBuilderSuccess({
        systems: records.map(project), cursor: access.issue(sequence),
      });
    } catch { return unavailable(); }
  }

  public async changes(workspaceId: WorkspaceId, cursor: unknown, identity: TrustedReader) {
    const access = this.access(workspaceId, identity);
    if (!access || !await access.authorize()) return forbidden();
    try {
      const current = readCursor(cursor);
      if (!current || current.hostIncarnationId !== this.dependencies.hostIncarnationId ||
          current.scopeTag !== access.issue(current.sequence).scopeTag) {
        return systemBuilderSuccess({ kind: "resync" as const });
      }
      const result = await this.dependencies.feed.readChanges(access.scope, current.sequence);
      if (!await access.authorize()) return forbidden();
      if (result.kind === "resync") return systemBuilderSuccess({ kind: "resync" as const });
      if (!Number.isSafeInteger(result.watermark) || result.watermark < current.sequence || result.events.length > 64 ||
          result.events.some(({ sequence }, index) => sequence !== current.sequence + index + 1)) return unavailable();
      const next = result.events[result.events.length - 1]?.sequence ?? current.sequence;
      if (next > result.watermark || (next === current.sequence && next < result.watermark)) return unavailable();
      return systemBuilderSuccess({
        kind: "changes" as const, events: result.events.map(projectEvent),
        cursor: access.issue(next),
        more: next < result.watermark,
      });
    } catch { return unavailable(); }
  }

  private access(workspaceId: WorkspaceId, identity: TrustedReader) {
    const { organizationId, scopeId, canRead } = identity;
    const { hostIncarnationId } = this.dependencies;
    if (!isWorkspaceId(workspaceId) || !isOrganizationId(organizationId) ||
        organizationId !== this.dependencies.organizationId || typeof scopeId !== "string" ||
        scopeId.length < 1 || scopeId.length > 256 || /[\u0000-\u001f\u007f]/.test(scopeId) ||
        !isHeadlessHostIncarnationId(hostIncarnationId)) return undefined;
    const scope = { organizationId, workspaceId } satisfies Scope;
    const issue = (sequence: number): Cursor => {
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("The feed sequence is invalid.");
      const scopeTag = this.dependencies.digest(JSON.stringify([hostIncarnationId, organizationId, workspaceId, scopeId, sequence]));
      if (!/^[a-f0-9]{64}$/.test(scopeTag) || scopeTag.length !== 64) throw new Error("The feed cursor is unavailable.");
      return { hostIncarnationId, scopeTag, sequence };
    };
    return { scope, issue, authorize: async () => {
      try {
        if (!await canRead(workspaceId)) return false;
        await this.dependencies.access.authorize(workspaceId, "systems.changes", "asset:read");
        return await canRead(workspaceId);
      } catch { return false; }
    } };
  }
}

function readCursor(value: unknown): Cursor | undefined {
  try {
    const { hostIncarnationId, scopeTag, sequence } = readStrictPassiveRecord(value, ["hostIncarnationId", "scopeTag", "sequence"]);
    return isHeadlessHostIncarnationId(hostIncarnationId) && typeof scopeTag === "string" &&
      scopeTag.length === 64 && /^[a-f0-9]{64}$/.test(scopeTag) && typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence >= 0
      ? { hostIncarnationId, sequence, scopeTag } : undefined;
  } catch { return undefined; }
}

function project({ systemId, revision, currentRevisionId, status }: SavedSystemSummary) {
  if (!isSystemBuilderSystemId(systemId) || hasKnownPassiveCredential(systemId) ||
      !Number.isSafeInteger(revision) || revision < 1 || !isSystemBuilderStatus(status) ||
      (currentRevisionId !== undefined && !safeRevision(currentRevisionId))) throw new Error("The system summary is invalid.");
  return { systemId, recordRevision: revision, revisionId: currentRevisionId ?? null, status };
}

function projectEvent({ systemId, recordRevision, revisionId, sequence }: import("../../ports/system-builder").CommittedSystemChange) {
  if (!isSystemBuilderSystemId(systemId) || hasKnownPassiveCredential(systemId) ||
      (revisionId !== null && !safeRevision(revisionId)) ||
      !Number.isSafeInteger(recordRevision) || recordRevision < 1 || !Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error("The saved event is invalid.");
  return { systemId, recordRevision, revisionId, sequence };
}

function safeRevision(value: string) {
  return typeof value === "string" && normalizeSystemBuilderRevisionId(value) === value && !hasKnownPassiveCredential(value);
}
