import type { PowerSuspensionBlockerPort } from "../../../application/ports/desktop";
import { RuntimeCapabilityGuardService, TaskPowerLifecycleService } from "../../../application/services/runtime";
import { createElectronPowerSuspensionBlocker } from "../../../adapters/runtime/electron";
import { createDesktopRuntimeTaskRegistry } from "./composeDesktopRuntimeTaskRegistry";

export interface ComposeDesktopRuntimeTaskFeatureOptions {
  pythonRuntimeFoundation: any;
  imageRuntimeTaskRegistry: any;
  runtimeReadiness: any;
  recordMilestone?: (milestone: string) => void;
}

function createLazyPowerSuspensionBlocker(recordMilestone?: (milestone: string) => void): PowerSuspensionBlockerPort {
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

export async function composeDesktopRuntimeTaskFeature(options: ComposeDesktopRuntimeTaskFeatureOptions): Promise<any> {
  const { createPythonRuntimeTaskRegistryAdapter } = await import("../../../adapters/runtime/python");
  const powerSuspensionBlocker = createLazyPowerSuspensionBlocker(options.recordMilestone);
  const taskPowerLifecycle = new TaskPowerLifecycleService(powerSuspensionBlocker);
  const pythonRuntimeTaskRegistry = createPythonRuntimeTaskRegistryAdapter({ ...options.pythonRuntimeFoundation.runtimePort }, {
    ensureRuntimeReady: () => options.pythonRuntimeFoundation.supervisor.start(),
  });
  const runtimeTaskRegistry = createDesktopRuntimeTaskRegistry({
    pythonRuntimeTaskRegistry,
    imageRuntimeTaskRegistry: options.imageRuntimeTaskRegistry,
  });
  const runtimeCapabilityGuard = new RuntimeCapabilityGuardService(options.runtimeReadiness);
  return { runtimeTaskRegistry, modelDownloadCompletionPort: pythonRuntimeTaskRegistry, runtimeCapabilityGuard, taskPowerLifecycle, powerSuspensionBlocker };
}
