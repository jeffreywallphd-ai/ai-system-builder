import { registerRuntimeReadinessIpc, type RegisterRuntimeReadinessIpcDependencies } from "./runtime-readiness/registerRuntimeReadinessIpc";
import { registerPythonRuntimeIpc, type PythonRuntimeControlPort } from "./python-runtime/registerPythonRuntimeIpc";
import { registerApplicationSettingsIpc } from "./settings/registerApplicationSettingsIpc";
import { registerWorkspaceIpc, type RegisterWorkspaceIpcDependencies } from "./workspace/registerWorkspaceIpc";
import { registerFeatureLifecycleDiagnosticsIpc, type FeatureLifecycleDiagnosticsPort } from "./feature-lifecycle/registerFeatureLifecycleDiagnosticsIpc";
import type { IpcMainHandlePort } from "./ipcMainHandlePort";
import { registerExecutionPlansIpc, type RegisterExecutionPlansIpcDependencies } from "./execution-plans/registerExecutionPlansIpc";

export interface RegisterDesktopStartupIpcDependencies {
  ipcMain: IpcMainHandlePort;
  pythonRuntime: PythonRuntimeControlPort;
  runtimeReadiness: RegisterRuntimeReadinessIpcDependencies["runtimeReadiness"];
  runtimeReadinessV2?: RegisterRuntimeReadinessIpcDependencies["runtimeReadinessV2"];
  workspaceServices?: Omit<RegisterWorkspaceIpcDependencies, "ipcMain">;
  settingsUseCases: any;
  selectFolder?: (options?: { title?: string; defaultPath?: string }) => Promise<{ canceled: boolean; path?: string }>;
  executionPlans?: RegisterExecutionPlansIpcDependencies["executionPlans"];
  featureLifecycle?: FeatureLifecycleDiagnosticsPort;
}

export function registerDesktopStartupIpc(dependencies: RegisterDesktopStartupIpcDependencies): void {
  registerRuntimeReadinessIpc({ ipcMain: dependencies.ipcMain, runtimeReadiness: dependencies.runtimeReadiness, runtimeReadinessV2: dependencies.runtimeReadinessV2 });
  if (dependencies.workspaceServices) registerWorkspaceIpc({ ipcMain: dependencies.ipcMain, ...dependencies.workspaceServices });
  registerApplicationSettingsIpc({ ipcMain: dependencies.ipcMain, ...dependencies.settingsUseCases, selectFolder: dependencies.selectFolder });
  if (dependencies.executionPlans) registerExecutionPlansIpc({ ipcMain: dependencies.ipcMain, executionPlans: dependencies.executionPlans });
  registerPythonRuntimeIpc({ ipcMain: dependencies.ipcMain, ...dependencies.pythonRuntime });
  if (dependencies.featureLifecycle) registerFeatureLifecycleDiagnosticsIpc({ ipcMain: dependencies.ipcMain, featureLifecycle: dependencies.featureLifecycle });
}
