import type { ImageGenerationOutput } from "../../../contracts/image-generation";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { RuntimeTaskRecord } from "../../../contracts/runtime";
import type { ImageAssetRegistryPort, GeneratedImagePersistencePort } from "../../ports/image";

interface FinalizedAssetRef { assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated"; }

export class FinalizeImageGenerationService {
  private readonly finalizedByRequestId = new Map<string, FinalizedAssetRef[]>();

  public constructor(private readonly dependencies: { imageAssetRegistry: ImageAssetRegistryPort; generatedImagePersistence: GeneratedImagePersistencePort; createAssetId?: () => string; now?: () => string; }) {}

  public async finalizeCompletedTask(task: RuntimeTaskRecord): Promise<{ assets: FinalizedAssetRef[] }> {
    const existing = this.finalizedByRequestId.get(task.requestId);
    if (existing) return { assets: existing };
    if (!isWorkspaceId(task.workspaceId)) throw new Error("Image generation finalization requires a workspace-owned runtime task.");
    if (task.status !== "succeeded") throw new Error("Image generation finalization requires a succeeded runtime task.");

    const outputs = this.getOutputs(task.data);
    if (outputs.length === 0) throw new Error("Image generation finalization requires at least one generated image output.");
    const assets: FinalizedAssetRef[] = [];
    for (const output of outputs) {
      const persisted = await this.dependencies.generatedImagePersistence.persistGeneratedImage({
        workspaceId: task.workspaceId,
        output,
        requestId: task.requestId,
      });
      const requestedAssetId = this.dependencies.createAssetId?.() ?? `img-${task.requestId}-${assets.length + 1}`;
      const registered = await this.dependencies.imageAssetRegistry.registerImageAsset({
        workspaceId: task.workspaceId,
        assetId: requestedAssetId,
        artifactId: persisted.artifactId,
        source: "generated",
        metadata: {
          ...(this.readMetadata(task)?.request ?? {}),
          engine: output.engine,
          requestId: task.requestId,
          originalFileName: persisted.originalFileName,
          createdAt: this.dependencies.now?.() ?? new Date().toISOString(),
        },
      });
      assets.push({ assetId: registered.assetId, artifactId: persisted.artifactId, storageKey: persisted.storageKey, mediaType: persisted.mediaType, source: "generated" });
    }

    this.finalizedByRequestId.set(task.requestId, assets);
    return { assets };
  }

  private readMetadata(task: RuntimeTaskRecord): { request?: Record<string, unknown> } | undefined {
    return typeof task.metadata === "object" && task.metadata !== null ? (task.metadata as { request?: Record<string, unknown> }) : undefined;
  }
  private getOutputs(data: unknown): ImageGenerationOutput[] {
    if (typeof data !== "object" || data === null || !Array.isArray((data as { outputs?: unknown[] }).outputs)) throw new Error("Image generation finalization requires task outputs.");
    return (data as { outputs: unknown[] }).outputs.map((output) => this.asOutput(output));
  }

  private asOutput(value: unknown): ImageGenerationOutput {
    if (typeof value !== "object" || value === null) throw new Error("Image generation output must be an object.");
    const r = value as Record<string, unknown>;
    if (r.type !== "image" || typeof r.engine !== "string" || typeof r.fileName !== "string") throw new Error("Image generation output contract violation.");
    return {
      type: "image",
      engine: r.engine,
      fileName: r.fileName,
      subfolder: typeof r.subfolder === "string" ? r.subfolder : undefined,
      contentBase64: typeof r.contentBase64 === "string" ? r.contentBase64 : undefined,
      mediaType: typeof r.mediaType === "string" ? r.mediaType : undefined,
      promptId: typeof r.promptId === "string" ? r.promptId : undefined,
      width: typeof r.width === "number" ? r.width : undefined,
      height: typeof r.height === "number" ? r.height : undefined,
    };
  }
}
