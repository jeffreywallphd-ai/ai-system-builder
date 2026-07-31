export const DESKTOP_MEMORY_DIAGNOSTICS_ENV = "DESKTOP_MEMORY_DIAGNOSTICS";

export interface DesktopMemorySnapshotInput {
  readonly milestone: string;
  readonly component: string;
  readonly detail?: Record<string, unknown>;
}

export interface DesktopMemorySnapshotOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly processLike?: {
    readonly pid?: number;
    readonly platform?: NodeJS.Platform | string;
    readonly arch?: string;
    readonly versions?: Partial<NodeJS.ProcessVersions> & Record<string, string | undefined>;
    readonly uptime?: () => number;
    readonly memoryUsage?: () => Partial<NodeJS.MemoryUsage>;
  };
  readonly now?: () => string;
  readonly log?: (line: string) => void;
}

export interface DesktopMemorySnapshot {
  readonly event: "desktop.memory.snapshot";
  readonly timestamp: string;
  readonly milestone: string;
  readonly component: string;
  readonly process: {
    readonly pid?: number;
    readonly type: string;
    readonly uptimeMs?: number;
  };
  readonly memory?: {
    readonly rss?: number;
    readonly heapTotal?: number;
    readonly heapUsed?: number;
    readonly external?: number;
    readonly arrayBuffers?: number;
  };
  readonly system: {
    readonly platform?: string;
    readonly arch?: string;
    readonly versions: {
      readonly node?: string;
      readonly electron?: string;
      readonly chrome?: string;
    };
  };
  readonly detail?: Record<string, unknown>;
}

export function isDesktopMemoryDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DESKTOP_MEMORY_DIAGNOSTICS_ENV] === "1";
}

function resolveProcessType(processLike: DesktopMemorySnapshotOptions["processLike"]): string {
  const currentProcessType = (process as NodeJS.Process & { readonly type?: string }).type;
  const electronProcessType = processLike?.versions?.electron && currentProcessType;
  return electronProcessType || "node";
}

function compactVersions(versions: DesktopMemorySnapshot["system"]["versions"]): DesktopMemorySnapshot["system"]["versions"] {
  return Object.fromEntries(
    Object.entries(versions).filter(([, value]) => value !== undefined),
  ) as DesktopMemorySnapshot["system"]["versions"];
}

export function createDesktopMemorySnapshot(
  input: DesktopMemorySnapshotInput,
  options: DesktopMemorySnapshotOptions = {},
): DesktopMemorySnapshot {
  const processLike = options.processLike ?? process;
  const memoryUsage = processLike.memoryUsage?.();
  const uptimeSeconds = processLike.uptime?.();

  return {
    event: "desktop.memory.snapshot",
    timestamp: options.now?.() ?? new Date().toISOString(),
    milestone: input.milestone,
    component: input.component,
    process: {
      pid: processLike.pid,
      type: resolveProcessType(processLike),
      uptimeMs: typeof uptimeSeconds === "number" ? Math.round(uptimeSeconds * 1000) : undefined,
    },
    memory: memoryUsage ? {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers,
    } : undefined,
    system: {
      platform: processLike.platform,
      arch: processLike.arch,
      versions: compactVersions({
        node: processLike.versions?.node,
        electron: processLike.versions?.electron,
        chrome: processLike.versions?.chrome,
      }),
    },
    ...(input.detail ? { detail: input.detail } : {}),
  };
}

export function recordDesktopMemorySnapshot(
  input: DesktopMemorySnapshotInput,
  options: DesktopMemorySnapshotOptions = {},
): DesktopMemorySnapshot | undefined {
  if (!isDesktopMemoryDiagnosticsEnabled(options.env)) {
    return undefined;
  }

  const snapshot = createDesktopMemorySnapshot(input, options);
  const log = options.log ?? console.log;
  log(JSON.stringify(snapshot));
  return snapshot;
}
