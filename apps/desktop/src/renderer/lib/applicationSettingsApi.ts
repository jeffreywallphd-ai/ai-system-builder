import {
  getDesktopApi,
  type DesktopApplicationSettingsDefinitionsResult,
  type DesktopApplicationSettingsReadResult,
  type DesktopApplicationSettingUpdateResult,
  type DesktopResolvedModelDefaultResult,
} from "./desktopApi";
import {
  type ApplicationSettingCategory,
  type ApplicationSettingPrimitiveValue,
  isApplicationSettingCategory,
  isModelDefaultFeatureKey,
  isModelDefaultTaskKey,
  type ModelDefaultFeatureKey,
  type ModelDefaultTaskKey,
} from "../../../../../modules/contracts/settings";

function ensureSuccess<T>(
  response: unknown,
  pick: (value: unknown) => T,
  fallback: string,
): T {
  if (typeof response !== "object" || response === null || !('ok' in response)) {
    throw new Error(fallback);
  }

  const envelope = response as { ok: boolean; value?: unknown; error?: { message?: string } };
  if (!envelope.ok) {
    throw new Error(envelope.error?.message ?? fallback);
  }

  return pick(envelope.value);
}

export interface ApplicationSettingsApi {
  listDefinitions: (input?: { category?: string; keys?: string[] }) => Promise<DesktopApplicationSettingsDefinitionsResult>;
  readSettings: (input?: { category?: string; keys?: string[] }) => Promise<DesktopApplicationSettingsReadResult>;
  updateSetting: (input: { key: string; value: ApplicationSettingPrimitiveValue }) => Promise<DesktopApplicationSettingUpdateResult>;
  clearSetting: (input: { key: string }) => Promise<DesktopApplicationSettingUpdateResult>;
  resolveModelDefault: (input: { taskKey: string; featureKey?: string }) => Promise<DesktopResolvedModelDefaultResult>;
}

function normalizeOptionalCategory(category?: string): ApplicationSettingCategory | undefined {
  if (!category) {
    return undefined;
  }
  if (!isApplicationSettingCategory(category)) {
    throw new Error(`Unknown application settings category "${category}".`);
  }
  return category;
}

function normalizeResolveTaskKey(taskKey: string): ModelDefaultTaskKey {
  if (!isModelDefaultTaskKey(taskKey)) {
    throw new Error(`Unknown model default task key "${taskKey}".`);
  }
  return taskKey;
}

function normalizeOptionalFeatureKey(featureKey?: string): ModelDefaultFeatureKey | undefined {
  if (!featureKey) {
    return undefined;
  }
  if (!isModelDefaultFeatureKey(featureKey)) {
    throw new Error(`Unknown model default feature key "${featureKey}".`);
  }
  return featureKey;
}

export function createApplicationSettingsApi(): ApplicationSettingsApi {
  const desktopApi = getDesktopApi();

  return {
    async listDefinitions(input = {}) {
      if (!desktopApi.listApplicationSettingDefinitions) {
        throw new Error("Desktop preload application settings list-definitions bridge is unavailable.");
      }
      const normalizedInput = {
        category: normalizeOptionalCategory(input.category),
        keys: input.keys,
      };
      return ensureSuccess(
        await desktopApi.listApplicationSettingDefinitions(normalizedInput),
        (value) => value as DesktopApplicationSettingsDefinitionsResult,
        "Failed to list application setting definitions.",
      );
    },

    async readSettings(input = {}) {
      if (!desktopApi.readApplicationSettings) {
        throw new Error("Desktop preload application settings read bridge is unavailable.");
      }
      const normalizedInput = {
        category: normalizeOptionalCategory(input.category),
        keys: input.keys,
      };
      return ensureSuccess(
        await desktopApi.readApplicationSettings(normalizedInput),
        (value) => value as DesktopApplicationSettingsReadResult,
        "Failed to read application settings.",
      );
    },

    async updateSetting(input) {
      if (!desktopApi.updateApplicationSetting) {
        throw new Error("Desktop preload application settings update bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.updateApplicationSetting(input),
        (value) => value as DesktopApplicationSettingUpdateResult,
        "Failed to update application setting.",
      );
    },

    async clearSetting(input) {
      if (!desktopApi.clearApplicationSetting) {
        throw new Error("Desktop preload application settings clear bridge is unavailable.");
      }
      return ensureSuccess(
        await desktopApi.clearApplicationSetting(input),
        (value) => value as DesktopApplicationSettingUpdateResult,
        "Failed to clear application setting.",
      );
    },

    async resolveModelDefault(input) {
      const resolver = desktopApi.resolveApplicationModelDefault ?? desktopApi.resolveModelDefault;
      if (!resolver) {
        throw new Error("Desktop preload model default resolver bridge is unavailable.");
      }
      const normalizedInput: { taskKey: ModelDefaultTaskKey; featureKey?: ModelDefaultFeatureKey } = {
        taskKey: normalizeResolveTaskKey(input.taskKey),
        featureKey: normalizeOptionalFeatureKey(input.featureKey),
      };
      return ensureSuccess(
        await resolver(normalizedInput),
        (value) => value as DesktopResolvedModelDefaultResult,
        "Failed to resolve model default.",
      );
    },
  };
}
