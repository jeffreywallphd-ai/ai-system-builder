import type { RuntimeTaskRegistryPort } from "../../../application/ports/runtime";
import { createRuntimeTaskRegistryRouter } from "../../../adapters/runtime/createRuntimeTaskRegistryRouter";

export interface CreateDesktopRuntimeTaskRegistryOptions {
  pythonRuntimeTaskRegistry: RuntimeTaskRegistryPort;
  imageRuntimeTaskRegistry: RuntimeTaskRegistryPort;
}

export function createDesktopRuntimeTaskRegistry(
  options: CreateDesktopRuntimeTaskRegistryOptions,
): RuntimeTaskRegistryPort {
  return createRuntimeTaskRegistryRouter({
    python: options.pythonRuntimeTaskRegistry,
    image: options.imageRuntimeTaskRegistry,
  });
}
