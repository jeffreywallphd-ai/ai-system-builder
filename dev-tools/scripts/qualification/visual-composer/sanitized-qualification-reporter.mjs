import os from "node:os";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  createVisualComposerQualificationEvidence,
  createVisualComposerQualificationRunId,
  resolveVisualComposerQualificationPaths,
  sanitizeVisualComposerQualificationDiagnostic,
  writeVisualComposerQualificationEvidence,
} from "./visual-composer-qualification-core.mjs";

// Playwright launch messages can contain profile paths, command arguments and
// arbitrary child output. Keep only a fixed description of the startup signal.
function browserLaunchReason(message) {
  if (typeof message !== "string") return undefined;
  const sample = message.slice(0, 8192);
  const firstLine = sample.split(/\r?\n/, 1)[0];
  if (!/^(?:(?:Error|TimeoutError): )?browserType\.(?:launch|launchPersistentContext):/.test(firstLine)) return undefined;
  if (/Executable doesn't exist\b|\bspawn\b[^\r\n]*\bENOENT\b/i.test(firstLine)) return "executable unavailable";
  if (/\b(?:EACCES|EPERM|access is denied|permission denied)\b/i.test(firstLine)) return "permission denied";
  if (/\b(?:cannot|failed to) create (?:the )?(?:default )?(?:profile|(?:user )?data) directory\b/i.test(sample)) {
    return "profile directory unavailable";
  }
  if (/^TimeoutError:|\bTimeout \d+ms exceeded\b/i.test(firstLine)) return "launch timed out";
  if (/\bbrowser has been closed\b/i.test(firstLine) || /<process did exit:/.test(sample)) {
    return "browser closed before launch completed";
  }
  return "cause undetermined";
}

export default class SanitizedQualificationReporter {
  constructor(options = {}) {
    this.options = options;
    this.startedAt = new Date();
    this.checks = [];
    this.globalErrorCount = 0;
    this.globalBrowserLaunchReasons = new Map();
  }

  onTestEnd(test, result) {
    const messages = result.errors.map((error) => error.message ?? error.value ?? "Test failed.");
    const launchReasons = new Set(messages.map(browserLaunchReason).filter(Boolean));
    this.checks.push({
      id: test.titlePath().join(" / "),
      target: test.parent.project()?.name ?? "visual-composer",
      status: result.status === "passed" ? "passed" : "failed",
      durationMs: result.duration,
      // The other errors on a startup result may be unprefixed launcher output.
      diagnostic: launchReasons.size
        ? [...launchReasons].map((reason) => `Browser startup: ${reason}.`).join(" ")
        : messages.join(" "),
    });
  }

  onError(error) {
    // Global errors may contain credentials, user payloads or source paths.
    // Retain only a bounded count; the runner's failure still prevents a pass.
    this.globalErrorCount = Math.min(this.globalErrorCount + 1, 1_000_000);
    const reason = browserLaunchReason(error?.message ?? error?.value);
    if (reason) this.globalBrowserLaunchReasons.set(reason, Math.min((this.globalBrowserLaunchReasons.get(reason) ?? 0) + 1, 1_000_000));
  }

  onEnd(result) {
    const checks = [...this.checks];
    if (result?.status !== "passed" || this.globalErrorCount > 0 || checks.length === 0) {
      const status = ["passed", "failed", "timedout", "interrupted"].includes(result?.status) ? result.status : "unknown";
      const launchReasons = [...this.globalBrowserLaunchReasons].map(([reason, count]) => `${reason} (${count})`).join(", ");
      checks.push({
        id: "visual-composer.runner-completion",
        target: "browser-runner",
        status: "failed",
        durationMs: 0,
        diagnostic: `Runner status: ${status}; global errors: ${this.globalErrorCount}; executed tests: ${this.checks.length}.` +
          (launchReasons ? ` Browser startup reports: ${launchReasons}.` : ""),
      });
    }
    const repoRoot = process.cwd();
    const runId =
      process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID ??
      createVisualComposerQualificationRunId(this.startedAt);
    const paths = resolveVisualComposerQualificationPaths(repoRoot, runId);
    mkdirSync(paths.runRoot, { recursive: true });
    const evidence = createVisualComposerQualificationEvidence({
      runId,
      environmentId:
        process.env.VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID ??
        `local-${process.platform}-${process.arch}`,
      sourceRevision:
        process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION ?? "worktree",
      startedAt: this.startedAt,
      completedAt: new Date(),
      checks,
      repoRoot,
      userRoot: os.homedir(),
    });
    writeVisualComposerQualificationEvidence(paths.evidencePath, evidence);
    process.stdout.write(
      `${sanitizeVisualComposerQualificationDiagnostic(
        `Visual composer qualification ${evidence.status}; evidence: ${resolve(repoRoot, "artifacts/qualification/visual-composer/runs", runId, "evidence.json")}`,
        { repoRoot, userRoot: os.homedir() },
      )}\n`,
    );
    if (evidence.status !== "passed") return { status: "failed" };
  }
}
