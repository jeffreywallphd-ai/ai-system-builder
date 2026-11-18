import type { ArtifactCatalogReadPort } from "../../../application/ports/artifact-catalog";
import type { ExecutionRunRepositoryPort } from "../../../application/ports/execution-runs";
import type { SystemBuilderRepositoryPort } from "../../../application/ports/system-builder";
import { normalizeExecutionRunId } from "../../../contracts/execution-runs";
import {isUiDataPresentationIntent, type UiPresentationDetail, type UiPresentationIntent} from "../../../contracts/headless";
import { normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId } from "../../../contracts/system-builder";
import type { WorkspaceId } from "../../../contracts/workspace";

/** Resolve only saved metadata from the already-authorized request organization and workspace. */
export function composeManagedBrowserPresentationResources(options: {
  readonly systems: Pick<SystemBuilderRepositoryPort, "readRecord" | "readRevision">;
  readonly runs: Pick<ExecutionRunRepositoryPort, "getExecutionRunById">;
  readonly artifacts: Pick<ArtifactCatalogReadPort, "readArtifactCatalogRecord">;
}) {
  return async (workspaceId: WorkspaceId, intent: UiPresentationIntent): Promise<UiPresentationDetail | undefined> => {
    // Data uses the accepted-task/actor-aware reader in the calling host.
    if (isUiDataPresentationIntent(intent)) return;
    if (intent.action === "show-run") {
      const run = await options.runs.getExecutionRunById(workspaceId, normalizeExecutionRunId(intent.runId));
      if (run?.workspaceId === workspaceId && run.id === intent.runId && run.status !== "archived")
        return {title:"Execution run", summary:`Run status: ${run.status}`};
      return;
    }
    if (intent.action === "show-artifact") {
      const result = await options.artifacts.readArtifactCatalogRecord({workspaceId, storageKey:intent.artifactId}, {workspaceId});
      if (result.ok && result.value.record.workspaceId === workspaceId && result.value.record.storageKey === intent.artifactId)
        return {title:result.value.record.originalName || "Saved artifact", summary:`Artifact type: ${result.value.record.artifactFamily}`};
      return;
    }
    const systemId = normalizeSystemBuilderSystemId(intent.systemId);
    const revision = await options.systems.readRevision(workspaceId, systemId, normalizeSystemBuilderRevisionId(intent.revisionId));
    if (revision?.targetWorkspaceId !== workspaceId || revision.systemId !== systemId || revision.revisionId !== intent.revisionId) return;
    const record = await options.systems.readRecord(workspaceId, systemId);
    if (record?.targetWorkspaceId !== workspaceId || record.systemId !== systemId || record.currentRevisionId !== revision.revisionId ||
        record.status === "archived") return;
    if (intent.action === "select-component") {
      const component = revision.instances.find(item => item.instanceId === intent.instanceId);
      return component ? {title:component.displayName ?? "Saved component", summary:`Component in revision ${revision.revisionNumber}`} : undefined;
    }
    if (intent.action === "show-validation") {
      const blocking = revision.validationIssues.filter(issue => issue.severity === "error").length;
      return {title:revision.composition.displayName, summary:`Validation: ${blocking} blocking, ${revision.validationIssues.length - blocking} for review`};
    }
    return {title:revision.composition.displayName, summary:`Saved revision ${revision.revisionNumber} · ${revision.instances.length} components`};
  };
}
