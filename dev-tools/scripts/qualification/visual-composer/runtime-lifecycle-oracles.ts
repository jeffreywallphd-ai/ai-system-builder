/** Fixed synthetic qualification observations; these grant no runtime authority. */
export interface RuntimeReleaseContext {
  readonly workspaceId: string;
  readonly systemId: string;
  readonly revisionId: string;
  readonly buildId: string;
  readonly releaseId: string;
}
const CONTEXT_KEYS = ["workspaceId", "systemId", "revisionId", "buildId", "releaseId"] as const;
const fail = (): never => { throw new Error("Runtime qualification observation is invalid."); };
function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value) && value !== "Unavailable";
}
export function readRuntimeReleaseContext(value: unknown): RuntimeReleaseContext {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== CONTEXT_KEYS.length ||
      CONTEXT_KEYS.some(key => !descriptors[key] || !("value" in descriptors[key]!) || !boundedId(descriptors[key]!.value))) return fail();
  return Object.freeze(Object.fromEntries(CONTEXT_KEYS.map(key => [key, descriptors[key]!.value]))) as unknown as RuntimeReleaseContext;
}
function sameContext(left: RuntimeReleaseContext, right: RuntimeReleaseContext): boolean {
  return CONTEXT_KEYS.every(key => left[key] === right[key]);
}
export function readRuntimeReleasePair(value: unknown): readonly [RuntimeReleaseContext, RuntimeReleaseContext] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== 3 || Object.getOwnPropertyDescriptor(value, "length")?.value !== 2 ||
      !descriptors[0] || !("value" in descriptors[0]) || !descriptors[1] || !("value" in descriptors[1])) return fail();
  const first = readRuntimeReleaseContext(descriptors[0].value), second = readRuntimeReleaseContext(descriptors[1].value);
  if (first.workspaceId !== second.workspaceId || CONTEXT_KEYS.slice(1).some(key => first[key] === second[key])) return fail();
  return Object.freeze([first, second] as const);
}

/** A successful local observation is distinct from physical/native execution. */
export function createOwnedRuntimePageObserver<T extends { isClosed(): boolean }>(ownedPages: () => readonly T[]) {
  let active: { context: RuntimeReleaseContext; page: T } | undefined;
  const retired = new Set<T>();
  const contexts = new Map<string, RuntimeReleaseContext>();
  function current(context: RuntimeReleaseContext): T {
    const expected = readRuntimeReleaseContext(context);
    if (!active || !sameContext(active.context, expected)) return fail();
    return active.page;
  }
  return {
    opened(context: RuntimeReleaseContext, page: T): void {
      const expected = readRuntimeReleaseContext(context), pages = ownedPages();
      if (active || retired.size >= 3 || retired.has(page) || page.isClosed() || pages.length !== 1 || pages[0] !== page) return fail();
      const prior = contexts.get(expected.releaseId);
      if (prior && !sameContext(prior, expected)) return fail();
      if (!prior && contexts.size > 0) {
        if (contexts.size >= 2) return fail();
        readRuntimeReleasePair([contexts.values().next().value, expected]);
      }
      contexts.set(expected.releaseId, expected);
      active = { context: expected, page };
    },
    current,
    stopped(context: RuntimeReleaseContext): void {
      const page = current(context);
      if (!page.isClosed() || ownedPages().length !== 0) return fail();
      retired.add(page);
      active = undefined;
    },
  };
}

export interface ObservedRuntimeLifecycle {
  start(): Promise<void>;
  exercise(attempt: 1 | 2): Promise<void>;
  stop(): Promise<void>;
  afterStop(attempt: 1 | 2): Promise<void>;
  uninstall?(): Promise<void>;
}
/** A failed/pending stop observation cannot admit the next start or uninstall. */
export async function runObservedRuntimeLifecycle(actions: ObservedRuntimeLifecycle, restart = false): Promise<void> {
  if (typeof restart !== "boolean") return fail();
  const attempts = restart ? [1, 2] as const : [1] as const;
  for (const attempt of attempts) {
    await actions.start();
    await actions.exercise(attempt);
    await actions.stop();
    await actions.afterStop(attempt);
  }
  await actions.uninstall?.();
}

export const RUNTIME_QUALIFICATION_MESSAGES = Object.freeze([
  Object.freeze(["Button qualification turn", "Keyboard qualification turn"]),
  Object.freeze(["Isolated system qualification turn"]),
] as const);

export interface RuntimeDataObservation {
  readonly context: RuntimeReleaseContext;
  readonly runtimeInstanceId: string;
  readonly dataBindingId: string;
  readonly sessionId: string;
  readonly userMessages: readonly string[];
  readonly assistantResponses: readonly string[];
  readonly executionCount: number;
}
export function assertRuntimeReleaseBinding(context: RuntimeReleaseContext, release: {
  readonly targetWorkspaceId: string; readonly systemId: string;
  readonly systemRevisionId: string; readonly sourceBuildId: string; readonly releaseId: string;
}): void {
  if (!sameContext(readRuntimeReleaseContext(context), readRuntimeReleaseContext({
    workspaceId: release.targetWorkspaceId, systemId: release.systemId,
    revisionId: release.systemRevisionId, buildId: release.sourceBuildId, releaseId: release.releaseId,
  }))) return fail();
}
export function assertRuntimeDataIsolation(contexts: readonly RuntimeReleaseContext[], observations: readonly RuntimeDataObservation[]): void {
  const expected = readRuntimeReleasePair(contexts);
  if (!Array.isArray(observations) || observations.length !== 2) return fail();
  for (const field of ["runtimeInstanceId", "dataBindingId", "sessionId"] as const) {
    if (observations.some(row => !boundedId(row[field])) || observations[0]![field] === observations[1]![field]) return fail();
  }
  for (let index = 0; index < 2; index++) {
    const context = expected[index]!, rows = observations.filter(row => sameContext(readRuntimeReleaseContext(row.context), context));
    if (rows.length !== 1) return fail();
    const row = rows[0]!, messages = RUNTIME_QUALIFICATION_MESSAGES[index]!;
    if (!Array.isArray(row.userMessages) || !Array.isArray(row.assistantResponses) ||
        row.userMessages.length !== messages.length || row.assistantResponses.length !== messages.length ||
        row.executionCount !== messages.length ||
        messages.some((message, at) => row.userMessages[at] !== message || row.assistantResponses[at] !== `Controlled response to: ${message}`)) return fail();
  }
}
