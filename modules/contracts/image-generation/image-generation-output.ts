export interface ImageGenerationOutput {
  type: "image";
  engine: string;
  fileName: string;
  subfolder?: string;
  contentBase64?: string;
  mediaType?: string;
  promptId?: string;
  width?: number;
  height?: number;
}
