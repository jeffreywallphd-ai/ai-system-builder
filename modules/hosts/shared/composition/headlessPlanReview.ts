import { createStructuredSystemBuilderRepository } from "../../../adapters/persistence/system-builder";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { HeadlessPlanReviewSnapshotResult } from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type { HeadlessPlanReviewAgentResult, HeadlessSystemManagementRequest } from "../../../contracts/headless";
import type { WorkspaceId } from "../../../contracts/workspace";

/** The owning plan transaction calls this only for a new proposal. */
export async function validateHeadlessPlanSavedSources(
  documents: StructuredDocumentStore, workspaceId: WorkspaceId,
  requests: readonly HeadlessSystemManagementRequest[], isCurrent: () => boolean,
): Promise<true | false | "stale"> {
  const systems = createStructuredSystemBuilderRepository(documents);
  for (const { operation, input } of requests) {
    if (!isCurrent() || input.workspaceId !== workspaceId) return false;
    if (operation === "systems.create") continue;
    const record = await systems.readRecord(workspaceId, input.systemId);
    if (!isCurrent()) return false;
    if (!record || record.targetWorkspaceId !== workspaceId || record.systemId !== input.systemId ||
        record.status === "archived" || record.revision !== input.baseRecordRevision ||
        record.currentRevisionId !== input.baseRevisionId) return "stale";
    const revision = await systems.readRevision(workspaceId, input.systemId, input.baseRevisionId);
    if (!isCurrent()) return false;
    if (!revision || revision.targetWorkspaceId !== workspaceId || revision.systemId !== input.systemId ||
        revision.revisionId !== input.baseRevisionId ||
        revision.composition.compositionId !== record.composition.compositionId) return "stale";
  }
  return isCurrent();
}

export function projectHeadlessPlanReview(result: HeadlessPlanReviewSnapshotResult, fingerprint: string): HeadlessPlanReviewAgentResult {
  if (!result.ok) {
    switch (result.code) {
      case "forbidden": return { ok: false, code: "headless.forbidden" };
      case "invalid": return { ok: false, code: "headless.invalid-request" };
      case "expired": return { ok: false, code: "headless.plan-expired" };
      case "stale": return { ok: false, code: "headless.stale" };
      case "capacity": return { ok: false, code: "headless.operation-capacity" };
      default: return { ok: false, code: "headless.unavailable" };
    }
  }
  const { revision, stepCount, expiresAt, status, approvedSteps, mode } = result.snapshot.state;
  return { ok: true, value: { fingerprint, revision, stepCount, expiresAt, status, approvedSteps,
    ...(mode === undefined ? {} : { mode }) } };
}
