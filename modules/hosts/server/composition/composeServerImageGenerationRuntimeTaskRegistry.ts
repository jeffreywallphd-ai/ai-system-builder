import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime";
import { createComfyUiImageGenerationRuntimeAdapter } from "../../../adapters/runtime/comfyui";

export function createServerImageGenerationRuntimeTaskRegistry(
  options: Parameters<typeof createComfyUiImageGenerationRuntimeAdapter>[0],
): RuntimeTaskRegistryPort {
  return createComfyUiImageGenerationRuntimeAdapter(options);
}
