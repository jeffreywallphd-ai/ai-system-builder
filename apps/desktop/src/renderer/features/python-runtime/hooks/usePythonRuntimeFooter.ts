import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createDesktopPythonRuntimeClient, type DesktopPythonRuntimeClient } from "../api/desktopPythonRuntimeClient";

export interface UsePythonRuntimeFooterOptions {
  enabled: boolean;
  client?: DesktopPythonRuntimeClient;
}

export interface UsePythonRuntimeFooterResult {
  statusLabel: string;
  healthLabel: string;
  capabilitiesLabel: string;
  logs: Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string }>;
  loading: boolean;
  error?: string;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function usePythonRuntimeFooter(options: UsePythonRuntimeFooterOptions): UsePythonRuntimeFooterResult {
  const client = useMemo(
    () => options.client ?? createDesktopPythonRuntimeClient(),
    [options.client],
  );
  const [statusLabel, setStatusLabel] = useState("unknown");
  const [healthLabel, setHealthLabel] = useState("unknown");
  const [capabilitiesLabel, setCapabilitiesLabel] = useState("none");
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const inFlightRefresh = useRef(false);
  const lastSnapshotSignature = useRef<string | undefined>(undefined);

  const toSnapshotSignature = useCallback((snapshot: Awaited<ReturnType<DesktopPythonRuntimeClient["readStatus"]>>) => {
    const lastLogEntry = snapshot.logs[snapshot.logs.length - 1];
    return [
      snapshot.supervisorStatus,
      snapshot.runtimeStatus,
      snapshot.healthy ? "healthy" : "unhealthy",
      snapshot.capabilities.join("|"),
      String(snapshot.activeTaskCount),
      snapshot.loadedModels.map((model) => `${model.provider}:${model.modelId}:${model.inferenceMode}:${model.localPath ?? ""}`).join("|"),
      String(snapshot.logs.length),
      lastLogEntry?.timestamp ?? "",
      lastLogEntry?.level ?? "",
      lastLogEntry?.message ?? "",
    ].join("::");
  }, []);

  const applySnapshot = useCallback((snapshot: Awaited<ReturnType<DesktopPythonRuntimeClient["readStatus"]>>) => {
    const signature = toSnapshotSignature(snapshot);
    if (lastSnapshotSignature.current === signature) {
      return;
    }

    lastSnapshotSignature.current = signature;
    setStatusLabel(snapshot.supervisorStatus);
    setHealthLabel(snapshot.healthy ? "healthy" : "unhealthy");
    setCapabilitiesLabel(snapshot.capabilities.length > 0 ? snapshot.capabilities.join(", ") : "none");
    setLogs(snapshot.logs);
  }, [toSnapshotSignature]);

  const runRefresh = useCallback(async (background: boolean) => {
    if (inFlightRefresh.current) {
      return;
    }

    inFlightRefresh.current = true;
    if (!background) {
      setLoading(true);
    }
    try {
      const snapshot = await client.readStatus();
      applySnapshot(snapshot);
      setError(undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load runtime status.");
    } finally {
      inFlightRefresh.current = false;
      if (!background) {
        setLoading(false);
      }
    }
  }, [applySnapshot, client]);

  const onRefresh = useCallback(async () => {
    await runRefresh(false);
  }, [runRefresh]);

  const runControl = useCallback(async (action: "start" | "stop" | "restart") => {
    setLoading(true);
    try {
      const snapshot = await client.controlRuntime(action);
      applySnapshot(snapshot);
      setError(undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Runtime action failed.");
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, client]);

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    void runRefresh(true);
    const timer = setInterval(() => {
      void runRefresh(true);
    }, 10_000);

    return () => {
      clearInterval(timer);
    };
  }, [options.enabled, runRefresh]);

  return {
    statusLabel,
    healthLabel,
    capabilitiesLabel,
    logs,
    loading,
    error,
    onStart: () => runControl("start"),
    onStop: () => runControl("stop"),
    onRestart: () => runControl("restart"),
    onRefresh,
  };
}
