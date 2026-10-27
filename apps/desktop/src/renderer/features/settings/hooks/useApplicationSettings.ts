import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type {
  ApplicationSettingCategory, ApplicationSettingDefinition, ApplicationSettingKey,
  ApplicationSettingPrimitiveValue, ApplicationSettingValue, ResolveModelDefaultRequest, ResolvedModelDefault,
} from "../../../../../../../modules/contracts/settings";
import { createDesktopApplicationSettingsClient, type DesktopApplicationSettingsClient } from "../api/desktopApplicationSettingsClient";
import { APPLICATION_SETTING_VALUE_KINDS, isApplicationSettingCategory } from "../../../../../../../modules/contracts/settings";

interface UseApplicationSettingsOptions {
  client?: DesktopApplicationSettingsClient;
  category?: ApplicationSettingCategory;
  keys?: ApplicationSettingKey[];
}
export interface UseApplicationSettingsResult {
  definitions: ApplicationSettingDefinition[];
  valuesByKey: Map<ApplicationSettingKey, ApplicationSettingValue>;
  loading: boolean;
  saving: boolean;
  status: "idle" | "success" | "error";
  errorMessage?: string;
  successMessage?: string;
  refresh: () => Promise<void>;
  updateSetting: (key: ApplicationSettingKey, value: ApplicationSettingPrimitiveValue) => Promise<boolean>;
  clearSetting: (key: ApplicationSettingKey) => Promise<boolean>;
  selectFolder: (request?: { title?: string; defaultPath?: string }) => Promise<string | undefined>;
  resolveModelDefault: (request: ResolveModelDefaultRequest) => Promise<ResolvedModelDefault>;
}
interface SettingsScope {
  client?: DesktopApplicationSettingsClient;
  query: { category?: ApplicationSettingCategory; keys?: ApplicationSettingKey[] };
  lease?: object;
  readOwner?: object;
  mutationOwner?: object;
  folderOwner?: object;
  ready: boolean;
}
interface SettingsView {
  scope: SettingsScope;
  definitions: ApplicationSettingDefinition[];
  valuesByKey: Map<ApplicationSettingKey, ApplicationSettingValue>;
  loading: boolean;
  saving: boolean;
  status: "idle" | "success" | "error";
  errorMessage?: string;
  successMessage?: string;
}
function initialView(scope: SettingsScope): SettingsView {
  return { scope, definitions: [], valuesByKey: new Map(), loading: true, saving: false, status: "idle" };
}
export function useApplicationSettings(options: UseApplicationSettingsOptions = {}): UseApplicationSettingsResult {
  const client = useMemo(() => {
    if (options.client) return options.client;
    try { return createDesktopApplicationSettingsClient(); } catch { return undefined; }
  }, [options.client]);
  const keysSignature = options.keys === undefined ? undefined : JSON.stringify(options.keys);
  const scope = useMemo<SettingsScope>(() => ({
    client,
    query: { category: options.category, keys: keysSignature === undefined ? undefined : JSON.parse(keysSignature) },
    ready: false,
  }), [client, options.category, keysSignature]);
  const [view, setView] = useState(() => initialView(scope));

  // Only a committed view owns work. An abandoned render must not retire it.
  useLayoutEffect(() => {
    const lease = {};
    scope.lease = lease;
    scope.readOwner = scope.mutationOwner = scope.folderOwner = undefined;
    scope.ready = false;
    setView(initialView(scope));
    return () => {
      if (scope.lease === lease) {
        scope.lease = undefined;
        scope.readOwner = scope.mutationOwner = scope.folderOwner = undefined;
        scope.ready = false;
      }
    };
  }, [scope]);

  const load = useCallback(async (lease: object, afterChange = false): Promise<boolean> => {
    const owner = {};
    const current = () => scope.lease === lease && scope.readOwner === owner;
    if (scope.lease !== lease) return false;
    scope.readOwner = owner;
    scope.ready = false;
    setView(previous => ({ ...previous, loading: true, status: "idle", errorMessage: undefined, successMessage: undefined }));
    try {
      if (!scope.client) throw new Error("unavailable");
      const query = () => ({ category: scope.query.category, keys: scope.query.keys && [...scope.query.keys] });
      const [definitions, values] = await Promise.all([
        scope.client.listDefinitions(query()), scope.client.readSettings(query()),
      ]);
      if (!current()) return false;
      // Prepare consumed data inside this error boundary, never in a React updater.
      if (!Array.isArray(definitions.definitions) || !Array.isArray(values.values)) throw new Error("invalid readback");
      const preparedDefinitions = definitions.definitions.map(definition => {
        if (!definition || typeof definition.key !== "string" || typeof definition.label !== "string"
          || !isApplicationSettingCategory(definition.category) || !APPLICATION_SETTING_VALUE_KINDS.includes(definition.valueKind)
          || [definition.description, definition.placeholder, definition.instructions].some(text => text !== undefined && typeof text !== "string")
          || definition.options !== undefined && (!Array.isArray(definition.options)
            || definition.options.some(option => !option || typeof option.value !== "string" || option.label !== undefined && typeof option.label !== "string"))) {
          throw new Error("invalid definition");
        }
        return definition;
      });
      const preparedValues = new Map(values.values.map(value => {
        if (!value || typeof value.key !== "string" || typeof value.configured !== "boolean"
          || value.maskedValue !== undefined && typeof value.maskedValue !== "string") throw new Error("invalid setting");
        return [value.key, value] as const;
      }));
      if (!current()) return false;
      scope.ready = true;
      setView(previous => ({ ...previous, definitions: preparedDefinitions, valuesByKey: preparedValues, status: "idle" }));
      return true;
    } catch {
      if (current()) setView(previous => ({ ...previous, status: "error", errorMessage: !scope.client
        ? "Application settings API is unavailable."
        : afterChange ? "Could not reload settings after the change. Refresh settings before trying again."
          : "Could not load settings. Refresh settings to try again." }));
      return false;
    } finally {
      if (current()) {
        scope.readOwner = undefined;
        setView(previous => ({ ...previous, loading: false }));
      }
    }
  }, [scope]);
  const refresh = useCallback(async () => {
    const lease = scope.lease;
    if (lease && !scope.mutationOwner) await load(lease);
  }, [scope, load]);
  useEffect(() => { void refresh(); }, [refresh]);

  const mutate = useCallback(async (kind: "save" | "clear", key: ApplicationSettingKey, value?: ApplicationSettingPrimitiveValue) => {
    const lease = scope.lease, client = scope.client;
    if (!lease || !client || !scope.ready || scope.readOwner || scope.mutationOwner || scope.folderOwner) return false;
    const owner = {};
    scope.mutationOwner = owner;
    scope.ready = false;
    const current = () => scope.lease === lease && scope.mutationOwner === owner;
    setView(previous => ({ ...previous, saving: true, status: "idle", errorMessage: undefined, successMessage: undefined }));
    try {
      if (kind === "save") await client.updateSetting({ key, value: value! });
      else await client.clearSetting({ key });
      if (!current() || !await load(lease, true) || !current()) return false;
      setView(previous => ({ ...previous, status: "success", successMessage: kind === "save" ? "Setting saved." : "Setting cleared." }));
      return true;
    } catch {
      if (current()) {
        // A refused write leaves the last read available for an explicit retry.
        scope.ready = true;
        setView(previous => ({ ...previous, status: "error", errorMessage: kind === "save"
          ? "Could not save setting. Try again." : "Could not clear setting. Try again." }));
      }
      return false;
    } finally {
      if (current()) {
        scope.mutationOwner = undefined;
        setView(previous => ({ ...previous, saving: false }));
      }
    }
  }, [scope, load]);
  const updateSetting = useCallback((key: ApplicationSettingKey, value: ApplicationSettingPrimitiveValue) => mutate("save", key, value), [mutate]);
  const clearSetting = useCallback((key: ApplicationSettingKey) => mutate("clear", key), [mutate]);
  const selectFolder = useCallback(async (request: { title?: string; defaultPath?: string } = {}) => {
    const lease = scope.lease;
    if (!lease || !scope.ready || scope.mutationOwner || scope.folderOwner) return undefined;
    const owner = {};
    scope.folderOwner = owner;
    const current = () => scope.lease === lease && scope.folderOwner === owner;
    setView(previous => ({ ...previous, status: "idle", errorMessage: undefined, successMessage: undefined }));
    try {
      if (!scope.client?.selectFolder) throw new Error("unavailable");
      const result = await scope.client.selectFolder({ ...request });
      return current() && !result.canceled ? result.path : undefined;
    } catch {
      if (current()) setView(previous => ({ ...previous, status: "error", successMessage: undefined,
        errorMessage: "Could not choose a folder. Try again." }));
      return undefined;
    } finally {
      if (current()) scope.folderOwner = undefined;
    }
  }, [scope]);
  const resolveModelDefault = useCallback(async (request: ResolveModelDefaultRequest) => {
    const lease = scope.lease;
    if (!lease || !scope.client) throw new Error("Application settings API is unavailable.");
    try {
      const result = await scope.client.resolveModelDefault({ ...request });
      if (scope.lease !== lease) throw new Error("retired");
      return result.resolved;
    } catch { throw new Error("Could not resolve the model setting. Try again."); }
  }, [scope]);

  const shown = view.scope === scope ? view : initialView(scope);
  return {
    definitions: shown.definitions, valuesByKey: shown.valuesByKey, loading: shown.loading, saving: shown.saving,
    status: shown.status, errorMessage: shown.errorMessage, successMessage: shown.successMessage,
    refresh, updateSetting, clearSetting, selectFolder, resolveModelDefault,
  };
}
