import { isWorkspaceId } from "../../../contracts/workspace";
import { createRuntimeCapabilityStatus } from "../../../contracts/runtime";
import type { PublishModelRequest, PublishModelResult } from "../../../contracts/model";
import type { ModelRegistryPort } from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import { RuntimeCapabilityUnavailableError, type RuntimeCapabilityGuardService } from "../../services/runtime";

function unsupported(): RuntimeCapabilityUnavailableError {
  return new RuntimeCapabilityUnavailableError(createRuntimeCapabilityStatus({ capabilityId: "model-publishing", status: "unavailable", summary: "Model publishing runtime execution is not implemented on this host.", reason: { code: "runtime.model-publishing.not-implemented", message: "Standalone model publishing is unavailable.", category: "unavailable", retryable: false }, recommendedActions: ["configure"] }));
}

/** Keep the typed operation unavailable until an actual publishing worker exists. */
export class PublishModelUseCase {
  constructor(_dependencies: { modelRegistry: ModelRegistryPort; runtimeTaskRegistry: RuntimeTaskRegistryPort; runtimeCapabilityGuard?: Pick<RuntimeCapabilityGuardService, "requireCapabilityReady"> }) {}
  public async execute(request: PublishModelRequest): Promise<PublishModelResult> {
    if (!isWorkspaceId(request.workspaceId)) throw new Error("Workspace id is required for model publishing.");
    throw unsupported();
  }
  public async read(_requestId: string): Promise<PublishModelResult> { throw unsupported(); }
}
