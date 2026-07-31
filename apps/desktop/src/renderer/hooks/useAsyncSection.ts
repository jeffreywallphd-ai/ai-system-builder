import { useCallback, useEffect, useRef, useState } from "react";

import { recordSectionLoadMilestone, type SectionLoadDiagnosticDetail } from "../diagnostics/sectionLoadDiagnostics";

export interface AsyncSectionState<TData> {
  readonly status: "idle" | "loading" | "success" | "error";
  readonly data?: TData;
  readonly error?: string;
  readonly load: (trigger?: string) => Promise<TData | undefined>;
  readonly retry: () => Promise<TData | undefined>;
}

export interface UseAsyncSectionOptions<TData> {
  readonly pageKey: string;
  readonly sectionKey: string;
  readonly initialTrigger?: string;
  readonly activePage?: string;
  readonly workspaceStatus?: string;
  readonly loadOnMount?: boolean;
  readonly loader: () => Promise<TData>;
}

export function useAsyncSection<TData>({
  pageKey,
  sectionKey,
  initialTrigger = "initial",
  activePage,
  workspaceStatus,
  loadOnMount = false,
  loader,
}: UseAsyncSectionOptions<TData>): AsyncSectionState<TData> {
  const [status, setStatus] = useState<AsyncSectionState<TData>["status"]>("idle");
  const [data, setData] = useState<TData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const lastTriggerRef = useRef(initialTrigger);
  const sequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const detailRef = useRef<(trigger: string) => SectionLoadDiagnosticDetail>(() => ({ pageKey, sectionKey, trigger: "unmount" }));

  const detail = useCallback((trigger: string): SectionLoadDiagnosticDetail => ({
    pageKey,
    sectionKey,
    trigger,
    ...(activePage ? { activePage } : {}),
    ...(workspaceStatus ? { workspaceStatus } : {}),
  }), [activePage, pageKey, sectionKey, workspaceStatus]);

  detailRef.current = detail;

  const load = useCallback(async (trigger = initialTrigger) => {
    const sequence = ++sequenceRef.current;
    lastTriggerRef.current = trigger;
    setStatus("loading");
    setError(undefined);
    inFlightRef.current = true;
    recordSectionLoadMilestone("renderer.section.load.start", detail(trigger));
    try {
      const loaded = await loader();
      if (!mountedRef.current || sequence !== sequenceRef.current) return undefined;
      inFlightRef.current = false;
      setData(loaded);
      setStatus("success");
      recordSectionLoadMilestone("renderer.section.load.resolved", detail(trigger));
      return loaded;
    } catch (cause) {
      if (!mountedRef.current || sequence !== sequenceRef.current) return undefined;
      inFlightRef.current = false;
      const message = cause instanceof Error ? cause.message : "Section failed to load.";
      setError(message);
      setStatus("error");
      recordSectionLoadMilestone("renderer.section.load.failed", detail(trigger));
      return undefined;
    }
  }, [detail, initialTrigger, loader]);

  const retry = useCallback(async () => {
    const trigger = lastTriggerRef.current || "retry";
    recordSectionLoadMilestone("renderer.section.load.retry", detail("retry"));
    return load(trigger);
  }, [detail, load]);

  useEffect(() => {
    mountedRef.current = true;
    if (!loadOnMount) {
      recordSectionLoadMilestone("renderer.section.load.skipped", detail(initialTrigger));
      return;
    }
    void load(initialTrigger);
  }, [detail, initialTrigger, load, loadOnMount]);

  useEffect(() => () => {
    const hadInFlightRequest = inFlightRef.current;
    const cleanupDetail = detailRef.current;
    if (hadInFlightRequest) recordSectionLoadMilestone("renderer.section.cleanup.started", cleanupDetail("unmount"));
    mountedRef.current = false;
    sequenceRef.current += 1;
    inFlightRef.current = false;
    if (hadInFlightRequest) {
      recordSectionLoadMilestone("renderer.section.request.ignored-after-unmount", cleanupDetail("unmount"));
      recordSectionLoadMilestone("renderer.section.cleanup.completed", cleanupDetail("unmount"));
    }
  }, []);

  return { status, data, error, load, retry };
}
