import type { LoggingPort } from "../../../application/ports/logging";

export type DesktopFeatureLifecyclePolicy =
  "always-resident" | "retained" | "disposable" | "explicit-unload-only";
export type DesktopFeatureDisposeReason =
  | "page-unmount"
  | "idle-timeout"
  | "explicit-user-action"
  | "explicit-dev-action"
  | "feature-release"
  | "test";

export interface FeatureDisposeBlock {
  readonly blockedReason: string;
  readonly activeTaskCount?: number;
}

export interface DisposableFeature {
  dispose?: (reason?: DesktopFeatureDisposeReason) => void | Promise<void>;
  canDispose?: (
    reason?: DesktopFeatureDisposeReason,
  ) =>
    FeatureDisposeBlock | undefined | Promise<FeatureDisposeBlock | undefined>;
}

export interface DesktopFeatureLifecycleStateEntry {
  readonly featureKey: string;
  readonly policy: DesktopFeatureLifecyclePolicy;
  readonly loaded: boolean;
  readonly idle: boolean;
  readonly idleTimeoutScheduled: boolean;
}

export interface DesktopFeatureDisposeResult {
  readonly featureKey: string;
  readonly disposed: boolean;
  readonly policy?: DesktopFeatureLifecyclePolicy;
  readonly alreadyDisposed?: boolean;
  readonly blockedReason?: string;
  readonly activeTaskCount?: number;
}

export interface RegisterLifecycleFeatureOptions<TFeature extends object> {
  readonly featureKey: string;
  readonly milestoneBase: string;
  readonly policy: DesktopFeatureLifecyclePolicy;
  readonly importFeature: () => Promise<() => TFeature | Promise<TFeature>>;
  readonly idleTimeoutMs?: number;
}

export interface DesktopFeatureLifecycleRegistryOptions {
  readonly loggingPort: LoggingPort;
  readonly recordMilestone?: (
    milestone: string,
    detail?: Record<string, unknown>,
  ) => void;
  readonly defaultIdleTimeoutMs?: number;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

interface FeatureEntry<TFeature extends object = object> {
  readonly featureKey: string;
  readonly milestoneBase: string;
  readonly policy: DesktopFeatureLifecyclePolicy;
  readonly importFeature: () => Promise<() => TFeature | Promise<TFeature>>;
  readonly idleTimeoutMs: number;
  promise?: Promise<TFeature>;
  idle?: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function isDisposableFeature(value: object): value is DisposableFeature {
  return "dispose" in value || "canDispose" in value;
}

function readSafeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error))
    return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" && SAFE_ERROR_CODE_PATTERN.test(code)
    ? code
    : undefined;
}

export function createDesktopFeatureFailureDetail(error: unknown): {
  readonly errorName: string;
  readonly errorCode?: string;
} {
  const errorCode = readSafeErrorCode(error);
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    ...(errorCode ? { errorCode } : {}),
  };
}

