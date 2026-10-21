import { normalizeReadWorkspaceSummaryRequest, WORKSPACE_SUMMARY_PAGES, type ReadWorkspaceSummaryRequest, type WorkspaceSummary, type WorkspaceSummaryMetric, type WorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { WorkspaceRepository } from "../../ports/workspace";

export const WORKSPACE_SUMMARY_GROUPS = {
  systems: {scope: "asset:read", metrics: ["systemsComposed", "systemsPublished", "systemsUnpublished", "assetsUsed"]},
  models: {scope: "model:read", metrics: ["modelsInstalled", "modelsTrained"]},
  artifacts: {scope: "artifact:read", metrics: ["imagesGenerated", "artifactsUploaded", "ragDatabases", "markdownContextPacks"]},
  datasets: {scope: "artifact:read", metrics: ["datasetsCreated"]},
  assets: {scope: "asset:read", metrics: ["customAssets"]},
} as const;
export type WorkspaceSummaryGroup = keyof typeof WORKSPACE_SUMMARY_GROUPS;
export type WorkspaceSummaryProjections = Partial<Record<WorkspaceSummaryGroup, (workspaceId: WorkspaceId) => Promise<Partial<Record<WorkspaceSummaryMetric, number>>>>>;

export class ReadWorkspaceSummaryUseCase {
  public constructor(private readonly dependencies: {
    readonly workspaceRepository: Pick<WorkspaceRepository, "readWorkspace">;
    readonly authorization: WorkspaceOperationAuthorizationPort;
    readonly projections: WorkspaceSummaryProjections;
  }) {}

  public async execute(input: ReadWorkspaceSummaryRequest): Promise<WorkspaceSummary> {
    const request = normalizeReadWorkspaceSummaryRequest(input);
    const workspace = await this.dependencies.workspaceRepository.readWorkspace(request.workspaceId);
    if (!workspace || workspace.workspaceId !== request.workspaceId || workspace.status !== "active") throw new Error("Workspace summary is unavailable.");
    await this.dependencies.authorization.authorizeWorkspaceOperation({workspace, operation: "workspace.summary", requiredScopes: ["workspace:read"]});
    const requested = new Set<WorkspaceSummaryMetric>(WORKSPACE_SUMMARY_PAGES[request.page]);
    const metrics: WorkspaceSummary["metrics"] = {};
    await Promise.all((Object.entries(WORKSPACE_SUMMARY_GROUPS) as [WorkspaceSummaryGroup, typeof WORKSPACE_SUMMARY_GROUPS[WorkspaceSummaryGroup]][]).map(async ([group, policy]) => {
      const keys = policy.metrics.filter(key => requested.has(key));
      if (!keys.length) return;
      for (const key of keys) metrics[key] = {status: "unavailable"};
      try {
        await this.dependencies.authorization.authorizeWorkspaceOperation({workspace, operation: `workspace.summary.${group}`, requiredScopes: [policy.scope]});
        const values = await this.dependencies.projections[group]?.(workspace.workspaceId);
        for (const key of keys) {
          const value = values?.[key];
          if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) metrics[key] = {status: "available", value};
        }
      } catch { /* A denied/unavailable metric group must not hide independent metrics. */ }
    }));
    return {schemaVersion: "workspace-summary-v1", workspaceId: workspace.workspaceId, page: request.page, metrics};
  }
}
