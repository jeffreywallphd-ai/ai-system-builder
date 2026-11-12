import { spawnSync } from "node:child_process";

// Shared by the ESM CLI and the Playwright test worker. No CLI entry point.
export const DEFAULT_VISUAL_COMPOSER_SHUTDOWN_TIMEOUT_MS = 5_000;

export async function stopVisualComposerOwnedProcess(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const timeoutMs =
    options.shutdownTimeoutMs ?? DEFAULT_VISUAL_COMPOSER_SHUTDOWN_TIMEOUT_MS;
  const platform = options.platform ?? process.platform;
  const waitForExit = waitForChildExit(child);

  if (platform === "win32") {
    if (Number.isInteger(child.pid) && child.pid > 0) {
      const terminateTree =
        options.terminateWindowsTree ?? terminateWindowsTree;
      terminateTree(child.pid);
    } else {
      child.kill("SIGTERM");
    }
  } else if (child.pid && options.detached !== false) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }

  if (await settleWithin(waitForExit, timeoutMs)) return;
  if (platform === "win32") {
    try {
      child.kill("SIGKILL");
    } catch {
      // The owned process may have exited between the timeout and fallback.
    }
  } else {
    try {
      if (child.pid && options.detached !== false) {
        process.kill(-child.pid, "SIGKILL");
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      child.kill("SIGKILL");
    }
  }
  await settleWithin(waitForExit, Math.min(1_000, timeoutMs));
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

function settleWithin(promise, timeoutMs) {
  return Promise.race([
    promise.then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function terminateWindowsTree(pid) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore",
  });
}
