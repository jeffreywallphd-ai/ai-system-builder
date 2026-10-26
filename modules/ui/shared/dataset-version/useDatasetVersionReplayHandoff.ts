import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DatasetVersionReproduction } from "../../../contracts/dataset";
import type { DatasetVersionReplayContext } from "./datasetVersionReplay";
import { useOptionalNotificationCenter } from "../notifications/NotificationProvider";

export type DatasetVersionReplaySelection = Pick<DatasetVersionReplayContext, "workspaceId" | "selectedVersion" | "datasetArtifactKey">;
export interface DatasetVersionReplayRequest {
  readonly nonce: number;
  readonly workspaceId: string;
  readonly reproduction: DatasetVersionReproduction;
  readonly selection: DatasetVersionReplaySelection;
}
export interface DatasetVersionReplayHandoff {
  readonly request?: DatasetVersionReplayRequest;
  enqueue(reproduction: DatasetVersionReproduction, selection: DatasetVersionReplaySelection): Promise<boolean>;
  claim(request: DatasetVersionReplayRequest, consumer: object): boolean;
  isCurrent(request: DatasetVersionReplayRequest, consumer: object): boolean;
  finish(request: DatasetVersionReplayRequest, consumer: object, applied: boolean): void;
  cancel(request: DatasetVersionReplayRequest, consumer: object): void;
}
interface Pending {
  request: DatasetVersionReplayRequest;
  consumer?: object;
  resolve(applied: boolean): void;
}
// Capture data without invoking getters/toJSON or retaining caller aliases.
// Recipe data keeps the pure validator's strict JSON rules. Normalized record
// objects may have undefined optional properties; only selection omits those.
function captureJson<T>(input: T, omitOptionalUndefined = false): T {
  let nodes = 0;
  let characters = 0;
  const count = (text: string) => { if ((characters += text.length) > 1024 * 1024) throw new Error(); };
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > 20_000 || depth > 16) throw new Error();
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { count(value); return value; }
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object") throw new Error();
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error();
    const keys = Reflect.ownKeys(value);
    if (keys.length > 20_001) throw new Error();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key) || (array && !/^(0|[1-9][0-9]*)$/.test(key))) throw new Error();
      count(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable) throw new Error();
      if (!array && omitOptionalUndefined && descriptor.value === undefined) continue;
      result[key] = visit(descriptor.value, depth + 1);
    }
    if (!array) return Object.freeze(result);
    if (Object.keys(result).length !== value.length) throw new Error();
    return Object.freeze(Array.from({ length: value.length }, (_, index) => {
      if (!Object.prototype.hasOwnProperty.call(result, String(index))) throw new Error();
      return result[String(index)];
    }));
  };
  const result = visit(input, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024) throw new Error();
  return result as T;
}
/** Page-owned ephemeral delivery, never authorization or proof of source bytes. */
export function useDatasetVersionReplayHandoff(workspaceId: string, preparationActive: boolean, openPreparation: () => void): DatasetVersionReplayHandoff {
  const [request, setRequest] = useState<DatasetVersionReplayRequest>();
  const pending = useRef<Pending | undefined>(undefined);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const scope = useRef<{ workspaceId: string; active: boolean } | undefined>(undefined);
  const open = useRef(openPreparation);
  const notifications = useOptionalNotificationCenter();
  const notificationCenter = useRef(notifications);
  const retire = useCallback((item: Pending, applied: boolean) => {
    if (pending.current !== item) return;
    pending.current = undefined;
    if (mounted.current) setRequest(undefined);
    item.resolve(applied);
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scope.current = undefined;
      if (pending.current) retire(pending.current, false);
    };
  }, [retire]);
  // Parent layout effects finish before consumer passive acknowledgment. A
  // workspace or tab transition therefore retires the request before success.
  useLayoutEffect(() => {
    scope.current = { workspaceId, active: preparationActive };
    open.current = openPreparation;
    notificationCenter.current = notifications;
    const item = pending.current;
    if (item && (item.request.workspaceId !== workspaceId || !preparationActive)) retire(item, false);
  });
  const enqueue = useCallback((reproduction: DatasetVersionReproduction, selection: DatasetVersionReplaySelection): Promise<boolean> => {
    const current = scope.current;
    if (!mounted.current || !current) return Promise.resolve(false);
    let captured: DatasetVersionReproduction, selected: DatasetVersionReplaySelection;
    try {
      captured = captureJson(reproduction);
      selected = captureJson(selection, true);
      if (selected.workspaceId !== current.workspaceId || typeof captured.versionId !== "string" || !captured.versionId || captured.versionId !== selected.selectedVersion.versionId) return Promise.resolve(false);
    } catch { return Promise.resolve(false); }
    if (pending.current) retire(pending.current, false);
    const next = Object.freeze({ nonce: ++sequence.current, workspaceId: current.workspaceId, reproduction: captured, selection: selected });
    return new Promise<boolean>(resolve => {
      const item = { request: next, resolve };
      pending.current = item;
      setRequest(next);
      try { open.current(); } catch { retire(item, false); }
    });
  }, [retire]);
  const matches = useCallback((candidate: DatasetVersionReplayRequest) => mounted.current &&
    pending.current?.request === candidate && scope.current?.workspaceId === candidate.workspaceId && scope.current?.active === true, []);
  const claim = useCallback((candidate: DatasetVersionReplayRequest, consumer: object) => {
    if (!consumer || typeof consumer !== "object" || !matches(candidate)) return false;
    const item = pending.current!;
    if (item.consumer !== undefined && item.consumer !== consumer) return false;
    item.consumer = consumer;
    return true;
  }, [matches]);
  const isCurrent = useCallback((candidate: DatasetVersionReplayRequest, consumer: object) =>
    matches(candidate) && pending.current!.consumer !== undefined && pending.current!.consumer === consumer, [matches]);
  const finish = useCallback((candidate: DatasetVersionReplayRequest, consumer: object, applied: boolean) => {
    if (!isCurrent(candidate, consumer)) return;
    const item = pending.current!;
    retire(item, applied);
    if (applied) notificationCenter.current?.publish({
      workspaceId: candidate.workspaceId, source: "dataset-version-reuse", tone: "success",
      message: "Saved settings are ready. Review the setup before preparing a dataset.",
    });
  }, [isCurrent, retire]);
  const cancel = useCallback((candidate: DatasetVersionReplayRequest, consumer: object) => {
    if (!consumer || typeof consumer !== "object") return;
    const item = pending.current;
    if (item?.request === candidate && (item.consumer === undefined || item.consumer === consumer)) retire(item, false);
  }, [retire]);
  return { request, enqueue, claim, isCurrent, finish, cancel };
}

