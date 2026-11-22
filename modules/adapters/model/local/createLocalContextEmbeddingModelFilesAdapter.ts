import type {ContextInstalledEmbeddingModelFilesPort} from "../../../application/ports/context-management";
import {createLocalSafeModelDirectoryInspector} from "./localSafeModelDirectoryInspector";

/** Existing Context profile; no discovery, installer, model framework or writes. */
export function createLocalContextEmbeddingModelFilesAdapter(options: {
  readonly allowedRootDirectories: readonly string[];
}): ContextInstalledEmbeddingModelFilesPort {
  return createLocalSafeModelDirectoryInspector(options, "embedding");
}
