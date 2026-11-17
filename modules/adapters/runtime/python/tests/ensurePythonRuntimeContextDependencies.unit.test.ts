import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";

import {
  ensurePythonRuntimeContextDependencies,
  PythonRuntimeContextDependencyError,
} from "../ensurePythonRuntimeContextDependencies";
import type { PythonRuntimePreparationDiagnostic } from "../pythonRuntimePreparationDiagnostics";

type CommandCallback = (error: any, stdout: string, stderr: string) => void;

function createExecFileSequence(
  sequence: Array<{
    error?: any;
    stdout?: string;
    stderr?: string;
  }>,
) {
  return testDouble.fn(
    (
      _command: string,
      _args: readonly string[],
      _options: unknown,
      callback: CommandCallback,
    ) => {
      const next = sequence.shift();
      if (!next) throw new Error("Unexpected dependency command.");
      queueMicrotask(() =>
        callback(next.error ?? null, next.stdout ?? "", next.stderr ?? ""),
      );
    },
  );
}

describe("ensurePythonRuntimeContextDependencies", () => {
  it("snapshots all Context inputs before an entered observer can redirect its probe or install", async () => {
    const calls: { command: string; cwd?: string; timeout?: number; value?: string; args: readonly string[] }[] = [];
    let count = 0;
    const options = { command: "python", cwd: "context-mutation-regression", env: { SYNTHETIC_VALUE: "original" }, requirementsFile: "requirements-context.txt", installTimeoutMs: 1234, platform: "win32" as const,
      onDiagnosticStage: () => { options.command = "changed-python"; options.cwd = "changed-context"; options.env.SYNTHETIC_VALUE = "changed"; options.requirementsFile = "changed.txt"; options.installTimeoutMs = 1; },
      execFileImplementation: ((command: string, args: readonly string[], dispatch: any, callback: CommandCallback) => {
        calls.push({ command, cwd: dispatch.cwd, timeout: dispatch.timeout, value: dispatch.env?.SYNTHETIC_VALUE, args: [...args] });
        const position = ++count;
        queueMicrotask(() => callback(position === 1 ? { code: 12 } : null, position === 1 ? "ASB_CONTEXT_DEPENDENCY_MISSING" : position === 3 ? "ASB_CONTEXT_DEPENDENCY_READY" : "", ""));
      }) as any };
    expect(await ensurePythonRuntimeContextDependencies(options)).toEqual({ installed: true, version: "0.34.0" });
    expect(calls.every(call => call.command === "python" && call.cwd === "context-mutation-regression" && call.timeout === 1234 && call.value === "original")).toBe(true);
    expect(calls[1]?.args.at(-1)).toBe("requirements-context.txt");
  });

  it("publishes entry before dispatch and return only when the real command callback returns", async () => {
    const events: Readonly<PythonRuntimePreparationDiagnostic>[] = [];
    let complete!: CommandCallback;
    const implementation = testDouble.fn((_command: string, _args: readonly string[], _options: unknown, callback: CommandCallback) => {
      expect(events.map(event => event.data.phase)).toEqual(["entered"]);
      complete = callback;
    });
    const result = ensurePythonRuntimeContextDependencies({ command: "python", cwd: "context-step-ready", platform: "win32", execFileImplementation: implementation as any, onDiagnosticStage: event => { events.push(event); } });
    expect(events.length).toBe(1);
    complete(null, "ASB_CONTEXT_DEPENDENCY_READY\n", "private-output");
    expect(await result).toEqual({ installed: false, version: "0.34.0" });
    expect(events.map(event => [event.stage, event.data.phase])).toEqual([["probe-context-dependencies", "entered"], ["probe-context-dependencies", "returned"]]);
    expect(JSON.stringify(events)).not.toContain("private-output");
  });

  it("keeps late diagnostic listeners on the same flight without replaying its entry", async () => {
    let complete!: CommandCallback;
    const implementation = testDouble.fn((_command: string, _args: readonly string[], _options: unknown, callback: CommandCallback) => { complete = callback; });
    const options = { command: "python", cwd: "context-step-shared", platform: "win32" as const, execFileImplementation: implementation as any };
    const firstEvents: string[] = [], lateEvents: string[] = [];
    const first = ensurePythonRuntimeContextDependencies({ ...options, onDiagnosticStage: event => { firstEvents.push(event.data.phase); } });
    const second = ensurePythonRuntimeContextDependencies({ ...options, onDiagnosticStage: event => { lateEvents.push(event.data.phase); } });
    expect(first).toBe(second);
    expect(lateEvents).toEqual([]);
    complete(null, "ASB_CONTEXT_DEPENDENCY_READY", "");
    await first;
    expect(firstEvents).toEqual(["entered", "returned"]);
    expect(lateEvents).toEqual(["returned"]);
    expect(implementation).toHaveBeenCalledTimes(1);
    const third = ensurePythonRuntimeContextDependencies(options);
    complete(null, "ASB_CONTEXT_DEPENDENCY_READY", "");
    await third;
    expect(firstEvents).toEqual(["entered", "returned"]);
    expect(lateEvents).toEqual(["returned"]);
    expect(implementation).toHaveBeenCalledTimes(2);
  });

  it("registers the flight before a diagnostic observer can reenter setup", async () => {
    let complete!: CommandCallback;
    const implementation = testDouble.fn((_command: string, _args: readonly string[], _options: unknown, callback: CommandCallback) => { complete = callback; });
    const options = { command: "python", cwd: "context-step-reentrant", platform: "linux" as const, execFileImplementation: implementation as any };
    let joined: ReturnType<typeof ensurePythonRuntimeContextDependencies> | undefined;
    const first = ensurePythonRuntimeContextDependencies({ ...options, onDiagnosticStage: event => {
      if (event.data.phase === "entered") joined = ensurePythonRuntimeContextDependencies(options);
    } });
    expect(joined).toBe(first);
    expect(implementation).toHaveBeenCalledTimes(1);
    complete(null, "ASB_CONTEXT_DEPENDENCY_READY", "");
    await first;
  });

  it("observes the existing probe, install and verification commands without changing their results", async () => {
    const implementation = createExecFileSequence([{ error: { code: 12 }, stdout: "ASB_CONTEXT_DEPENDENCY_MISSING" }, {}, { stdout: "ASB_CONTEXT_DEPENDENCY_READY" }]);
    const events: string[] = [];
    const result = await ensurePythonRuntimeContextDependencies({ command: "python", cwd: "context-step-install", platform: "win32", execFileImplementation: implementation as any, onDiagnosticStage: event => { events.push(`${event.stage}:${event.data.phase}`); } });
    expect(result).toEqual({ installed: true, version: "0.34.0" });
    expect(events).toEqual(["probe-context-dependencies:entered", "probe-context-dependencies:returned", "install-context-dependencies:entered", "install-context-dependencies:returned", "verify-context-dependencies:entered", "verify-context-dependencies:returned"]);
    expect(implementation.mock.calls[1]?.[1]).toEqual(["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", "requirements-context.txt"]);
  });

  it("keeps original dispatch exceptions and rejects observer failures without exposing their content", async () => {
    const original = new Error("private-command-error");
    const events: Readonly<PythonRuntimePreparationDiagnostic>[] = [];
    const failure = await ensurePythonRuntimeContextDependencies({ command: "python", cwd: "context-step-throw", platform: "win32", execFileImplementation: (() => { throw original; }) as any, onDiagnosticStage: event => { events.push(event); return Promise.reject(new Error("private-observer-error")); } }).catch(error => error);
    expect(failure).toBe(original);
    expect(events.map(event => event.data.phase)).toEqual(["entered", "threw"]);
    expect(JSON.stringify(events)).not.toContain("private-");
    await new Promise(resolve => setImmediate(resolve));
  });

  it("ignores an invalid diagnostic getter and repeated command callbacks", async () => {
    const events: string[] = [];
    const options = { command: "python", cwd: "context-step-invalid-observer", platform: "win32" as const, execFileImplementation: createExecFileSequence([{ stdout: "ASB_CONTEXT_DEPENDENCY_READY" }]) as any };
    Object.defineProperty(options, "onDiagnosticStage", { get() { throw new Error("private-getter"); } });
    expect(await ensurePythonRuntimeContextDependencies(options)).toEqual({ installed: false, version: "0.34.0" });
    const second = await ensurePythonRuntimeContextDependencies({ command: "python", cwd: "context-step-double-callback", platform: "win32", execFileImplementation: ((_command: string, _args: readonly string[], _options: unknown, callback: CommandCallback) => { callback(null, "ASB_CONTEXT_DEPENDENCY_READY", ""); callback(new Error("private-duplicate"), "", ""); }) as any, onDiagnosticStage: event => { events.push(event.data.phase); } });
    expect(second).toEqual({ installed: false, version: "0.34.0" });
    expect(events).toEqual(["entered", "returned"]);
  });

  it("keeps an exact ready installation without running pip or publishing progress", async () => {
    const execFileImplementation = createExecFileSequence([
      { stdout: "ASB_CONTEXT_DEPENDENCY_READY\n" },
    ]);
    const onProgress = testDouble.fn();

    const result = await ensurePythonRuntimeContextDependencies({
      command: "python",
      cwd: "runtime-worker",
      platform: "win32",
      execFileImplementation: execFileImplementation as any,
      onProgress,
    });

    expect(result).toEqual({ installed: false, version: "0.34.0" });
    expect(execFileImplementation).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("installs fixed requirements, re-verifies, and publishes bounded progress", async () => {
    const execFileImplementation = createExecFileSequence([
      {
        error: { code: 12 },
        stdout: "ASB_CONTEXT_DEPENDENCY_MISSING\n",
      },
      { stdout: "Successfully installed into C:\\private\\runtime" },
      { stdout: "ASB_CONTEXT_DEPENDENCY_READY\n" },
    ]);
    const progress: Array<{ phase: string; message: string }> = [];

    const result = await ensurePythonRuntimeContextDependencies({
      command: "python",
      cwd: "runtime-worker",
      platform: "win32",
      execFileImplementation: execFileImplementation as any,
      onProgress: (entry) => progress.push(entry),
    });

    expect(result).toEqual({ installed: true, version: "0.34.0" });
    expect(execFileImplementation.mock.calls[1]?.[1]).toEqual([
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      "-r",
      "requirements-context.txt",
    ]);
    expect(progress.map((entry) => entry.phase)).toEqual([
      "installing",
      "installed",
    ]);
    expect(JSON.stringify(progress)).not.toContain("private");
  });

  it("fails closed without installation on unsupported Python", async () => {
    const execFileImplementation = createExecFileSequence([
      {
        error: { code: 11 },
        stdout: "ASB_CONTEXT_DEPENDENCY_UNSUPPORTED_PYTHON\n",
      },
    ]);

    const failure = await ensurePythonRuntimeContextDependencies({
      command: "python",
      platform: "linux",
      execFileImplementation: execFileImplementation as any,
    }).catch((error) => error);
    expect(failure).toMatchObject({ code: "unsupported-python" });
    expect(execFileImplementation).toHaveBeenCalledTimes(1);
  });

  it("does not expose probe output or paths through unexpected failures", async () => {
    const execFileImplementation = createExecFileSequence([
      {
        error: { code: "EACCES" },
        stderr: "Permission denied: C:\\Users\\private\\runtime token=secret",
      },
    ]);

    const failure = await ensurePythonRuntimeContextDependencies({
      command: "python",
      platform: "win32",
      execFileImplementation: execFileImplementation as any,
    }).catch((error) => error);

    expect(failure instanceof PythonRuntimeContextDependencyError).toBe(true);
    expect(failure).toMatchObject({ code: "probe-failed" });
    expect(String(failure.message)).not.toContain("private");
    expect(String(failure.message)).not.toContain("secret");
  });

  it("classifies bounded install timeout and never verifies partial state", async () => {
    const execFileImplementation = createExecFileSequence([
      {
        error: { code: 12 },
        stdout: "ASB_CONTEXT_DEPENDENCY_MISSING\n",
      },
      { error: { code: "ETIMEDOUT", killed: true } },
    ]);

    const failure = await ensurePythonRuntimeContextDependencies({
      command: "python",
      platform: "linux",
      execFileImplementation: execFileImplementation as any,
    }).catch((error) => error);
    expect(failure).toMatchObject({ code: "install-timeout" });
    expect(execFileImplementation).toHaveBeenCalledTimes(2);
  });

  it("fails when exact dependencies remain mismatched after installation", async () => {
    const execFileImplementation = createExecFileSequence([
      {
        error: { code: 13 },
        stdout: "ASB_CONTEXT_DEPENDENCY_VERSION_MISMATCH\n",
      },
      {},
      {
        error: { code: 13 },
        stdout: "ASB_CONTEXT_DEPENDENCY_VERSION_MISMATCH\n",
      },
    ]);

    const failure = await ensurePythonRuntimeContextDependencies({
      command: "python",
      platform: "darwin",
      execFileImplementation: execFileImplementation as any,
    }).catch((error) => error);
    expect(failure).toMatchObject({ code: "verification-failed" });
  });

  it("shares one in-flight ensure and broadcasts install progress", async () => {
    const callbacks: CommandCallback[] = [];
    const execFileImplementation = testDouble.fn(
      (
        _command: string,
        _args: readonly string[],
        _options: unknown,
        callback: CommandCallback,
      ) => {
        callbacks.push(callback);
      },
    );
    const firstProgress: string[] = [];
    const secondProgress: string[] = [];
    const first = ensurePythonRuntimeContextDependencies({
      command: "python",
      cwd: "shared-worker",
      platform: "linux",
      execFileImplementation: execFileImplementation as any,
      onProgress: (entry) => firstProgress.push(entry.phase),
    });
    const second = ensurePythonRuntimeContextDependencies({
      command: "python",
      cwd: "shared-worker",
      platform: "linux",
      execFileImplementation: execFileImplementation as any,
      onProgress: (entry) => secondProgress.push(entry.phase),
    });

    expect(execFileImplementation).toHaveBeenCalledTimes(1);
    callbacks.shift()?.({ code: 12 }, "ASB_CONTEXT_DEPENDENCY_MISSING\n", "");
    await new Promise((resolve) => setImmediate(resolve));
    callbacks.shift()?.(null, "", "");
    await new Promise((resolve) => setImmediate(resolve));
    callbacks.shift()?.(null, "ASB_CONTEXT_DEPENDENCY_READY\n", "");

    await expect(Promise.all([first, second])).resolves.toEqual([
      { installed: true, version: "0.34.0" },
      { installed: true, version: "0.34.0" },
    ]);
    expect(execFileImplementation).toHaveBeenCalledTimes(3);
    expect(firstProgress).toEqual(["installing", "installed"]);
    expect(secondProgress).toEqual(["installing", "installed"]);
  });
});
