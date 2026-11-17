import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readRuntimeReleaseContext, readRuntimeReleasePair, assertRuntimeReleaseBinding,
  createOwnedRuntimePageObserver, runObservedRuntimeLifecycle, assertRuntimeDataIsolation,
  RUNTIME_QUALIFICATION_MESSAGES, type RuntimeDataObservation, type ObservedRuntimeLifecycle,
} from "../visual-composer/runtime-lifecycle-oracles";

const a = readRuntimeReleaseContext({ workspaceId: "workspace.fixture", systemId: "system.a", revisionId: "revision.a", buildId: "build.a", releaseId: "release.a" });
const b = readRuntimeReleaseContext({ ...a, systemId: "system.b", revisionId: "revision.b", buildId: "build.b", releaseId: "release.b" });
const contexts = readRuntimeReleasePair([a, b]);
class PageFixture {
  closed = false;
  isClosed() { return this.closed; }
}
function observations(): RuntimeDataObservation[] {
  return contexts.map((context, index) => ({
    context, runtimeInstanceId: `runtime.${index}`, dataBindingId: `sqlite:runtime.${index}`, sessionId: `session.${index}`,
    userMessages: [...RUNTIME_QUALIFICATION_MESSAGES[index]!],
    assistantResponses: RUNTIME_QUALIFICATION_MESSAGES[index]!.map(message => `Controlled response to: ${message}`),
    executionCount: RUNTIME_QUALIFICATION_MESSAGES[index]!.length,
  }));
}
function actions(trace: string[]): ObservedRuntimeLifecycle {
  return {
    start: async () => { trace.push("start"); }, exercise: async n => { trace.push(`exercise${n}`); },
    stop: async () => { trace.push("stop"); }, afterStop: async n => { trace.push(`observed${n}`); },
    uninstall: async () => { trace.push("uninstall"); },
  };
}

test("public release observations copy and freeze all five exact identities", () => {
  const source = { ...a }, result = readRuntimeReleaseContext(source);
  source.releaseId = "release.changed";
  assert.equal(result.releaseId, a.releaseId);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(contexts));
  assert.deepEqual(Object.keys(result), ["workspaceId", "systemId", "revisionId", "buildId", "releaseId"]);
});

test("missing, extra, accessor, symbol and unbounded context values cannot pass", () => {
  let invoked = false;
  const accessor = { ...a };
  Object.defineProperty(accessor, "releaseId", { get() { invoked = true; return a.releaseId; } });
  const missing: Record<string, unknown> = { ...a }; delete missing.buildId;
  for (const value of [null, [], missing, { ...a, extra: true }, { ...a, [Symbol("extra")]: true }, accessor,
    ...["", "Unavailable", "release\nother", "../release", "x".repeat(161), 1].map(releaseId => ({ ...a, releaseId }))]) {
    assert.throws(() => readRuntimeReleaseContext(value), /observation is invalid/);
  }
  assert.equal(invoked, false);
});

test("the two-system pair rejects another workspace and every reused immutable identity", () => {
  for (const key of ["systemId", "revisionId", "buildId", "releaseId"] as const) {
    assert.throws(() => readRuntimeReleasePair([a, { ...b, [key]: a[key] }]));
  }
  assert.throws(() => readRuntimeReleasePair([a, { ...b, workspaceId: "workspace.other" }]));
  for (const value of [[], [a], [a, b, a], [a, a], { 0: a, 1: b, length: 2 }]) assert.throws(() => readRuntimeReleasePair(value));
});

test("sparse, accessor and decorated context arrays fail without calling a getter", () => {
  let invoked = false;
  const accessor = [a, b]; Object.defineProperty(accessor, "0", { get() { invoked = true; return a; } });
  const decorated = Object.assign([a, b], { extra: true });
  for (const value of [new Array(2), accessor, decorated]) assert.throws(() => readRuntimeReleasePair(value));
  assert.equal(invoked, false);
});

test("repository release identity must match the observed workspace, system, revision, build and release", () => {
  const release = { targetWorkspaceId: a.workspaceId, systemId: a.systemId, systemRevisionId: a.revisionId, sourceBuildId: a.buildId, releaseId: a.releaseId };
  assertRuntimeReleaseBinding(a, release);
  for (const key of Object.keys(release) as (keyof typeof release)[]) assert.throws(() => assertRuntimeReleaseBinding(a, { ...release, [key]: "wrong.identity" }));
});

test("each stopped runtime retires its exact page before a distinct A/B/A replacement", () => {
  let windows: PageFixture[] = [];
  const observer = createOwnedRuntimePageObserver(() => windows);
  const seen: PageFixture[] = [];
  for (const context of [a, b, a]) {
    const page = new PageFixture(); windows = [page]; observer.opened(context, page);
    assert.equal(observer.current(context), page); assert.ok(!seen.includes(page));
    page.closed = true; windows = []; observer.stopped(context); seen.push(page);
    assert.throws(() => observer.current(context));
  }
});

test("capture rejects missing, additional, closed, swapped or already retired pages", () => {
  let windows: PageFixture[] = [];
  const observer = createOwnedRuntimePageObserver(() => windows), page = new PageFixture(), other = new PageFixture();
  assert.throws(() => observer.opened(a, page));
  windows = [page, other]; assert.throws(() => observer.opened(a, page));
  windows = [other]; assert.throws(() => observer.opened(a, page));
  windows = [page]; page.closed = true; assert.throws(() => observer.opened(a, page));
  page.closed = false; observer.opened(a, page);
  assert.throws(() => observer.opened(b, other));
  page.closed = true; windows = []; observer.stopped(a);
  page.closed = false; windows = [page]; assert.throws(() => observer.opened(b, page));
});

