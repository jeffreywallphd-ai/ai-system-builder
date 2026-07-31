import {
  RuntimeReadinessService,
  createComfyUiRuntimeCapabilityStatusProvider,
  createCompositeRuntimeCapabilityStatusProvider,
  createDerivedRuntimeCapabilityStatusProvider,
  createPythonRuntimeCapabilityStatusProvider,
  createRuntimeInstallerCapabilityStatusProvider,
  type RuntimeCapabilityStatusProvider,
} from "../../../application/services/runtime/runtime-readiness.service";
import { createRuntimeCapabilityStatus, type RuntimeCapabilityId } from "../../../contracts/runtime";
import type { RuntimeInstallStatus } from "../../../contracts/runtime-installer";

const SERVER_RUNTIME_READINESS_CAPABILITY_IDS = [
  "python-runtime",
  "comfyui-runtime",
  "image-generation",
  "dataset-preparation",
  "model-training",
  "model-validation",
  "model-publishing",
] as const satisfies readonly RuntimeCapabilityId[];

export interface CreateServerRuntimeReadinessServiceOptions {
  pythonSupervisor: {
    getStatus(): "stopped" | "starting" | "ready" | "failed";
  };
  readComfyUiSupervisor: () => {
    getStatus(): "stopped" | "starting" | "ready" | "unhealthy";
  } | undefined;
  readComfyUiInstallStatus?: () => RuntimeInstallStatus | Promise<RuntimeInstallStatus>;
  now?: () => string;
}

function createMissingComfyUiSupervisorStatusProvider(
  options: { readSupervisor: CreateServerRuntimeReadinessServiceOptions["readComfyUiSupervisor"]; now?: () => string },
): RuntimeCapabilityStatusProvider {
  return {
    capabilityId: "comfyui-runtime",
    getStatus() {
      const supervisor = options.readSupervisor();
      if (supervisor) {
        return createComfyUiRuntimeCapabilityStatusProvider({
          readState: () => supervisor.getStatus(),
          now: options.now,
        }).getStatus();
      }

      return createRuntimeCapabilityStatus({
        capabilityId: "comfyui-runtime",
        status: "unknown",
        summary: "ComfyUI runtime supervisor has not been created on this server host.",
        reason: {
          code: "runtime.comfyui.supervisor-missing",
          message: "ComfyUI runtime supervisor has not been created on this server host.",
          category: "unavailable",
          retryable: false,
        },
        recommendedActions: ["start"],
        updatedAt: options.now?.() ?? new Date().toISOString(),
      });
    },
  };
}

function createUnavailableModelPublishingStatusProvider(options: { now?: () => string }): RuntimeCapabilityStatusProvider {
  return {
    capabilityId: "model-publishing",
    getStatus() {
      return createRuntimeCapabilityStatus({
        capabilityId: "model-publishing",
        status: "unavailable",
        summary: "Model publishing runtime execution is not implemented on this server host.",
        reason: {
          code: "runtime.model-publishing.not-implemented",
          message: "Model publishing readiness is explicit but unavailable until a runtime task implementation is composed.",
          category: "unavailable",
          retryable: false,
        },
        recommendedActions: ["configure"],
        updatedAt: options.now?.() ?? new Date().toISOString(),
      });
    },
  };
}

export function createServerRuntimeReadinessService(
  options: CreateServerRuntimeReadinessServiceOptions,
): RuntimeReadinessService {
  let service: RuntimeReadinessService;
  const pythonProvider = createPythonRuntimeCapabilityStatusProvider({
    readState: () => options.pythonSupervisor.getStatus(),
    now: options.now,
  });
  const comfyUiSignals: RuntimeCapabilityStatusProvider[] = [
    createMissingComfyUiSupervisorStatusProvider({
      readSupervisor: options.readComfyUiSupervisor,
      now: options.now,
    }),
  ];

  if (options.readComfyUiInstallStatus) {
    comfyUiSignals.unshift(createRuntimeInstallerCapabilityStatusProvider({
      capabilityId: "comfyui-runtime",
      targetId: "comfyui",
      readStatus: options.readComfyUiInstallStatus,
      now: options.now,
    }));
  }

  const comfyUiProvider = createCompositeRuntimeCapabilityStatusProvider({
    capabilityId: "comfyui-runtime",
    providers: comfyUiSignals,
    now: options.now,
  });
  const derivedFromPython = (capabilityId: RuntimeCapabilityId) => createDerivedRuntimeCapabilityStatusProvider({
    capabilityId,
    dependencies: ["python-runtime"],
    readDependencyStatus: (dependencyId) => service.getCapabilityStatus(dependencyId),
    now: options.now,
  });

  service = new RuntimeReadinessService({
    capabilityIds: SERVER_RUNTIME_READINESS_CAPABILITY_IDS,
    providers: [
      pythonProvider,
      comfyUiProvider,
      createDerivedRuntimeCapabilityStatusProvider({
        capabilityId: "image-generation",
        dependencies: ["comfyui-runtime"],
        readDependencyStatus: (dependencyId) => service.getCapabilityStatus(dependencyId),
        now: options.now,
      }),
      derivedFromPython("dataset-preparation"),
      derivedFromPython("model-training"),
      derivedFromPython("model-validation"),
      createUnavailableModelPublishingStatusProvider({ now: options.now }),
    ],
    now: options.now,
  });

  return service;
}
