import type { ImageGenerationOutput } from "../../../contracts/image-generation";
import type { RuntimeTaskRecord } from "../../../contracts/runtime";
import type { ImageAssetRegistryPort, GeneratedImagePersistencePort } from "../../ports/image";

interface FinalizedAssetRef { assetId: string; artifactId: string; }

export class FinalizeImageGenerationService {
  private readonly finalizedByRequestId = new Map<string, FinalizedAssetRef[]>();

  public constructor(private readonly dependencies: { imageAssetRegistry: ImageAssetRegistryPort; generatedImagePersistence: GeneratedImagePersistencePort; createAssetId?: () => string; now?: () => string; }) {}

  public async finalizeCompletedTask(task: RuntimeTaskRecord): Promise<{ assets: FinalizedAssetRef[] }> {
    const existing = this.finalizedByRequestId.get(task.requestId);
    if (existing) return { assets: existing };
    if (task.status !== "succeeded") throw new Error("Image generation finalization requires a succeeded runtime task.");

    const outputs = this.getOutputs(task.data);
    const assets: FinalizedAssetRef[] = [];
    for (const output of outputs) {
      const assetId = this.dependencies.createAssetId?.() ?? `generated-${task.requestId}-${assets.length + 1}`;
      const persisted = await this.dependencies.generatedImagePersistence.persistGeneratedImage({ output, assetId });
      await this.dependencies.imageAssetRegistry.registerImageAsset({
        assetId,
        artifactId: persisted.artifactId,
        source: "generated",
        metadata: {
          ...(this.readMetadata(task)?.request ?? {}),
          engine: output.engine,
          width: output.width,
          height: output.height,
          createdAt: this.dependencies.now?.() ?? new Date().toISOString(),
        },
      });
      assets.push({ assetId, artifactId: persisted.artifactId });
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
    return { type: "image", engine: r.engine, fileName: r.fileName, subfolder: typeof r.subfolder === "string" ? r.subfolder : undefined, promptId: typeof r.promptId === "string" ? r.promptId : undefined, width: typeof r.width === "number" ? r.width : undefined, height: typeof r.height === "number" ? r.height : undefined };
  }
}
