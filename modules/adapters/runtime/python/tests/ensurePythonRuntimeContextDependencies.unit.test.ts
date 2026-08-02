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