/** The host supplies its complete validated synchronous setter transaction.
 * Success is acknowledged from the next committed render, never from enqueue.
 */
export function useDatasetVersionReplayConsumer(handoff: DatasetVersionReplayHandoff | undefined,
  sourceStatus: "loading" | "ready" | "failed", apply: (request: DatasetVersionReplayRequest) => boolean): () => void {
  const consumer = useRef<object>({});
  const lifecycle = useRef(0);
  const appliedOnce = useRef<DatasetVersionReplayRequest | undefined>(undefined);
  const [applied, setApplied] = useState<DatasetVersionReplayRequest>();
  const request = handoff?.request;
  const claim = handoff?.claim, current = handoff?.isCurrent, finish = handoff?.finish, cancel = handoff?.cancel;
  useEffect(() => {
    if (!request) { appliedOnce.current = undefined; setApplied(undefined); }
  }, [request]);
  useEffect(() => {
    if (!request || !claim || !cancel) return;
    ++lifecycle.current;
    claim(request, consumer.current);
    return () => {
      const closing = ++lifecycle.current;
      // StrictMode probes a mounted effect twice. A replacement setup cancels
      // this cleanup ticket; real unmount retains it and retires the request.
      queueMicrotask(() => { if (lifecycle.current === closing) cancel(request, consumer.current); });
    };
  }, [request, claim, cancel]);
  useEffect(() => {
    if (!request || !current || !finish || !current(request, consumer.current) || appliedOnce.current === request) return;
    if (sourceStatus === "loading") return;
    let applied = false;
    if (sourceStatus === "ready") {
      try { applied = apply(request); } catch { /* Fixed host failure, never log saved payloads. */ }
    }
    if (!applied) { finish(request, consumer.current, false); return; }
    appliedOnce.current = request;
    setApplied(request);
  }, [request, sourceStatus, apply, current, finish]);
  useEffect(() => {
    if (request && applied === request && current?.(request, consumer.current)) finish?.(request, consumer.current, true);
  }, [request, applied, current, finish]);
  return useCallback(() => { if (request) cancel?.(request, consumer.current); }, [request, cancel]);
}
