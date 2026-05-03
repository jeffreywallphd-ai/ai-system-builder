import type { ImageGenerationOutput } from "../../../contracts/image-generation";

export interface ImageBinaryRetrievalPort {
  getImageBinary(output: ImageGenerationOutput): Promise<Uint8Array>;
}