test("wrong context, open page or a lingering owned window cannot clear the active observation", () => {
  const page = new PageFixture(); let windows = [page];
  const observer = createOwnedRuntimePageObserver(() => windows); observer.opened(a, page);
  assert.throws(() => observer.stopped(b)); assert.throws(() => observer.current(b));
  assert.throws(() => observer.stopped(a));
  page.closed = true; assert.throws(() => observer.stopped(a));
  windows = [new PageFixture()]; assert.throws(() => observer.stopped(a));
  assert.equal(observer.current(a), page);
  windows = []; observer.stopped(a);
});

test("observations reject a changed immutable release, third system or fourth admission", () => {
  let windows: PageFixture[] = [];
  const observer = createOwnedRuntimePageObserver(() => windows);
  function observe(context: typeof a) {
    const page = new PageFixture(); windows = [page]; observer.opened(context, page);
    page.closed = true; windows = []; observer.stopped(context);
  }
  observe(a);
  windows = [new PageFixture()]; assert.throws(() => observer.opened({ ...a, revisionId: b.revisionId }, windows[0]!));
  observe(b);
  windows = [new PageFixture()]; assert.throws(() => observer.opened({ ...a, releaseId: "release.third" }, windows[0]!));
  observe(a);
  windows = [new PageFixture()]; assert.throws(() => observer.opened(a, windows[0]!));
});

test("default lifecycle keeps one Start, exercise, Stop, observation and Uninstall", async () => {
  const trace: string[] = []; await runObservedRuntimeLifecycle(actions(trace));
  assert.deepEqual(trace, ["start", "exercise1", "stop", "observed1", "uninstall"]);
});

test("nested B must stop and be observed before primary A restarts", async () => {
  const trace: string[] = [], primary = actions(trace);
  primary.afterStop = async n => {
    trace.push(`observed${n}`);
    if (n === 1) {
      const secondary = actions(trace); delete secondary.uninstall;
      await runObservedRuntimeLifecycle(secondary);
    }
  };
  await runObservedRuntimeLifecycle(primary, true);
  assert.deepEqual(trace, ["start", "exercise1", "stop", "observed1", "start", "exercise1", "stop", "observed1", "start", "exercise2", "stop", "observed2", "uninstall"]);
});

test("a pending stop observation prevents restart and uninstall", async () => {
  const trace: string[] = []; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), run = actions(trace);
  run.afterStop = async n => { trace.push(`observing${n}`); if (n === 1) await gate; trace.push(`observed${n}`); };
  const result = runObservedRuntimeLifecycle(run, true);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(trace, ["start", "exercise1", "stop", "observing1"]);
  release(); await result;
  assert.deepEqual(trace.slice(5), ["start", "exercise2", "stop", "observing2", "observed2", "uninstall"]);
});

test("every rejected lifecycle step stops further actions without swallowing the failure", async () => {
  const stages = ["start", "exercise", "stop", "afterStop", "uninstall"] as const;
  for (let index = 0; index < stages.length; index++) {
    const trace: string[] = [], run = actions(trace), failure = new Error("Synthetic failure");
    run[stages[index]!] = async () => { trace.push("failed"); throw failure; };
    await assert.rejects(runObservedRuntimeLifecycle(run), error => error === failure);
    assert.equal(trace.length, index + 1); assert.equal(trace[trace.length - 1], "failed");
  }
});

test("falsy rejected stop observations also prevent all later starts", async () => {
  for (const reason of [undefined, null, false, 0, ""]) {
    const trace: string[] = [], run = actions(trace);
    run.afterStop = async () => { throw reason; };
    await assert.rejects(runObservedRuntimeLifecycle(run, true), error => error === reason);
    assert.deepEqual(trace, ["start", "exercise1", "stop"]);
  }
});

test("two stores retain exactly the original A button/keyboard and isolated B conversation", () => {
  const rows = observations(), before = JSON.stringify(rows);
  assertRuntimeDataIsolation(contexts, rows); assertRuntimeDataIsolation(contexts, [...rows].reverse());
  assert.equal(JSON.stringify(rows), before);
});

test("missing, duplicate or additional release stores cannot pass", () => {
  const rows = observations();
  for (const value of [[], rows.slice(0, 1), [rows[0]!, rows[0]!], [...rows, rows[0]!], [rows[0]!, { ...rows[1]!, context: a }]]) {
    assert.throws(() => assertRuntimeDataIsolation(contexts, value));
  }
});

test("different releases must use distinct runtime, database and conversation session identities", () => {
  for (const key of ["runtimeInstanceId", "dataBindingId", "sessionId"] as const) {
    const rows = observations(); rows[1] = { ...rows[1]!, [key]: rows[0]![key] };
    assert.throws(() => assertRuntimeDataIsolation(contexts, rows));
  }
});

test("swapped transcripts, missing responses, cross-store messages and false execution counts fail", () => {
  const rows = observations();
  const wrongRows: RuntimeDataObservation[] = [
    { ...rows[0]!, userMessages: rows[1]!.userMessages },
    { ...rows[0]!, assistantResponses: rows[1]!.assistantResponses },
    { ...rows[0]!, userMessages: [...rows[0]!.userMessages, ...rows[1]!.userMessages] },
    { ...rows[0]!, assistantResponses: [] }, { ...rows[0]!, executionCount: 1 },
    { ...rows[0]!, executionCount: 3 }, { ...rows[0]!, context: { ...a, buildId: b.buildId } },
  ];
  for (const wrong of wrongRows) assert.throws(() => assertRuntimeDataIsolation(contexts, [wrong, rows[1]!]));
});