export function createDesktopFeatureLifecycleRegistry(
  options: DesktopFeatureLifecycleRegistryOptions,
) {
  const entries = new Map<string, FeatureEntry>();
  const setTimer = options.setTimeoutFn ?? setTimeout;
  const clearTimer = options.clearTimeoutFn ?? clearTimeout;
  const record = (milestone: string, detail?: Record<string, unknown>) =>
    options.recordMilestone?.(milestone, detail);

  const clearIdleTimer = (
    entry: FeatureEntry,
    reason: DesktopFeatureDisposeReason | "feature-reuse",
  ) => {
    if (!entry.idleTimer) return;
    clearTimer(entry.idleTimer);
    entry.idleTimer = undefined;
    entry.idle = false;
    record("desktop.host.feature.idle.cancelled", {
      featureKey: entry.featureKey,
      reason,
    });
  };

  async function disposeFeature(
    featureKey: string,
    reason: DesktopFeatureDisposeReason = "explicit-dev-action",
  ): Promise<DesktopFeatureDisposeResult> {
    const entry = entries.get(featureKey);
    record("desktop.host.feature.dispose.requested", { featureKey, reason });
    if (!entry) {
      record("desktop.host.feature.dispose.blocked", {
        featureKey,
        reason,
        blockedReason: "unknown-feature",
      });
      return { featureKey, disposed: false, blockedReason: "unknown-feature" };
    }
    if (entry.policy !== "disposable") {
      const blockedReason = `policy-${entry.policy}`;
      record("desktop.host.feature.dispose.blocked", {
        featureKey,
        reason,
        blockedReason,
        policy: entry.policy,
      });
      return {
        featureKey,
        disposed: false,
        policy: entry.policy,
        blockedReason,
      };
    }
    clearIdleTimer(entry, reason);
    const loaded = entry.promise
      ? await entry.promise.catch(() => undefined)
      : undefined;
    if (!loaded) {
      record("desktop.host.feature.dispose.blocked", {
        featureKey,
        reason,
        blockedReason: "already-disposed",
      });
      return {
        featureKey,
        disposed: false,
        policy: entry.policy,
        alreadyDisposed: true,
      };
    }

    try {
      if (isDisposableFeature(loaded) && loaded.canDispose) {
        const block = await loaded.canDispose(reason);
        if (block) {
          record("desktop.host.feature.dispose.blocked", {
            featureKey,
            reason,
            blockedReason: block.blockedReason,
            activeTaskCount: block.activeTaskCount,
          });
          record("desktop.host.feature.dispose.completed", {
            featureKey,
            reason,
            blockedReason: block.blockedReason,
            activeTaskCount: block.activeTaskCount,
          });
          return {
            featureKey,
            disposed: false,
            policy: entry.policy,
            blockedReason: block.blockedReason,
            activeTaskCount: block.activeTaskCount,
          };
        }
      }
      record("desktop.host.feature.dispose.started", { featureKey, reason });
      if (isDisposableFeature(loaded) && loaded.dispose)
        await loaded.dispose(reason);
      entry.promise = undefined;
      entry.idle = false;
      record("desktop.host.feature.memoized.cleared", { featureKey, reason });
      record("desktop.host.feature.dispose.completed", { featureKey, reason });
      return { featureKey, disposed: true, policy: entry.policy };
    } catch (error) {
      entry.promise = undefined;
      entry.idle = false;
      record("desktop.host.feature.memoized.cleared", { featureKey, reason });
      record("desktop.host.feature.dispose.failed", { featureKey, reason });
      await options.loggingPort.log({
        timestamp: new Date().toISOString(),
        level: "warn",
        verbosity: "normal",
        event: "desktop.host.feature.dispose.failed",
        message: `Desktop feature disposal failed for ${featureKey}; feature will be recreated on next use.`,
        component: "desktop-host-feature-lifecycle",
        data: {
          featureKey,
          reason,
          errorName: error instanceof Error ? error.name : typeof error,
        },
      });
      return {
        featureKey,
        disposed: false,
        policy: entry.policy,
        blockedReason: "dispose-failed",
      };
    }
  }

  function registerAsyncFeature<TFeature extends object>(
    registration: RegisterLifecycleFeatureOptions<TFeature>,
  ): () => Promise<TFeature> {
    const entry: FeatureEntry<TFeature> = {
      featureKey: registration.featureKey,
      milestoneBase: registration.milestoneBase,
      policy: registration.policy,
      importFeature: registration.importFeature,
      idleTimeoutMs:
        registration.idleTimeoutMs ??
        options.defaultIdleTimeoutMs ??
        DEFAULT_IDLE_TIMEOUT_MS,
    };
    entries.set(registration.featureKey, entry as FeatureEntry);
    return async () => {
      clearIdleTimer(entry, "feature-reuse");
      if (entry.promise) return entry.promise;
      let stage: "import" | "compose" = "import";
      const loadPromise = (async () => {
        record(`${entry.milestoneBase}.import.before`);
        const compose = await entry.importFeature();
        record(`${entry.milestoneBase}.import.after`);
        stage = "compose";
        record(`${entry.milestoneBase}.compose.before`);
        const value = await compose();
        record(`${entry.milestoneBase}.compose.after`);
        return value;
      })();
      entry.promise = loadPromise;
      try {
        return await loadPromise;
      } catch (error) {
        if (entry.promise === loadPromise) entry.promise = undefined;
        const detail = {
          featureKey: entry.featureKey,
          stage,
          ...createDesktopFeatureFailureDetail(error),
        };
        record("desktop.host.feature.load.failed", detail);
        await options.loggingPort.log({
          timestamp: new Date().toISOString(),
          level: "error",
          verbosity: "normal",
          event: "desktop.host.feature.load.failed",
          message: `Desktop feature ${entry.featureKey} could not be loaded; the next request may retry.`,
          component: "desktop-host-feature-lifecycle",
          data: detail,
        });
        throw error;
      }
    };
  }

  function markFeatureIdle(
    featureKey: string,
    reason: DesktopFeatureDisposeReason = "page-unmount",
  ): boolean {
    const entry = entries.get(featureKey);
    if (!entry || entry.policy !== "disposable" || !entry.promise) return false;
    clearIdleTimer(entry, reason);
    entry.idle = true;
    record("desktop.host.feature.idle.marked", { featureKey, reason });
    entry.idleTimer = setTimer(() => {
      entry.idleTimer = undefined;
      void disposeFeature(featureKey, "idle-timeout");
    }, entry.idleTimeoutMs);
    const maybeNodeTimer = entry.idleTimer as { unref?: () => void };
    maybeNodeTimer.unref?.();
    return true;
  }

  async function disposeIdleFeatures(
    reason: DesktopFeatureDisposeReason = "explicit-dev-action",
  ): Promise<DesktopFeatureDisposeResult[]> {
    const idleKeys = Array.from(entries.values())
      .filter((entry) => entry.idle && entry.policy === "disposable")
      .map((entry) => entry.featureKey);
    const results: DesktopFeatureDisposeResult[] = [];
    for (const key of idleKeys) results.push(await disposeFeature(key, reason));
    return results;
  }

  function getFeatureLifecycleState(): DesktopFeatureLifecycleStateEntry[] {
    return Array.from(entries.values()).map((entry) => ({
      featureKey: entry.featureKey,
      policy: entry.policy,
      loaded: Boolean(entry.promise),
      idle: Boolean(entry.idle),
      idleTimeoutScheduled: Boolean(entry.idleTimer),
    }));
  }

  return {
    registerAsyncFeature,
    disposeFeature,
    markFeatureIdle,
    disposeIdleFeatures,
    getFeatureLifecycleState,
  };
}

export type DesktopFeatureLifecycleRegistry = ReturnType<
  typeof createDesktopFeatureLifecycleRegistry
>;
