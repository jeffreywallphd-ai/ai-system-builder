import type { ImageGenerationOutput } from "../../../contracts/image-generation";
import { isWorkspaceId } from "../../../contracts/workspace";
import { createHash } from "node:crypto";
import { TaskType, type RuntimeTaskRecord } from "../../../contracts/runtime";
import type { OrganizationRequestContextProviderPort } from "../../ports/organization";
import type { PersistGeneratedImageResult } from "../../ports/image/generated-image-persistence.port";
import type { ImageAssetRegistryPort, GeneratedImagePersistencePort } from "../../ports/image";

interface FinalizedAssetRef { assetId: string; artifactId: string; storageKey: string; mediaType: string; source: "generated"; }

export class FinalizeImageGenerationService {
  // Receipts are never evicted into a replayable state. A full host refuses new
  // finalizations; durable crash recovery requires a separate storage protocol.
  private readonly receipts = new Map<string, { signature: string; outputs: Array<{ assetId: string; persisted?: PersistGeneratedImageResult; asset?: FinalizedAssetRef }> }>();
  private readonly inFlight = new Map<string, Promise<{ assets: FinalizedAssetRef[] }>>();

  public constructor(private readonly dependencies: { imageAssetRegistry: ImageAssetRegistryPort; generatedImagePersistence: GeneratedImagePersistencePort; createAssetId?: () => string; now?: () => string; organizationContextProvider?: OrganizationRequestContextProviderPort; }) {}

  public async finalizeCompletedTask(task: RuntimeTaskRecord): Promise<{ assets: FinalizedAssetRef[] }> {
    if (!isWorkspaceId(task.workspaceId)) throw new Error("Image generation finalization requires a workspace-owned runtime task.");
    if (task.status !== "succeeded" || task.taskType !== TaskType.IMAGE_GENERATION) throw new Error("Image generation finalization requires a succeeded runtime task.");
    if (typeof task.requestId !== "string" || !task.requestId.trim() || task.requestId.length > 256) throw new Error("Image generation request identity is invalid.");
    const context = this.dependencies.organizationContextProvider?.getCurrentOrganizationContext();
    if (this.dependencies.organizationContextProvider && !context) throw new Error("Organization request context is required for image finalization.");
    const key = JSON.stringify([context?.organizationId ?? null, task.workspaceId, task.requestId]);
    const outputs = this.getOutputs(task.data);
    if (outputs.length === 0 || outputs.length > 8) throw new Error("Image generation finalization requires at least one generated image output and at most eight.");
    const signature = createHash("sha256").update(JSON.stringify(outputs)).digest("hex");
    let receipt = this.receipts.get(key);
    if (receipt && receipt.signature !== signature) throw new Error("Image generation completion changed after finalization began.");
    if (!receipt) {
      if (this.receipts.size >= 1024) throw new Error("Image generation finalization capacity is unavailable.");
      const scopedIdentity = createHash("sha256").update(key).digest("hex");
      receipt = { signature, outputs: outputs.map((_, index) => ({ assetId: this.dependencies.createAssetId?.() ?? `img-${scopedIdentity}-${index + 1}` })) };
      this.receipts.set(key, receipt);
    }
    const existing = this.inFlight.get(key);
    if (existing) return this.copyResult(await existing);
    const currentReceipt = receipt;
    const operation = (async () => {
      for (const [index, output] of outputs.entries()) {
        const progress = currentReceipt.outputs[index]!;
        if (progress.asset) continue;
        // Save persistence success BEFORE asset registration. A registration
        // retry must not recopy a consumed runtime output or reserve another file.
        progress.persisted ??= await this.dependencies.generatedImagePersistence.persistGeneratedImage({ workspaceId: task.workspaceId!, output, requestId: task.requestId });
        const persisted = progress.persisted;
        const registered = await this.dependencies.imageAssetRegistry.registerImageAsset({
          workspaceId: task.workspaceId!, assetId: progress.assetId,
          artifactId: persisted.artifactId, source: "generated",
          metadata: { ...(this.readMetadata(task)?.request ?? {}), engine: output.engine, requestId: task.requestId, originalFileName: persisted.originalFileName, createdAt: this.dependencies.now?.() ?? new Date().toISOString() },
        });
        progress.asset = { assetId: registered.assetId, artifactId: persisted.artifactId, storageKey: persisted.storageKey, mediaType: persisted.mediaType, source: "generated" };
      }
      return { assets: currentReceipt.outputs.map((output) => output.asset!) };
    })();
    this.inFlight.set(key, operation);
    try { return this.copyResult(await operation); }
    finally { this.inFlight.delete(key); }
  }

  private copyResult(result: { assets: FinalizedAssetRef[] }): { assets: FinalizedAssetRef[] } {
    return { assets: result.assets.map((asset) => ({ ...asset })) };
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
