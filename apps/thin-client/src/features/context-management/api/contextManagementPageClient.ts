import {
  evaluateContextSourceCapability,
  type ContextManagementTransportValue,
} from "../../../../../../modules/contracts/context-management";
import type {
  ContextManagementClient,
  ContextSourceOption,
} from "../../../../../../modules/ui/shared";
import { createApiArtifactBrowserClient } from "../../artifact-browser/api/apiArtifactBrowserClient";
import { createApiContextManagementClient } from "./apiContextManagementClient";
import { createApiModelManagementClient } from "../../model-management/api/apiModelManagementClient";
import { createWorkspaceId } from "../../../../../../modules/contracts/workspace";

export function createContextManagementPageClient(): ContextManagementClient {
  const context = createApiContextManagementClient();
  return {
    async listSourceArtifacts({ workspaceId }) {
      const artifacts = await createApiArtifactBrowserClient().browseArtifacts({
        workspaceId,
      });
      return artifacts.flatMap((artifact): ContextSourceOption[] => {
        const capability = evaluateContextSourceCapability({
          fileName: artifact.originalName ?? artifact.storageKey,
          mediaType: artifact.mediaType,
        });
        return capability.ready
          ? [
              {
                artifactId: artifact.storageKey,
                label: artifact.originalName ?? artifact.storageKey,
                mediaType: artifact.mediaType,
                sourceKind: artifact.sourceKind,
              },
            ]
          : [];
      });
    },
    async listLocalTextModels({ workspaceId }) {
      const result = await createApiModelManagementClient().listModels({
        workspaceId: createWorkspaceId(workspaceId),
        includeSharedStorage: true,
        limit: 200,
      });
      return result.models
        .filter((model) => {
          const localFilesAvailable = (
            model as typeof model & { readonly localFilesAvailable?: boolean }
          ).localFilesAvailable;
          return (
            Boolean(model.modelId) &&
            model.inferenceMode !== "text-to-image" &&
            localFilesAvailable === true &&
            ["downloaded", "generated", "validated"].includes(
              model.lifecycleStatus,
            )
          );
        })
        .map((model) => ({
          modelId: model.modelId!,
          label:
            model.displayName === model.modelId
              ? model.displayName
              : `${model.displayName} (${model.modelId})`,
        }));
    },
    execute: (input): Promise<ContextManagementTransportValue> =>
      context.execute(input),
  };
}
