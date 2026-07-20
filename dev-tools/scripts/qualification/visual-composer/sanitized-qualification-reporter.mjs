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

  onEnd() {
    if (this.checks.length === 0) {
      process.stdout.write(
        "Visual composer qualification did not execute tests; evidence was not written.\n",
      );
      return;
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
      checks: this.checks,
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
  }
}
