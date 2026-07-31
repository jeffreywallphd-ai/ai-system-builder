import type { ImageAsset } from "../../../contracts/image";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface RegisterImageAssetInput {
  workspaceId: WorkspaceId;
  assetId?: string;
  artifactId: string;
  source: "generated" | "uploaded";
  metadata?: {
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    model?: string;
    engine?: string;
    workflowTemplateId?: string;
    width?: number;
    height?: number;
    createdAt?: string;
    requestId?: string;
    originalFileName?: string;
  };
}

export interface ImageAssetRegistryPort {
  registerImageAsset(input: RegisterImageAssetInput): Promise<{ assetId: string }>;
  getImageAsset(workspaceId: WorkspaceId, assetId: string): Promise<ImageAsset | null>;
}
