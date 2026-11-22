import type {ModelTrainingFilesPort} from "../../../application/ports/model";
import {createLocalSafeModelDirectoryInspector} from "./localSafeModelDirectoryInspector";

/** No model framework, discovery, installer or writes; layout presence only. */
export function createLocalTrainingModelFilesAdapter(options: {
  readonly allowedRootDirectories: readonly string[];
}): ModelTrainingFilesPort {
  const inspector = createLocalSafeModelDirectoryInspector(options, "causal-training");
  return {async inspectExistingDirectory(localPath) {
    const inspected = await inspector.inspectExistingDirectory(localPath);
    return inspected && Object.freeze({...inspected, layoutProfile: "unsharded-training-safetensors-layout-v1" as const});
  }};
}
