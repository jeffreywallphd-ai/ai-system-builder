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
  systemResources: {
    memoryUsagePercent: number;
    cpuUsagePercent: number;
    gpuUsagePercent: number;
  };
  logs: Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string }>;
  loading: boolean;
  error?: string;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onClearLogs: () => Promise<void>;
  logsExpanded: boolean;
  setLogsExpanded: (expanded: boolean) => void;
}

export function usePythonRuntimeFooter(options: UsePythonRuntimeFooterOptions): UsePythonRuntimeFooterResult {
  const client = useMemo(
    () => options.client ?? createDesktopPythonRuntimeClient(),
    [options.client],
  );
  const [statusLabel, setStatusLabel] = useState("unknown");
  const [healthLabel, setHealthLabel] = useState("unknown");
  const [capabilitiesLabel, setCapabilitiesLabel] = useState("none");
  const [systemResources, setSystemResources] = useState({
    memoryUsagePercent: 0,
    cpuUsagePercent: 0,
    gpuUsagePercent: 0,
  });
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [logsExpanded, setLogsExpanded] = useState(false);
  const inFlightRefresh = useRef(false);
  const lastSnapshotSignature = useRef<string | undefined>(undefined);
  const toSystemResources = useCallback((snapshot: Awaited<ReturnType<DesktopPythonRuntimeClient["readStatus"]>>) => ({
    memoryUsagePercent: snapshot.systemResources?.memoryUsagePercent ?? 0,
    cpuUsagePercent: snapshot.systemResources?.cpuUsagePercent ?? 0,
    gpuUsagePercent: snapshot.systemResources?.gpuUsagePercent ?? 0,
  }), []);

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

  const applySnapshot = useCallback((snapshot: Awaited<ReturnType<DesktopPythonRuntimeClient["readStatus"]>>, options?: { includeLogs?: boolean }) => {
    const signature = toSnapshotSignature(snapshot);
    if (lastSnapshotSignature.current === signature) {
      setSystemResources(toSystemResources(snapshot));
      return;
    }

    lastSnapshotSignature.current = signature;
    setStatusLabel(snapshot.supervisorStatus);
    setHealthLabel(snapshot.healthy ? "healthy" : "unhealthy");
    setCapabilitiesLabel(snapshot.capabilities.length > 0 ? snapshot.capabilities.join(", ") : "none");
    setSystemResources(toSystemResources(snapshot));
    if (options?.includeLogs ?? true) {
      setLogs(snapshot.logs);
    }
  }, [toSnapshotSignature, toSystemResources]);

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
      applySnapshot(snapshot, { includeLogs: true });
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

  const runControl = useCallback(async (action: "start" | "stop" | "restart" | "clear-logs") => {
    setLoading(true);
    try {
      const snapshot = await client.controlRuntime(action);
      applySnapshot(snapshot, { includeLogs: true });
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

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    const timer = setInterval(() => {
      void (async () => {
        if (inFlightRefresh.current) {
          return;
        }

        inFlightRefresh.current = true;
        try {
          const snapshot = await client.readStatus();
          applySnapshot(snapshot, { includeLogs: false });
        } catch {
          // Resource tracker should remain non-disruptive if a background poll fails.
        } finally {
          inFlightRefresh.current = false;
        }
      })();
    }, 5_000);

    return () => {
      clearInterval(timer);
    };
  }, [applySnapshot, client, options.enabled]);

  useEffect(() => {
    if (!options.enabled) {
      return;
    }

    const onDatasetPreparationTrainingStarted = () => {
      setLogsExpanded(true);
    };

    window.addEventListener("dataset-preparation-training-started", onDatasetPreparationTrainingStarted);
    return () => {
      window.removeEventListener("dataset-preparation-training-started", onDatasetPreparationTrainingStarted);
    };
  }, [options.enabled]);

  return {
    statusLabel,
    healthLabel,
    capabilitiesLabel,
    systemResources,
    logs,
    loading,
    error,
    onStart: () => runControl("start"),
    onStop: () => runControl("stop"),
    onRestart: () => runControl("restart"),
    onRefresh,
    onClearLogs: () => runControl("clear-logs"),
    logsExpanded,
    setLogsExpanded,
  };
}
