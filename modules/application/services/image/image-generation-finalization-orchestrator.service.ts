import { isWorkspaceId } from "../../../contracts/workspace";
import type { ImageGenerationTaskAuthorityService } from "./image-generation-task-authority.service";
import { createHash } from "node:crypto";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { FinalizeImageGenerationService } from "./finalize-image-generation.service";

export class ImageGenerationFinalizationOrchestratorService {
  private readonly inFlight = new Map<string, Promise<Awaited<ReturnType<ImageGenerationFinalizationOrchestratorService["finalizeOwnedTask"]>>>>();
  private readonly completions = new Map<string, { signature: string; assets?: Array<{ assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated" }> }>();

  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      taskAuthority: Pick<ImageGenerationTaskAuthorityService, "assertOwned">;
      finalizeImageGenerationService: FinalizeImageGenerationService;
      organizationContextProvider?: OrganizationRequestContextProviderPort;
    },
  ) {}

  public async finalizeIfCompleted(requestId: string, workspaceId: string | undefined): Promise<{ finalized: boolean; assets?: Array<{ assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated" }>; reason?: string }> {
    if (!isWorkspaceId(workspaceId)) return { finalized: false, reason: "workspace id is required" };
    await this.dependencies.taskAuthority.assertOwned(requestId, workspaceId, "write");
    const cacheKey = this.createCacheKey(requestId, workspaceId);
    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;
    if (this.inFlight.size >= 256) return { finalized: false, reason: "image finalization is busy" };
    const operation = this.finalizeOwnedTask(requestId, workspaceId, cacheKey);
    this.inFlight.set(cacheKey, operation);
    try { return await operation; }
    finally { this.inFlight.delete(cacheKey); }
  }

  private async finalizeOwnedTask(requestId: string, workspaceId: string, cacheKey: string): Promise<{ finalized: boolean; assets?: Array<{ assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated" }>; reason?: string }> {
    const task = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if ("recordType" in task || task.requestId !== requestId || task.workspaceId !== workspaceId) return { finalized: false, reason: "task not found in workspace" };
    if (task.taskType !== "image-generation" || task.status !== "succeeded") return { finalized: false, reason: "task not completed" };

    const outputs = this.readOutputs(task.data);
    if (!outputs || outputs.length === 0 || outputs.length > 8) return { finalized: false, reason: "completed task outputs are invalid" };
    const signature = createHash("sha256").update(JSON.stringify(outputs)).digest("hex");
    let completion = this.completions.get(cacheKey);
    if (completion && completion.signature !== signature) return { finalized: false, reason: "completed task evidence changed" };
    if (completion?.assets) return { finalized: true, assets: completion.assets.map((asset) => ({ ...asset })) };
    if (!completion) {
      if (this.completions.size >= 1024) return { finalized: false, reason: "image finalization capacity is unavailable" };
      completion = { signature }; this.completions.set(cacheKey, completion);
    }
    if (outputs.some((output) => this.hasArtifactId(output))) {
      const assets = outputs
        .map((output) => this.toFinalizedAssetRef(output))
        .filter((asset): asset is { assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated" } => Boolean(asset));
      if (assets.length !== outputs.length || assets.length === 0 || assets.length > 8) return { finalized: false, reason: "completed task did not report artifact-backed generated image outputs" };
      completion.assets = assets.map((asset) => ({ ...asset }));
      return { finalized: true, assets };
    }

    const result = await this.dependencies.finalizeImageGenerationService.finalizeCompletedTask(task);
    completion.assets = result.assets.map((asset) => ({ ...asset }));
    return { finalized: true, assets: result.assets };
  }

  private createCacheKey(requestId: string, workspaceId: string): string {
    const contexts = this.dependencies.organizationContextProvider;
    if (!contexts) {
      return JSON.stringify([null, workspaceId, requestId]);
    }
    const context = contexts.getCurrentOrganizationContext();
    if (!context) {
      throw new Error("Organization request context is required for image finalization.");
    }
    return JSON.stringify([context.organizationId, workspaceId, requestId]);
  }

  private readOutputs(data: unknown): Array<Record<string, unknown>> | undefined {
    if (typeof data !== "object" || data === null) return undefined;
    const outputs = (data as { outputs?: unknown }).outputs;
    return Array.isArray(outputs) && outputs.every((o) => typeof o === "object" && o !== null && !Array.isArray(o)) ? outputs : undefined;
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
