import type {
  ContextManagementClient,
  ContextSourceOption,
} from "../../../../../../../modules/ui/shared";
import type {
  ContextManagementTransportCommand,
  ContextManagementTransportValue,
} from "../../../../../../../modules/contracts/context-management";
import { evaluateContextSourceCapability } from "../../../../../../../modules/contracts/context-management";
import { getDesktopApi } from "../../../lib/desktopApi";
import { createDesktopArtifactBrowserClient } from "../../artifact-browser/api/desktopArtifactBrowserClient";
import { createDesktopModelsClient } from "../../models/api/desktopModelsClient";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";

export function createDesktopContextManagementClient(): ContextManagementClient {
  return {
    async listSourceArtifacts({ workspaceId }) {
      const artifacts =
        await createDesktopArtifactBrowserClient().browseArtifacts({
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
      const models = await createDesktopModelsClient().listModels({
        workspaceId: createWorkspaceId(workspaceId),
        includeSharedStorage: true,
        limit: 200,
      });
      return models
        .filter(
          (model) =>
            Boolean(model.modelId) &&
            model.inferenceMode !== "text-to-image" &&
            model.localFilesAvailable === true &&
            ["downloaded", "generated", "validated"].includes(
              model.lifecycleStatus,
            ),
        )
        .map((model) => ({
          modelId: model.modelId!,
          label:
            model.displayName === model.modelId
              ? model.displayName
              : `${model.displayName} (${model.modelId})`,
        }));
    },
    async execute(input) {
      const api = getDesktopApi();
      if (!api.executeContextManagement)
        throw new Error("Context Management is unavailable.");
      const response = await api.executeContextManagement(input);
      if (!isEnvelope(response))
        throw new Error("Context Management returned an invalid response.");
      if (!response.ok)
        throw new Error(
          response.error?.message ?? "Context Management request failed.",
        );
      return response.value as ContextManagementTransportValue;
    },
  };
}

function isEnvelope(value: unknown): value is {
  readonly ok: boolean;
  readonly value?: ContextManagementTransportValue;
  readonly error?: { readonly message?: string };
} {
  return Boolean(value && typeof value === "object" && "ok" in value);
}

export type { ContextManagementTransportCommand };
