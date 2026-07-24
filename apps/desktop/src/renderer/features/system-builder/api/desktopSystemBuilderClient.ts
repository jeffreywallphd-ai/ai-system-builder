import type { SystemBuilderClient } from "../../../../../../../modules/ui/shared/system-builder";
import type { SystemBuilderResult } from "../../../../../../../modules/contracts/system-builder";
import { getDesktopApi } from "../../../lib/desktopApi";

const unavailable = <T>(
  message = "System Builder is unavailable.",
): SystemBuilderResult<T> => ({
  ok: false,
  error: { code: "unavailable", message },
});
const unwrap = <T>(response: unknown): SystemBuilderResult<T> => {
  const value = response as any;
  return value?.ok
    ? { ok: true, value: value.value as T }
    : unavailable(
        value?.error?.message ?? "The System Builder request failed.",
      );
};

export function createDesktopSystemBuilderClient(): SystemBuilderClient {
  const api = getDesktopApi();
  return {
    list: async (input) =>
      typeof api.listSystemBuilderSystems === "function"
        ? unwrap(await api.listSystemBuilderSystems(input))
        : unavailable(),
    listManagement: async (input) =>
      typeof api.listSystemBuilderManagement === "function"
        ? unwrap(await api.listSystemBuilderManagement(input))
        : unavailable(),
    create: async (input) =>
      typeof api.createSystemBuilderSystem === "function"
        ? unwrap(await api.createSystemBuilderSystem(input))
        : unavailable(),
    listTemplates: async () =>
      typeof api.listSystemBuilderTemplates === "function"
        ? unwrap(await api.listSystemBuilderTemplates({}))
        : unavailable(),
    createFromTemplate: async (input) =>
      typeof api.createSystemBuilderFromTemplate === "function"
        ? unwrap(await api.createSystemBuilderFromTemplate(input))
        : unavailable(),
    readRevision: async (input) =>
      typeof api.readSystemBuilderRevision === "function"
        ? unwrap(await api.readSystemBuilderRevision(input))
        : unavailable(),
    saveRevision: async (input) =>
      typeof api.saveSystemBuilderRevision === "function"
        ? unwrap(await api.saveSystemBuilderRevision(input))
        : unavailable(),
    archive: async (input) =>
      typeof api.archiveSystemBuilderSystem === "function"
        ? unwrap(await api.archiveSystemBuilderSystem(input))
        : unavailable(),
    restore: async (input) =>
      typeof api.restoreSystemBuilderSystem === "function"
        ? unwrap(await api.restoreSystemBuilderSystem(input))
        : unavailable(),
    clone: async (input) =>
      typeof api.cloneSystemBuilderSystem === "function"
        ? unwrap(await api.cloneSystemBuilderSystem(input))
        : unavailable(),
    listRevisions: async (input) =>
      typeof api.listSystemBuilderRevisions === "function"
        ? unwrap(await api.listSystemBuilderRevisions(input))
        : unavailable(),
    listComposerAssets: async (input) =>
      typeof api.listSystemBuilderComposerAssets === "function"
        ? unwrap(await api.listSystemBuilderComposerAssets(input))
        : unavailable(),
    previewLayoutChange: async (input) =>
      typeof api.previewSystemBuilderLayoutChange === "function"
        ? unwrap(await api.previewSystemBuilderLayoutChange(input))
        : unavailable(),
    previewFoundationUpgrade: async (input) =>
      typeof api.previewSystemBuilderFoundationUpgrade === "function"
        ? unwrap(await api.previewSystemBuilderFoundationUpgrade(input))
        : unavailable(),
    upgradeFoundation: async (input) =>
      typeof api.upgradeSystemBuilderFoundation === "function"
        ? unwrap(await api.upgradeSystemBuilderFoundation(input))
        : unavailable(),
  };
}
