import type { OwnedTaskReconcilerService } from "../../../application/services/runtime/owned-task-reconciler.service";
import type { PowerSuspensionBlockerPort } from "../../../application/ports/desktop";
import {
  RuntimeCapabilityGuardService,
  TaskPowerLifecycleService,
} from "../../../application/services/runtime";
import { createElectronPowerSuspensionBlocker } from "../../../adapters/runtime/electron";
import { TaskType, type RuntimeCapabilityId } from "../../../contracts/runtime";
import { createDesktopRuntimeTaskRegistry } from "./composeDesktopRuntimeTaskRegistry";

export interface ComposeDesktopRuntimeTaskFeatureOptions {
  pythonRuntimeFoundation: any;
  taskReconciler: OwnedTaskReconcilerService;
  imageRuntimeTaskRegistry: any;
  runtimeReadiness: any;
  recordMilestone?: (milestone: string) => void;
}

function createLazyPowerSuspensionBlocker(
  recordMilestone?: (milestone: string) => void,
): PowerSuspensionBlockerPort {
  let blocker: PowerSuspensionBlockerPort | undefined;
  const getBlocker = (): PowerSuspensionBlockerPort => {
    if (!blocker) {
      recordMilestone?.("desktop.host.power-blocker.compose.before");
      blocker = createElectronPowerSuspensionBlocker();
      recordMilestone?.("desktop.host.power-blocker.compose.after");
    }
    return blocker;
  };
  return {
    startBlocker: (...args) => getBlocker().startBlocker(...args),
    stopBlocker: (...args) => getBlocker().stopBlocker(...args),
    listBlockers: (...args) => getBlocker().listBlockers(...args),
  };
}

export async function composeDesktopRuntimeTaskFeature(
  options: ComposeDesktopRuntimeTaskFeatureOptions,
): Promise<any> {
  const { createPythonRuntimeTaskRegistryAdapter } =
    await import("../../../adapters/runtime/python");
  const powerSuspensionBlocker = createLazyPowerSuspensionBlocker(
    options.recordMilestone,
  );
  const taskPowerLifecycle = new TaskPowerLifecycleService(
    powerSuspensionBlocker,
  );
  const pythonRuntimeTaskRegistry = createPythonRuntimeTaskRegistryAdapter(
    { ...options.pythonRuntimeFoundation.runtimePort },
    {
      async ensureRuntimeReady(request, control) {
        if (
          request.taskType === TaskType.CONTEXT_GENERATION ||
          request.taskType === TaskType.CONTEXT_RETRIEVAL
        ) {
          await options.pythonRuntimeFoundation.prepareContextEnvironment?.(
            (progress: { readonly message: string }) =>
              control.reportProgress({ message: progress.message }),
          );
        }
        await options.pythonRuntimeFoundation.supervisor.start();
        if (request.taskType === TaskType.MODEL_TRAINING) {
          options.pythonRuntimeFoundation.prepareModelTrainingEnvironment?.();
        }
      },
    },
  );
  const routedRegistry = createDesktopRuntimeTaskRegistry({
    pythonRuntimeTaskRegistry,
    imageRuntimeTaskRegistry: options.imageRuntimeTaskRegistry,
  });
  const runtimeTaskRegistry = { ...routedRegistry, startTask: (request: Parameters<typeof routedRegistry.startTask>[0]) => { options.taskReconciler.assertAccepting(); return routedRegistry.startTask(request); } };
  const runtimeCapabilityGuard = new RuntimeCapabilityGuardService(
    options.runtimeReadiness,
    {
      async prepareCapability(capabilityId) {
        if (PYTHON_RUNTIME_CAPABILITIES.has(capabilityId)) {
          await options.pythonRuntimeFoundation.supervisor.start();
        }
      },
    },
  );
  return {
    taskReconciler: options.taskReconciler,
    runtimeTaskRegistry,
    modelDownloadCompletionPort: pythonRuntimeTaskRegistry,
    runtimeCapabilityGuard,
    taskPowerLifecycle,
    powerSuspensionBlocker,
  };
}

const PYTHON_RUNTIME_CAPABILITIES = new Set<RuntimeCapabilityId>([
  "python-runtime",
  "dataset-preparation",
  "model-training",
  "model-validation",
]);
