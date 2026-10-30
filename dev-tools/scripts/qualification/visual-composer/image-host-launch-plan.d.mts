export interface ImageHostInspection {
  readonly schemaVersion: "image-host-local-inputs-v1";
  readonly status: "input-identity-verified";
  readonly runId: string;
  readonly sourceRevision: string;
  readonly checkpointFileName: string;
  readonly checkpointSha256: string;
  readonly checkpointBytes: number;
  readonly comfyCommitSha: string;
  readonly managedSourceConfirmed: true;
  readonly runtimeDependenciesQualified: false;
  readonly hostLaunched: false;
  readonly modelAccuracyExecuted: false;
}
export function imageCheckpointName(value: unknown): value is string;
export function imageHostLayout(repoRoot: string, runId: string): Readonly<{
  repoRoot: string; runId: string; serverRuntimeRoot: string; providerRoot: string;
  checkpointRoot: string; manifestPath: string; desktopDataRoot: string; runRoot: string;
}>;
export function captureImageInspection(input: unknown, runId: unknown, sourceRevision: unknown): Readonly<ImageHostInspection>;
export function createImageHostEnvironment(environment: NodeJS.ProcessEnv, repoRoot: string, runId: string, target: "packaged-desktop" | "thin-chrome"): NodeJS.ProcessEnv;
export function createImageCaseEnvironment(environment: NodeJS.ProcessEnv, repoRoot: string, runId: string, target: "packaged-desktop", selectedCase: "create-register" | "task-recovery", inspection: ImageHostInspection): Record<string,string>;
export function createImageHostLaunchPlan(options: {repoRoot: string; runId: string; target: "packaged-desktop" | "thin-chrome"; environment: NodeJS.ProcessEnv}): Promise<any>;
