import {
  getDesktopApi,
  type DesktopPrepareTrainingDatasetInput,
  type DesktopPreparedTrainingDatasetResult,
  type DesktopArtifactBrowseItem,
} from "../../../lib/desktopApi";

interface PreloadResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

function isPreloadResponseEnvelope(value: unknown): value is PreloadResponseEnvelope {
  return typeof value === "object" && value !== null && "ok" in value;
}

export type DesktopDatasetPreparationResult =
  | { ok: true; value: DesktopPreparedTrainingDatasetResult }
  | { ok: false; error: { code: string; message: string } };

export interface DesktopDatasetPreparationRequestContext {
  requestId?: string;
  correlationId?: string;
}

export interface DesktopDatasetPreparationClient {
  browseSourceArtifacts: () => Promise<Array<{ artifactId: string; label: string }>>;
  prepareTrainingDatasetFromArtifacts: (
    input: DesktopPrepareTrainingDatasetInput,
    context?: DesktopDatasetPreparationRequestContext,
  ) => Promise<DesktopDatasetPreparationResult>;
}

function ensureSuccessEnvelope(response: unknown, fallbackMessage: string): { value?: unknown } {
  if (!isPreloadResponseEnvelope(response)) {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(response.error?.message ?? fallbackMessage);
  }

  return { value: response.value };
}

function toBrowseItems(value: unknown): DesktopArtifactBrowseItem[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const items = (value as { items?: DesktopArtifactBrowseItem[] }).items;
  return Array.isArray(items) ? items : [];
}

export function createDesktopDatasetPreparationClient(): DesktopDatasetPreparationClient {
  const desktopApi = getDesktopApi();

  return {
    async browseSourceArtifacts() {
      const payload = ensureSuccessEnvelope(
        await desktopApi.browseArtifacts(),
        "Failed to browse source artifacts.",
      );

      return toBrowseItems(payload.value).map((artifact) => {
        if (typeof artifact.artifactId !== "string" || artifact.artifactId.trim().length === 0) {
          throw new Error("Artifact browse item is missing artifactId.");
        }

        return {
          artifactId: artifact.artifactId,
          label: artifact.originalName ?? artifact.storageKey,
        };
      });
    },

    async prepareTrainingDatasetFromArtifacts(
      input: DesktopPrepareTrainingDatasetInput,
      context?: DesktopDatasetPreparationRequestContext,
    ): Promise<DesktopDatasetPreparationResult> {
      if (!desktopApi.prepareTrainingDatasetFromArtifacts) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "Dataset preparation is unavailable.",
          },
        };
      }

      const response = await desktopApi.prepareTrainingDatasetFromArtifacts(input, context);
      if (!isPreloadResponseEnvelope(response)) {
        return {
          ok: false,
          error: {
            code: "internal",
            message: "Dataset preparation failed.",
          },
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: response.error?.code ?? "internal",
            message: response.error?.message ?? "Dataset preparation failed.",
          },
        };
      }

      const result = (response.value as { result?: DesktopPreparedTrainingDatasetResult } | undefined)?.result;
      if (!result) {
        return {
          ok: false,
          error: {
            code: "internal",
            message: "Dataset preparation response missing result payload.",
          },
        };
      }

      return {
        ok: true,
        value: result,
      };
    },
  };
}
