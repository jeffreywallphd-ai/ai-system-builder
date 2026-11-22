/** Private configured-root layout inspection only. It grants no loading,
 * installation, byte-integrity, native custody, resource or ModelRead authority. */
export interface ModelTrainingFilesPort {
  inspectExistingDirectory(localPath: string): Promise<{
    readonly localModelReference: string;
    readonly layoutProfile: "unsharded-training-safetensors-layout-v1";
  } | undefined>;
}
