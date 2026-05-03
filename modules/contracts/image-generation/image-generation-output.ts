export interface ImageGenerationOutput {
  type: "image";
  engine: string;
  fileName: string;
  subfolder?: string;
  promptId?: string;
  width?: number;
  height?: number;
}
