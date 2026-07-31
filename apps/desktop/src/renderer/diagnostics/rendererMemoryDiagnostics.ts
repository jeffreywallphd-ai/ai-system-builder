import { getDesktopApi } from "../lib/desktopApi";

export interface RendererMemorySnapshotInput {
  readonly milestone: string;
  readonly component: string;
  readonly detail?: Record<string, unknown>;
}

export interface RendererMemorySnapshotOptions {
  readonly enabled?: boolean;
  readonly now?: () => string;
  readonly performanceLike?: Performance & {
    readonly memory?: {
      readonly jsHeapSizeLimit?: number;
      readonly totalJSHeapSize?: number;
      readonly usedJSHeapSize?: number;
    };
  };
  readonly log?: (line: string) => void;
}

export function isRendererMemoryDiagnosticsEnabled(): boolean {
  try {
    return getDesktopApi().memoryDiagnosticsEnabled === true;
  } catch {
    return false;
  }
}

export function createRendererMemorySnapshot(
  input: RendererMemorySnapshotInput,
  options: RendererMemorySnapshotOptions = {},
): Record<string, unknown> {
  const performanceLike = (options.performanceLike ?? performance) as RendererMemorySnapshotOptions["performanceLike"];
  const memory = performanceLike?.memory;

  return {
    event: "desktop.renderer.memory.snapshot",
    timestamp: options.now?.() ?? new Date().toISOString(),
    milestone: input.milestone,
    component: input.component,
    process: {
      type: "renderer",
      uptimeMs: Math.round(performanceLike?.now() ?? 0),
    },
    ...(memory ? {
      memory: {
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        totalJSHeapSize: memory.totalJSHeapSize,
        usedJSHeapSize: memory.usedJSHeapSize,
      },
    } : {}),
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

export function recordRendererMemorySnapshot(
  input: RendererMemorySnapshotInput,
  options: RendererMemorySnapshotOptions = {},
): Record<string, unknown> | undefined {
  const enabled = options.enabled ?? isRendererMemoryDiagnosticsEnabled();
  if (!enabled) {
    return undefined;
  }

  const snapshot = createRendererMemorySnapshot(input, options);
  const log = options.log ?? console.log;
  log(JSON.stringify(snapshot));
  return snapshot;
}
