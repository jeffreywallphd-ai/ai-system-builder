import type { ChildProcess } from "node:child_process";

/** Confirm only this owned child's termination, never a request or a timeout. */
export function terminateOwnedProcess(child: ChildProcess): Promise<void> {
  const terminal = () => child.exitCode != null || child.signalCode != null;
  if (terminal()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", exited);
      child.off("close", exited);
      child.off("error", failed);
      if (confirmed) resolve();
      else
        reject(
          new Error(
            "Worker termination could not be confirmed; ownership is retained for retry.",
          ),
        );
    };
    const exited = () => finish(true);
    const failed = () => finish(terminal());
    child.once("exit", exited);
    child.once("close", exited);
    child.once("error", failed);
    timer = setTimeout(() => finish(terminal()), 5_000);
    if (terminal()) {
      finish(true);
      return;
    }
    try {
      if (!child.kill("SIGTERM")) finish(terminal());
    } catch {
      finish(terminal());
    }
  });
}
