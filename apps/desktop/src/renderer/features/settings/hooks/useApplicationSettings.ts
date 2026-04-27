import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ApplicationSettingCategory,
  ApplicationSettingDefinition,
  ApplicationSettingKey,
  ApplicationSettingPrimitiveValue,
  ApplicationSettingValue,
  ResolveModelDefaultRequest,
  ResolvedModelDefault,
} from "../../../../../../../modules/contracts/settings";
import {
  createDesktopApplicationSettingsClient,
  type DesktopApplicationSettingsClient,
} from "../api/desktopApplicationSettingsClient";

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
  updateSetting: (key: ApplicationSettingKey, value: ApplicationSettingPrimitiveValue) => Promise<void>;
  clearSetting: (key: ApplicationSettingKey) => Promise<void>;
  resolveModelDefault: (request: ResolveModelDefaultRequest) => Promise<ResolvedModelDefault>;
}

export function useApplicationSettings(options: UseApplicationSettingsOptions = {}): UseApplicationSettingsResult {
  const client = useMemo(() => {
    if (options.client) {
      return options.client;
    }
    try {
      return createDesktopApplicationSettingsClient();
    } catch {
      return undefined;
    }
  }, [options.client]);
  const [definitions, setDefinitions] = useState<ApplicationSettingDefinition[]>([]);
  const [valuesByKey, setValuesByKey] = useState<Map<ApplicationSettingKey, ApplicationSettingValue>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);

  const query = useMemo(() => ({ category: options.category, keys: options.keys }), [options.category, options.keys]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMessage(undefined);
    if (!client) {
      setDefinitions([]);
      setValuesByKey(new Map());
      setStatus("error");
      setErrorMessage("Application settings API is unavailable.");
      setLoading(false);
      return;
    }
    try {
      const [definitionsResult, valuesResult] = await Promise.all([
        client.listDefinitions(query),
        client.readSettings(query),
      ]);

      setDefinitions(definitionsResult.definitions);
      setValuesByKey(new Map(valuesResult.values.map((value) => [value.key, value])));
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to load application settings.");
    } finally {
      setLoading(false);
    }
  }, [client, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSetting = useCallback(async (key: ApplicationSettingKey, value: ApplicationSettingPrimitiveValue) => {
    setSaving(true);
    setErrorMessage(undefined);
    setSuccessMessage(undefined);
    if (!client) {
      setStatus("error");
      setErrorMessage("Application settings API is unavailable.");
      setSaving(false);
      return;
    }
    try {
      await client.updateSetting({ key, value });
      await refresh();
      setStatus("success");
      setSuccessMessage("Setting saved.");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to update setting.");
    } finally {
      setSaving(false);
    }
  }, [client, refresh]);

  const clearSetting = useCallback(async (key: ApplicationSettingKey) => {
    setSaving(true);
    setErrorMessage(undefined);
    setSuccessMessage(undefined);
    if (!client) {
      setStatus("error");
      setErrorMessage("Application settings API is unavailable.");
      setSaving(false);
      return;
    }
    try {
      await client.clearSetting({ key });
      await refresh();
      setStatus("success");
      setSuccessMessage("Setting cleared.");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to clear setting.");
    } finally {
      setSaving(false);
    }
  }, [client, refresh]);

  const resolveModelDefault = useCallback(async (request: ResolveModelDefaultRequest) => {
    if (!client) {
      throw new Error("Application settings API is unavailable.");
    }
    const result = await client.resolveModelDefault(request);
    return result.resolved;
  }, [client]);

  return {
    definitions,
    valuesByKey,
    loading,
    saving,
    status,
    errorMessage,
    successMessage,
    refresh,
    updateSetting,
    clearSetting,
    resolveModelDefault,
  };
}
