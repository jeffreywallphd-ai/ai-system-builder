import type {
  SystemDeployment,
  SystemDeploymentDiagnostic,
  SystemDeploymentHealth,
  SystemDeploymentLaunchDescriptor,
  SystemDeploymentRun,
  SystemDeploymentRuntimeKind,
  SystemRuntimeProfileId,
} from "../../../contracts/system-deployment";

export interface SystemDeploymentRuntimeReadiness {
  readonly ready: boolean;
  readonly diagnostics: readonly SystemDeploymentDiagnostic[];
}

export interface SystemDeploymentRuntimeRunResult {
  readonly status: "running" | "succeeded" | "failed";
  readonly diagnostics: readonly SystemDeploymentDiagnostic[];
  readonly runtimeKind?: SystemDeploymentRuntimeKind;
  readonly launchDescriptor?: SystemDeploymentLaunchDescriptor;
  readonly durationMilliseconds?: number;
  readonly outputBytes?: number;
}

export interface SystemDeploymentRuntimePort {
  inspect(
    deployment: Pick<
      SystemDeployment,
      | "runtimeProfileId"
      | "referenceRuntimeKind"
      | "deploymentProfile"
      | "compatibility"
      | "policy"
    >,
  ): Promise<SystemDeploymentRuntimeReadiness>;
  activate(deployment: SystemDeployment): Promise<SystemDeploymentHealth>;
  deactivate(deployment: SystemDeployment): Promise<void>;
  health(deployment: SystemDeployment): Promise<SystemDeploymentHealth>;
  start(
    deployment: SystemDeployment,
    run: SystemDeploymentRun,
  ): Promise<SystemDeploymentRuntimeRunResult>;
  cancel(deployment: SystemDeployment, run: SystemDeploymentRun): Promise<void>;
  supportsRuntimeProfile(profileId: SystemRuntimeProfileId): boolean;
}
