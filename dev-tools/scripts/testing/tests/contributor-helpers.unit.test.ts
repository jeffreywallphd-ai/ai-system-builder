import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const python =
  process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const helpersRoot = path.resolve("dev-tools", "helpers");

function runHelper(script: string, args: string[]) {
  return spawnSync(python, [path.join(helpersRoot, script), ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
}

test("contributor helper sources contain no local user or checkout details", async () => {
  const forbiddenLocalFragments = [
    ["C:", "\\Users\\"].join(""),
    ["GitHub", "Projects"].join(""),
  ];
  for (const file of [
    "helper_config.py",
    "native_apply_patch.py",
    "repo_snapshot.py",
    "run_repository_checks.py",
    "helpers.example.json",
  ]) {
    const source = await readFile(path.join(helpersRoot, file), "utf8");
    for (const fragment of forbiddenLocalFragments) {
      assert.equal(
        source.toLowerCase().includes(fragment.toLowerCase()),
        false,
      );
    }
  }
});

test("contributor helpers accept portable configuration and expose bounded plans", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "contributor-helpers-"),
  );
  try {
    const patchPath = path.join(temporaryRoot, "change.patch");
    const invalidPatchPath = path.join(temporaryRoot, "invalid.patch");
    const configPath = path.join(temporaryRoot, "helpers.json");
    await writeFile(
      patchPath,
      "*** Begin Patch\n*** Add File: example.txt\n+example\n*** End Patch\n",
      "utf8",
    );
    await writeFile(invalidPatchPath, "not a framed patch\n", "utf8");
    await writeFile(
      configPath,
      JSON.stringify({
        nativeApplyPatch: { codexExecutable: process.execPath },
        repositorySnapshot: {
          repo: ".",
          logCount: 5,
          ignorePaths: [".local-codex/helpers.json"],
        },
        repositoryChecks: {
          repo: ".",
          formatPaths: ["package.json"],
          focusedTests: ["apps/desktop/tests/ci-electron-runtime.unit.test.ts"],
          installElectron: true,
          documentation: true,
          agentSupport: true,
          architecture: true,
          deployment: true,
          fullSuite: true,
        },
      }),
      "utf8",
    );

    const patch = runHelper("native_apply_patch.py", [
      "--config",
      configPath,
      "--patch-file",
      patchPath,
      "--dry-run",
    ]);
    assert.equal(patch.status, 0, patch.stderr);
    const patchResult = JSON.parse(patch.stdout) as {
      operation: string;
      patchBytes: number;
      status: string;
    };
    assert.equal(patchResult.operation, "native-apply-patch");
    assert.ok(patchResult.patchBytes > 0);
    assert.equal(patchResult.status, "validated");

    const invalidPatch = runHelper("native_apply_patch.py", [
      "--config",
      configPath,
      "--patch-file",
      invalidPatchPath,
      "--dry-run",
    ]);
    assert.equal(invalidPatch.status, 2);
    assert.match(invalidPatch.stderr, /Patch must start with/);

    const snapshot = runHelper("repo_snapshot.py", [
      "--config",
      configPath,
      "--plan",
    ]);
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const snapshotPlan = JSON.parse(snapshot.stdout) as Array<{
      label: string;
      command: string[];
    }>;
    assert.deepEqual(snapshotPlan[1]?.command, [
      "git",
      "log",
      "-5",
      "--oneline",
      "--decorate",
    ]);
    assert.equal(snapshotPlan.at(-1)?.command[1], "check-ignore");

    const escapingSnapshot = runHelper("repo_snapshot.py", [
      "--repo",
      ".",
      "--ignore-path",
      "..",
      "--plan",
    ]);
    assert.equal(escapingSnapshot.status, 2);
    assert.match(
      escapingSnapshot.stderr,
      /Path must stay inside the repository/,
    );

    const checks = runHelper("run_repository_checks.py", [
      "--config",
      configPath,
      "--plan",
    ]);
    assert.equal(checks.status, 0, checks.stderr);
    const checkPlan = JSON.parse(checks.stdout) as Array<{
      label: string;
      command: string[];
    }>;
    assert.deepEqual(
      checkPlan.map((entry) => entry.label),
      [
        "format",
        "focused tests",
        "pinned Electron runtime",
        "documentation",
        "agent support",
        "architecture",
        "deployment",
        "full non-browser suite",
      ],
    );

    const arbitraryCommand = runHelper("run_repository_checks.py", [
      "--command",
      "whoami",
      "--plan",
    ]);
    assert.equal(arbitraryCommand.status, 2);
    assert.match(arbitraryCommand.stderr, /unrecognized arguments/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("agent and documentation entry points route and maintain contributor helpers", async () => {
  const [agentGuide, docsIndex, helperGuide] = await Promise.all([
    readFile("AGENTS.md", "utf8"),
    readFile("docs/README.md", "utf8"),
    readFile("docs/diagnostics/contributor-helper-loops.md", "utf8"),
  ]);
  assert.match(agentGuide, /dev-tools\/helpers\/run_repository_checks\.py/);
  assert.match(agentGuide, /negative security tests/);
  assert.match(docsIndex, /contributor-helper-loops\.md/);
  assert.match(helperGuide, /## Maintenance and extension/);
  assert.match(helperGuide, /arbitrary command/);
});
