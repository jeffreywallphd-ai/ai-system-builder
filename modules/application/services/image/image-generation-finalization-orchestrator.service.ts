import { isWorkspaceId } from "../../../contracts/workspace";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { FinalizeImageGenerationService } from "./finalize-image-generation.service";

export class ImageGenerationFinalizationOrchestratorService {
  private readonly finalizedRequests = new Map<string, Array<{ assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated" }>>();

  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      finalizeImageGenerationService: FinalizeImageGenerationService;
      organizationContextProvider?: OrganizationRequestContextProviderPort;
    },
  ) {}

  public async finalizeIfCompleted(requestId: string, workspaceId: string | undefined): Promise<{ finalized: boolean; assets?: Array<{ assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated" }>; reason?: string }> {
    if (!isWorkspaceId(workspaceId)) return { finalized: false, reason: "workspace id is required" };
    const cacheKey = this.createCacheKey(requestId, workspaceId);
    const finalizedAssets = this.finalizedRequests.get(cacheKey);
    if (finalizedAssets) return { finalized: true, assets: finalizedAssets };

    const task = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if ("recordType" in task || task.workspaceId !== workspaceId) return { finalized: false, reason: "task not found in workspace" };
    if (task.status !== "succeeded") return { finalized: false, reason: "task not completed" };

    const outputs = this.readOutputs(task.data);
    if (outputs.some((output) => this.hasArtifactId(output))) {
      const assets = outputs
        .map((output) => this.toFinalizedAssetRef(output))
        .filter((asset): asset is { assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated" } => Boolean(asset));
      if (assets.length === 0) return { finalized: false, reason: "completed task did not report artifact-backed generated image outputs" };
      this.finalizedRequests.set(cacheKey, assets);
      return { finalized: true, assets };
    }

    const result = await this.dependencies.finalizeImageGenerationService.finalizeCompletedTask(task);
    this.finalizedRequests.set(cacheKey, result.assets);
    return { finalized: true, assets: result.assets };
  }

  private createCacheKey(requestId: string, workspaceId: string): string {
    const contexts = this.dependencies.organizationContextProvider;
    if (!contexts) {
      return `${workspaceId}:${requestId}`;
    }
    const context = contexts.getCurrentOrganizationContext();
    if (!context) {
      throw new Error("Organization request context is required for image finalization.");
    }
    return `${context.organizationId}:${workspaceId}:${requestId}`;
  }

  private readOutputs(data: unknown): Array<Record<string, unknown>> {
    if (typeof data !== "object" || data === null) return [];
    const outputs = (data as { outputs?: unknown }).outputs;
    return Array.isArray(outputs) ? outputs.filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null) : [];
  }

  private hasArtifactId(output: Record<string, unknown>): boolean {
    const artifactId = output.artifactId;
    return typeof artifactId === "string" && artifactId.length > 0;
  }

  private toFinalizedAssetRef(output: Record<string, unknown>): { assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated" } | undefined {
    const artifactId = output.artifactId;
    const storageKey = output.storageKey;
    if (typeof artifactId !== "string" || artifactId.length === 0 || typeof storageKey !== "string" || storageKey.length === 0) {
      return undefined;
    }

    return {
      assetId: typeof output.assetId === "string" && output.assetId.length > 0 ? output.assetId : artifactId,
      artifactId,
      storageKey,
      mediaType: typeof output.mediaType === "string" && output.mediaType.length > 0 ? output.mediaType : "image/png",
      source: "generated",
    };
  }
}
