import type { RuntimeReadinessPort } from "../../../application/ports/runtime";
import {
  RuntimeReadinessService,
  createComfyUiRuntimeCapabilityStatusProvider,
  createCompositeRuntimeCapabilityStatusProvider,
  createDerivedRuntimeCapabilityStatusProvider,
  createPythonRuntimeCapabilityStatusProvider,
  createRuntimeInstallerCapabilityStatusProvider,
  type ComfyUiRuntimeLifecycleState,
  type RuntimeCapabilityStatusProvider,
} from "../../../application/services/runtime";
import {
  RUNTIME_CAPABILITY_IDS,
  createRuntimeCapabilityStatus,
  type RuntimeCapabilityId,
  type RuntimeCapabilityStatus,
} from "../../../contracts/runtime";

function createMissingComfyUiSupervisorProvider(now: () => string): RuntimeCapabilityStatusProvider {
  return {
    capabilityId: "comfyui-runtime",
    getStatus() {
      return createRuntimeCapabilityStatus({
        capabilityId: "comfyui-runtime",
        status: "unknown",
        summary: "ComfyUI runtime supervisor has not been initialized on this desktop host.",
        reason: {
          code: "runtime.comfyui.supervisor-uninitialized",
          message: "ComfyUI runtime readiness is unknown because the supervisor has not been initialized without starting the runtime.",
          category: "unknown",
          retryable: false,
        },
        recommendedActions: ["configure"],
        updatedAt: now(),
      });
    },
  };
}

function createUnavailableModelPublishingProvider(now: () => string): RuntimeCapabilityStatusProvider {
  return {
    capabilityId: "model-publishing",
    getStatus() {
      return createRuntimeCapabilityStatus({
        capabilityId: "model-publishing",
        status: "unavailable",
        summary: "Model publishing runtime execution is not implemented on this desktop host.",
        reason: {
          code: "runtime.model-publishing.not-implemented",
          message: "Model publishing readiness is explicit but unavailable until a runtime task implementation is composed.",
          category: "unavailable",
          retryable: false,
        },
        recommendedActions: ["configure"],
        updatedAt: now(),
      });
    },
  };
}

export interface CreateDesktopRuntimeReadinessServiceOptions {
  readPythonSupervisorState: () => "stopped" | "starting" | "ready" | "failed";
  readComfyUiLifecycleState: () => ComfyUiRuntimeLifecycleState | "uninitialized" | Promise<ComfyUiRuntimeLifecycleState | "uninitialized">;
  readComfyUiInstallStatus: () => Promise<"not-installed" | "installing" | "checking" | "installed" | "update-available" | "failed" | "unknown">;
  now?: () => string;
}

export function createDesktopRuntimeReadinessService(
  options: CreateDesktopRuntimeReadinessServiceOptions,
): RuntimeReadinessPort {
  const now = options.now ?? (() => new Date().toISOString());
  const providersByCapabilityId = new Map<RuntimeCapabilityId, RuntimeCapabilityStatusProvider>();
  const setProvider = (provider: RuntimeCapabilityStatusProvider) => {
    providersByCapabilityId.set(provider.capabilityId, provider);
    return provider;
  };

  const pythonProvider = setProvider(createPythonRuntimeCapabilityStatusProvider({
    readState: options.readPythonSupervisorState,
    now,
  }));

  const comfyUiSupervisorProvider: RuntimeCapabilityStatusProvider = {
    capabilityId: "comfyui-runtime",
    async getStatus() {
      const state = await options.readComfyUiLifecycleState();
      if (state === "uninitialized") {
        return createMissingComfyUiSupervisorProvider(now).getStatus();
      }

      return createComfyUiRuntimeCapabilityStatusProvider({
        readState: () => state,
        now,
      }).getStatus();
    },
  };

  const comfyUiProvider = setProvider(createCompositeRuntimeCapabilityStatusProvider({
    capabilityId: "comfyui-runtime",
    providers: [
      createRuntimeInstallerCapabilityStatusProvider({
        capabilityId: "comfyui-runtime",
        targetId: "comfyui",
        readStatus: options.readComfyUiInstallStatus,
        now,
      }),
      comfyUiSupervisorProvider,
    ],
    now,
  }));

  const readDependencyStatus = async (capabilityId: RuntimeCapabilityId): Promise<RuntimeCapabilityStatus> => {
    const provider = providersByCapabilityId.get(capabilityId);
    if (!provider) {
      return createRuntimeCapabilityStatus({
        capabilityId,
        status: "unknown",
        summary: `No desktop runtime readiness provider is composed for ${capabilityId}.`,
        reason: {
          code: "runtime.readiness.provider-missing",
          message: `No desktop runtime readiness provider is composed for ${capabilityId}.`,
          category: "unknown",
          retryable: false,
        },
        recommendedActions: ["configure"],
        updatedAt: now(),
      });
    }

    return provider.getStatus();
  };

  const derivedProviders = [
    createDerivedRuntimeCapabilityStatusProvider({
      capabilityId: "image-generation",
      dependencies: [comfyUiProvider.capabilityId],
      readDependencyStatus,
      now,
    }),
    createDerivedRuntimeCapabilityStatusProvider({
      capabilityId: "dataset-preparation",
      dependencies: [pythonProvider.capabilityId],
      readDependencyStatus,
      now,
    }),
    createDerivedRuntimeCapabilityStatusProvider({
      capabilityId: "model-training",
      dependencies: [pythonProvider.capabilityId],
      readDependencyStatus,
      now,
    }),
    createDerivedRuntimeCapabilityStatusProvider({
      capabilityId: "model-validation",
      dependencies: [pythonProvider.capabilityId],
      readDependencyStatus,
      now,
    }),
    createUnavailableModelPublishingProvider(now),
  ];

  for (const provider of derivedProviders) {
    setProvider(provider);
  }

  return new RuntimeReadinessService({
    providers: Array.from(providersByCapabilityId.values()),
    capabilityIds: RUNTIME_CAPABILITY_IDS,
    now,
  });
}
