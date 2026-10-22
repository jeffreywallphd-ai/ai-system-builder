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

export default class SanitizedQualificationReporter {
  constructor(options = {}) {
    this.options = options;
    this.startedAt = new Date();
    this.checks = [];
    this.globalErrorCount = 0;
  }

  onTestEnd(test, result) {
    this.checks.push({
      id: test.titlePath().join(" / "),
      target: test.parent.project()?.name ?? "visual-composer",
      status: result.status === "passed" ? "passed" : "failed",
      durationMs: result.duration,
      diagnostic: result.errors
        .map((error) => error.message ?? error.value ?? "Test failed.")
        .join(" "),
    });
  }

  onError() {
    // Global errors may contain credentials, user payloads or source paths.
    // Retain only a bounded count; the runner's failure still prevents a pass.
    this.globalErrorCount = Math.min(this.globalErrorCount + 1, 1_000_000);
  }

  onEnd(result) {
    const checks = [...this.checks];
    if (result?.status !== "passed" || this.globalErrorCount > 0 || checks.length === 0) {
      const status = ["passed", "failed", "timedout", "interrupted"].includes(result?.status) ? result.status : "unknown";
      checks.push({
        id: "visual-composer.runner-completion",
        target: "browser-runner",
        status: "failed",
        durationMs: 0,
        diagnostic: `Runner status: ${status}; global errors: ${this.globalErrorCount}; executed tests: ${this.checks.length}.`,
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
