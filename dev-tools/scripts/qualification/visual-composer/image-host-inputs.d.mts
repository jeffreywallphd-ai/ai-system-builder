export const IMAGE_INPUT_LIMITS: Readonly<{manifestBytes: number; checkpointBytes: number; headerBytes: number; readBytes: number; tensors: number}>;
export interface ImageHostFileInputs {
  readonly schemaVersion: "image-host-file-inputs-v1";
  readonly status: "bytes-match-declaration";
  readonly runId: string;
  readonly checkpointFileName: string;
  readonly checkpointSha256: string;
  readonly checkpointBytes: number;
  readonly comfyCommitSha: string;
  readonly authorityGranted: false;
  readonly scope: string;
}
export function inspectImageHostInputBytes(repoRoot: string, runId: string): Promise<Readonly<ImageHostFileInputs>>;
