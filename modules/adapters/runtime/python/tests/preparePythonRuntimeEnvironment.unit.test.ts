import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createPythonRuntimeEnvironmentPreparer } from "../preparePythonRuntimeEnvironment";
import { createPreparationStageDiagnostics } from "../pythonRuntimePreparationDiagnostics";

describe("shared real Python runtime preparation order", () => {
  it("snapshots the complete preparation environment before a diagnostic callback can change caller input", async () => {
    const seen: string[] = [];
    const request = { command: "python", cwd: "worker", env: { SYNTHETIC_VALUE: "original" }, onDiagnosticStage: () => {
      request.command = "changed-python";
      request.cwd = "changed-worker";
      request.env.SYNTHETIC_VALUE = "changed";
    } };
    const prepare = createPythonRuntimeEnvironmentPreparer({
      context: async setup => {
        const diagnostics = createPreparationStageDiagnostics("context", setup.onDiagnosticStage);
        const token = diagnostics.enter("probe-context-dependencies");
        seen.push(`${setup.command}:${setup.cwd}:${setup.env?.SYNTHETIC_VALUE}`);
        diagnostics.settle(token, "returned");
        diagnostics.close();
        return { installed: false, version: "0.34.0" };
      },
      worker: setup => { seen.push(`${setup.command}:${setup.cwd}:${setup.env?.SYNTHETIC_VALUE}`); },
    });
    await prepare(request);
    expect(seen).toEqual(["python:worker:original", "python:worker:original"]);
  });

  it("finishes Context before Worker and preserves captured environment values and the observer", async () => {
    let finish!: (value: { installed: false; version: "0.34.0" }) => void;
    const context = testDouble.fn(() => new Promise<{ installed: false; version: "0.34.0" }>(resolve => { finish = resolve; }));
    const worker = testDouble.fn();
    const prepare = createPythonRuntimeEnvironmentPreparer({ context, worker });
    const env = { PRIVATE_TOKEN: "synthetic-private-token" };
    const observer = testDouble.fn();
    const options = { command: "python", cwd: "worker", env, onDiagnosticStage: observer };
    const pending = prepare(options);
    expect(worker).not.toHaveBeenCalled();
    options.command = "changed-after-start";
    finish({ installed: false, version: "0.34.0" });
    await pending;
    expect(context).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledTimes(1);
    const first = context.mock.calls[0]?.[0];
    expect(worker.mock.calls[0]?.[0]).toBe(first);
    expect(first).toEqual({ command: "python", cwd: "worker", env, onDiagnosticStage: observer });
    expect(first?.env).not.toBe(env);
    expect(first?.env).toEqual(env);
    expect(Object.isFrozen(first?.env)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("preserves the Context failure and never proceeds to Worker", async () => {
    const original = new Error("synthetic-context-failure");
    const worker = testDouble.fn();
    const prepare = createPythonRuntimeEnvironmentPreparer({ context: async () => { throw original; }, worker });
    expect(await prepare({ command: "python" }).catch(error => error)).toBe(original);
    expect(worker).not.toHaveBeenCalled();
  });

  it("preserves the Worker failure after the existing Context result", async () => {
    const original = new Error("synthetic-worker-failure");
    const context = testDouble.fn(async () => ({ installed: false as const, version: "0.34.0" as const }));
    const prepare = createPythonRuntimeEnvironmentPreparer({ context, worker: () => { throw original; } });
    expect(await prepare({ command: "python" }).catch(error => error)).toBe(original);
    expect(context).toHaveBeenCalledTimes(1);
  });

  it("does not add an observer by default or let its getter replace preparation", async () => {
    const context = testDouble.fn(async () => ({ installed: false as const, version: "0.34.0" as const }));
    const worker = testDouble.fn();
    const prepare = createPythonRuntimeEnvironmentPreparer({ context, worker });
    const options = { command: "python" };
    Object.defineProperty(options, "onDiagnosticStage", { get() { throw new Error("private-observer"); } });
    await prepare(options);
    expect(Object.keys(context.mock.calls[0]?.[0] ?? {}).sort()).toEqual(["command", "cwd", "env"]);
    expect(worker).toHaveBeenCalledTimes(1);
  });
});
