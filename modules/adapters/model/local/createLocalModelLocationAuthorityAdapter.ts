import type { ModelLocalFilesDeletePort, ModelLocationRevealerPort } from "../../../application/ports/model";
import { ModelLocalFileEffectsUnavailableError } from "../../../application/ports/model";
import type { StructuredDocumentStore } from "../../persistence/shared";

/** No path-based fallback: file effects require a qualified native authority. */
export function createLocalModelLocationAuthorityAdapter(_options: {
  rootDirectory: string;
  documents?: StructuredDocumentStore;
  approvedRoots: readonly string[];
  revealPath?: (candidate: string) => Promise<void> | void;
}): ModelLocalFilesDeletePort & ModelLocationRevealerPort {
  return {
    async revealModelLocation() { throw new ModelLocalFileEffectsUnavailableError(); },
    async deleteLocalModelFiles() { throw new ModelLocalFileEffectsUnavailableError(); },
  };
}
