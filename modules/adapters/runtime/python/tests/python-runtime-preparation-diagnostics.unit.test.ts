import { describe, expect, it } from "../../../../testing/node-test";
import { mapRuntimeDiagnosticToStructuredLogEvent } from "../../../../contracts/runtime";
import {
  createPreparationStageDiagnostics, MAX_PREPARATION_COMMAND_OBSERVATIONS,
  MAX_PREPARATION_OBSERVERS, type PythonRuntimePreparationDiagnostic,
  readPythonRuntimePreparationDiagnostic,
} from "../pythonRuntimePreparationDiagnostics";

describe("passive Python dependency stage diagnostics", () => {
  it("projects a fresh validated copy without invoking untrusted field getters", () => {
    let event!: Readonly<PythonRuntimePreparationDiagnostic>;
    createPreparationStageDiagnostics("worker", row => { event = row; }).enter("probe-torch");
    const clean = readPythonRuntimePreparationDiagnostic(event)!;
    expect(clean).toEqual(event);
    expect(clean).not.toBe(event);
    expect(clean.data).not.toBe(event.data);
    let reads = 0;
    const withGetter = { ...event };
    Object.defineProperty(withGetter, "message", { enumerable: true, get() { reads++; return "private-token"; } });
    expect(readPythonRuntimePreparationDiagnostic(withGetter)).toBeUndefined();
    expect(reads).toBe(0);
    const proxy = new Proxy({ ...event }, { get(target, key, receiver) { return key === "message" ? "private-token" : Reflect.get(target, key, receiver); } });
    expect(JSON.stringify(readPythonRuntimePreparationDiagnostic(proxy))).not.toContain("private-token");
  });

  it("rejects extra data, invalid frontiers and mismatched stage/backend declarations", () => {
    let event!: Readonly<PythonRuntimePreparationDiagnostic>;
    createPreparationStageDiagnostics("worker", row => { event = row; }).enter("probe-torch");
    for (const value of [
      { ...event, error: { errorMessage: "private-error" } },
      { ...event, token: "private-token" },
      { ...event, timestamp: "2026-99-99T00:00:00.000Z" },
      { ...event, operation: "context" },
      { ...event, data: { ...event.data, sequence: 0 } },
      { ...event, data: { ...event.data, sequence: MAX_PREPARATION_COMMAND_OBSERVATIONS + 1 } },
      { ...event, data: { ...event.data, phase: "success" } },
      { ...event, data: { ...event.data, backend: "cpu" } },
      { ...event, data: { ...event.data, output: "private-output" } },
    ]) expect(readPythonRuntimePreparationDiagnostic(value)).toBeUndefined();
  });

  it("records entry before a call and maps to the shared logging vocabulary without claiming success", () => {
    const events: Readonly<PythonRuntimePreparationDiagnostic>[] = [];
    const observer = createPreparationStageDiagnostics("worker", event => events.push(event));
    const token = observer.enter("probe-torch");
    expect(events.map(event => event.data.phase)).toEqual(["entered"]);
    observer.settle(token, "returned");
    expect(events.map(event => event.data.phase)).toEqual(["entered", "returned"]);
    const mapped = mapRuntimeDiagnosticToStructuredLogEvent(events[1]!);
    expect(mapped.event).toBe("runtime.python.dependencies.stage");
    expect(mapped.outcome).toBeUndefined();
    expect(mapped.error).toBeUndefined();
    expect(Object.keys(events[1]!).sort()).toEqual(["component", "data", "event", "level", "message", "operation", "stage", "timestamp", "verbosity"]);
    expect(Object.keys(events[1]!.data).sort()).toEqual(["phase", "sequence"]);
    expect(Object.isFrozen(events[1])).toBe(true);
    expect(Object.isFrozen(events[1]!.data)).toBe(true);
    expect(events[1]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("isolates throwing and rejecting observers while other observers still receive the real frontier", async () => {
    const events: string[] = [];
    const observer = createPreparationStageDiagnostics("context", () => { throw new Error("private-path-and-token"); });
    observer.subscribe(() => Promise.reject(new Error("private-rejected-output")));
    observer.subscribe(event => { events.push(event.data.phase); });
    const token = observer.enter("probe-context-dependencies");
    observer.settle(token, "threw");
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toEqual(["entered", "threw"]);
  });

  it("never replays an entry to a listener that joins an active command", () => {
    const observer = createPreparationStageDiagnostics("context");
    const token = observer.enter("probe-context-dependencies");
    const phases: string[] = [];
    observer.subscribe(event => { phases.push(event.data.phase); });
    expect(phases).toEqual([]);
    observer.settle(token, "returned");
    expect(phases).toEqual(["returned"]);
  });

  it("bounds command and listener observations without granting authority to unknown labels", () => {
    const events: unknown[] = [];
    const observer = createPreparationStageDiagnostics("worker", event => { events.push(event); });
    for (let index = 0; index < MAX_PREPARATION_COMMAND_OBSERVATIONS + 10; index++) {
      const token = observer.enter("verify-torch", "cpu");
      observer.settle(token, "returned");
    }
    expect(events.length).toBe(2 * MAX_PREPARATION_COMMAND_OBSERVATIONS);
    const calls = Array.from({ length: MAX_PREPARATION_OBSERVERS + 4 }, () => 0);
    const second = createPreparationStageDiagnostics("worker");
    calls.forEach((_value, index) => second.subscribe(() => { calls[index]! += 1; }));
    second.enter("probe-torch");
    expect(calls.filter(value => value === 1).length).toBe(MAX_PREPARATION_OBSERVERS);
    expect(calls.filter(value => value === 0).length).toBe(4);
  });

  it("drops invalid operations, labels, backend values and forged or repeated settlements", () => {
    const events: unknown[] = [];
    const observer = createPreparationStageDiagnostics("context", event => { events.push(event); });
    expect(observer.enter("probe-torch")).toBeUndefined();
    expect(observer.enter("private-token" as any)).toBeUndefined();
    expect(observer.enter("probe-context-dependencies", "private-path" as any)).toBeUndefined();
    observer.settle(Symbol(), "returned");
    const token = observer.enter("probe-context-dependencies");
    observer.settle(token, "returned");
    observer.settle(token, "threw");
    const invalid = createPreparationStageDiagnostics("private-operation" as any, event => { events.push(event); });
    invalid.enter("probe-torch");
    expect(events.length).toBe(2);
    expect(JSON.stringify(events)).not.toContain("private-");
  });

  it("closes observer retention and does not manufacture a completion for unfinished commands", () => {
    const phases: string[] = [];
    const observer = createPreparationStageDiagnostics("worker", event => { phases.push(event.data.phase); });
    const token = observer.enter("probe-torch");
    observer.close();
    observer.subscribe(() => { phases.push("unexpected"); });
    observer.settle(token, "returned");
    expect(observer.enter("probe-torch")).toBeUndefined();
    expect(phases).toEqual(["entered"]);
  });
});
