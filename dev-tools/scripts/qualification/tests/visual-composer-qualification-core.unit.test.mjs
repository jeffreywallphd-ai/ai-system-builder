import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVisualComposerQualificationRunId,
  createVisualComposerQualificationEvidence,
  percentile95,
  resolveVisualComposerQualificationPaths,
  sanitizeVisualComposerQualificationDiagnostic,
  writeVisualComposerQualificationEvidence,
} from "../visual-composer/visual-composer-qualification-core.mjs";

test("visual composer qualification generates validator-safe run ids", () => {
  const runId = createVisualComposerQualificationRunId(
    new Date("2026-07-19T16:00:00.000Z"),
  );
  assert.match(runId, /^[a-z0-9][a-z0-9._-]{0,95}$/);
  assert.doesNotThrow(() =>
    resolveVisualComposerQualificationPaths("C:\\work\\repo", runId),
  );
});

test("visual composer qualification paths remain inside the ignored artifact root", () => {
  const paths = resolveVisualComposerQualificationPaths(
    "C:\\work\\repo",
    "2026-07-19-run",
  );
  assert.match(
    paths.evidencePath.replaceAll("\\", "/"),
    /artifacts\/qualification\/visual-composer\/runs\/2026-07-19-run\/evidence\.json$/,
  );
  assert.throws(
    () =>
      resolveVisualComposerQualificationPaths("C:\\work\\repo", "../escape"),
    /run id is invalid/,
  );
});

test("visual composer qualification diagnostics redact roots and secrets", () => {
  const diagnostic = sanitizeVisualComposerQualificationDiagnostic(
    "C:\\work\\repo\\x C:\\Users\\Person\\y token=abc123\nnext",
    {
      repoRoot: "C:\\work\\repo",
      userRoot: "C:\\Users\\Person",
    },
  );
  assert.equal(diagnostic, "<repo>\\x <user>\\y token=<redacted> next");
  assert.doesNotMatch(diagnostic, /abc123|Person|work/);
});

test("visual composer qualification evidence is bounded, digestable, and immutable on disk", () => {
  assert.throws(
    () =>
      createVisualComposerQualificationEvidence({
        runId: "empty-run",
        environmentId: "windows-chrome",
        startedAt: "2026-07-19T00:00:00.000Z",
        completedAt: "2026-07-19T00:00:01.000Z",
        checks: [],
      }),
    /at least one executed check/,
  );
  const evidence = createVisualComposerQualificationEvidence({
    runId: "run-1",
    environmentId: "windows-chrome",
    sourceRevision: "worktree",
    startedAt: "2026-07-19T00:00:00.000Z",
    completedAt: "2026-07-19T00:01:00.000Z",
    repoRoot: "C:\\repo",
    userRoot: "C:\\Users\\Person",
    checks: [
      {
        id: "workflow",
        target: "thin-chrome",
        status: "passed",
        durationMs: 123.7,
      },
    ],
  });
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.checks[0].durationMs, 124);
  assert.match(evidence.digest, /^[a-f0-9]{64}$/);

  const directory = mkdtempSync(
    path.join(os.tmpdir(), "visual-composer-evidence-"),
  );
  const evidencePath = path.join(directory, "evidence.json");
  writeVisualComposerQualificationEvidence(evidencePath, evidence);
  assert.equal(
    JSON.parse(readFileSync(evidencePath, "utf8")).digest,
    evidence.digest,
  );
  assert.throws(
    () => writeVisualComposerQualificationEvidence(evidencePath, evidence),
    /EEXIST/,
  );
});

test("visual composer p95 uses the nearest-rank percentile", () => {
  assert.equal(
    percentile95(Array.from({ length: 20 }, (_, index) => index + 1)),
    19,
  );
  assert.throws(() => percentile95([]), /At least one/);
});
