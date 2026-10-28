import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createDesktopPythonRuntimeClient, type DesktopPythonRuntimeClient } from "../api/desktopPythonRuntimeClient";

export interface UsePythonRuntimeFooterOptions {
  enabled: boolean;
  client?: DesktopPythonRuntimeClient;
}
export interface UsePythonRuntimeFooterResult {
  statusLabel: string;
  healthLabel: string;
  capabilitiesLabel: string;
  systemResources: { memoryUsagePercent: number; cpuUsagePercent: number; gpuUsagePercent: number };
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
type Snapshot = Awaited<ReturnType<DesktopPythonRuntimeClient["readStatus"]>>;
type Display = Pick<UsePythonRuntimeFooterResult, "statusLabel" | "healthLabel" | "capabilitiesLabel" | "systemResources" | "logs" | "loading" | "error" | "logsExpanded">;
interface Scope {
  live: boolean;
  lease: number;
  revision: number;
  readOwner?: { foreground: boolean };
  actionOwner?: object;
  flight?: { revision: number; promise: Promise<Snapshot> };
}
const READ_FAILURE = "Runtime status could not be loaded. Select Refresh to try again.";
const ACTION_FAILURE = "The runtime action could not finish. Select Refresh to check its status before trying again.";
const initialDisplay = (): Display => ({ statusLabel: "unknown", healthLabel: "unknown", capabilitiesLabel: "none", systemResources: { memoryUsagePercent: 0, cpuUsagePercent: 0, gpuUsagePercent: 0 }, logs: [], loading: false, logsExpanded: false });
const percentage = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;

// Prepare consumed fields before a React update. No response parsing runs in an updater.
function prepare(snapshot: Snapshot): Pick<Display, "statusLabel" | "healthLabel" | "capabilitiesLabel" | "systemResources" | "logs"> {
  if (!snapshot || !["stopped", "starting", "ready", "failed"].includes(snapshot.supervisorStatus)
      || typeof snapshot.healthy !== "boolean" || !Array.isArray(snapshot.capabilities)
      || !snapshot.capabilities.every(x => typeof x === "string") || !Array.isArray(snapshot.logs)) throw new Error(READ_FAILURE);
  const logs = snapshot.logs.map(entry => {
    if (!entry || typeof entry.timestamp !== "string" || !["info", "warn", "error"].includes(entry.level) || typeof entry.message !== "string") throw new Error(READ_FAILURE);
    return { timestamp: entry.timestamp, level: entry.level, message: entry.message };
  });
  return { statusLabel: snapshot.supervisorStatus, healthLabel: snapshot.healthy ? "healthy" : "unhealthy", capabilitiesLabel: snapshot.capabilities.length ? snapshot.capabilities.join(", ") : "none", logs,
    systemResources: { memoryUsagePercent: percentage(snapshot.systemResources?.memoryUsagePercent), cpuUsagePercent: percentage(snapshot.systemResources?.cpuUsagePercent), gpuUsagePercent: percentage(snapshot.systemResources?.gpuUsagePercent) } };
}

export function usePythonRuntimeFooter(options: UsePythonRuntimeFooterOptions): UsePythonRuntimeFooterResult {
  const client = useMemo(() => options.client ?? createDesktopPythonRuntimeClient(), [options.client]);
  const scope = useMemo<Scope>(() => ({ live: false, lease: 0, revision: 0 }), [client, options.enabled]);
  const committed = useRef<Scope | undefined>(undefined);
  const [state, setState] = useState<Display & { scope: Scope }>(() => ({ ...initialDisplay(), scope }));
  const current = useCallback(() => options.enabled && scope.live && committed.current === scope, [options.enabled, scope]);
  const publish = useCallback((patch: Partial<Display>, lease = scope.lease, revision?: number) => {
    setState(previous => {
      if (!current() || scope.lease !== lease || (revision !== undefined && scope.revision !== revision)) return previous;
      return { ...(previous.scope === scope ? previous : initialDisplay()), ...patch, scope };
    });
  }, [current, scope]);
  useLayoutEffect(() => {
    scope.live = true; scope.lease += 1; committed.current = scope;
    return () => {
      scope.live = false; scope.lease += 1; scope.readOwner = undefined; scope.actionOwner = undefined;
      if (committed.current === scope) committed.current = undefined;
    };
  }, [scope]);

  const runRefresh = useCallback(async (background: boolean, includeLogs = true) => {
    if (!current() || scope.actionOwner || (scope.readOwner && (background || scope.readOwner.foreground))) return;
    const owner = { foreground: !background }, lease = scope.lease, revision = scope.revision;
    scope.readOwner = owner;
    const owns = () => current() && scope.lease === lease && scope.revision === revision && scope.readOwner === owner;
    if (!background) publish({ loading: true }, lease, revision);
    try {
      if (scope.flight && scope.flight.revision !== revision) {
        // A control retires adoption, not the physical read's slot. Explicit refresh
        // waits for that read to retire before requesting post-control status.
        if (background) return;
        await scope.flight.promise.catch(() => undefined);
        if (!owns()) return;
      }
      let flight = scope.flight;
      if (!flight) {
        flight = { revision, promise: client.readStatus() };
        scope.flight = flight;
        const retire = () => { if (scope.flight === flight) scope.flight = undefined; };
        void flight.promise.then(retire, retire);
      }
      const result = await flight.promise;
      if (!owns()) return;
      const display = prepare(result);
      if (!owns()) return;
      publish(includeLogs ? { ...display, error: undefined } : { statusLabel: display.statusLabel, healthLabel: display.healthLabel, capabilitiesLabel: display.capabilitiesLabel, systemResources: display.systemResources }, lease, revision);
    } catch {
      if (owns() && includeLogs) publish({ error: READ_FAILURE }, lease, revision);
    } finally {
      if (scope.readOwner === owner) {
        scope.readOwner = undefined;
        if (!background && current() && scope.lease === lease) publish({ loading: false }, lease, revision);
      }
    }
  }, [client, current, publish, scope]);

  const runControl = useCallback(async (action: "start" | "stop" | "restart" | "clear-logs") => {
    if (!current() || scope.actionOwner || scope.readOwner?.foreground) return;
    const owner = {}, lease = scope.lease;
    scope.actionOwner = owner; scope.revision += 1; scope.readOwner = undefined;
    const revision = scope.revision;
    const owns = () => current() && scope.lease === lease && scope.actionOwner === owner;
    publish({ loading: true }, lease, revision);
    try {
      const result = await client.controlRuntime(action);
      if (!owns()) return;
      const display = prepare(result);
      if (owns()) publish({ ...display, error: undefined }, lease, revision);
    } catch {
      if (owns()) publish({ error: ACTION_FAILURE }, lease, revision);
    } finally {
      if (scope.actionOwner === owner) {
        scope.actionOwner = undefined;
        if (current() && scope.lease === lease) publish({ loading: false }, lease, revision);
      }
    }
  }, [client, current, publish, scope]);

  useEffect(() => {
    if (!options.enabled) return;
    void runRefresh(true);
    const statusTimer = setInterval(() => { void runRefresh(true); }, 10_000);
    const resourcesTimer = setInterval(() => { void runRefresh(true, false); }, 5_000);
    return () => { clearInterval(statusTimer); clearInterval(resourcesTimer); };
  }, [options.enabled, runRefresh]);
  const setLogsExpanded = useCallback((expanded: boolean) => publish({ logsExpanded: expanded }), [publish]);
  useEffect(() => {
    if (!options.enabled) return;
    const started = () => setLogsExpanded(true);
    window.addEventListener("dataset-preparation-training-started", started);
    return () => window.removeEventListener("dataset-preparation-training-started", started);
  }, [options.enabled, setLogsExpanded]);

  const display = state.scope === scope && options.enabled ? state : initialDisplay();
  return { ...display, onStart: () => runControl("start"), onStop: () => runControl("stop"), onRestart: () => runControl("restart"), onClearLogs: () => runControl("clear-logs"), onRefresh: () => runRefresh(false), setLogsExpanded };
}
