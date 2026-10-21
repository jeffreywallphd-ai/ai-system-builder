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
    assert.deepEqual(checkPlan[0]?.command.slice(-2), ["--", "package.json"]);
    assert.deepEqual(checkPlan[0]?.command.slice(0, 3), [
      "node",
      "node_modules/prettier/bin/prettier.cjs",
      "--check",
    ]);
    assert.deepEqual(checkPlan[1]?.command.slice(-2), [
      "--",
      "apps/desktop/tests/ci-electron-runtime.unit.test.ts",
    ]);

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

test("repository checks reject option-like existing paths and unsupported test targets before execution", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "helper-path-authority-"),
  );
  try {
    for (const filename of [
      "--import=fixture.test.ts",
      "--plugin=fixture.mjs",
      "fixture.mjs",
      "safe.test.ts",
    ]) {
      await writeFile(
        path.join(temporaryRoot, filename),
        "// inert fixture; never executed\n",
      );
    }
    const configPath = path.join(temporaryRoot, "helpers.json");
    for (const selection of [
      { focusedTests: ["--import=fixture.test.ts"] },
      { focusedTests: ["./--import=fixture.test.ts"] },
      { formatPaths: ["--plugin=fixture.mjs"] },
      { focusedTests: ["fixture.mjs"] },
      { focusedTests: ["."] },
    ]) {
      await writeFile(
        configPath,
        JSON.stringify({
          repositoryChecks: { repo: temporaryRoot, ...selection },
        }),
      );
      const result = runHelper("run_repository_checks.py", [
        "--config",
        configPath,
        "--plan",
      ]);
      assert.equal(result.status, 2, result.stdout);
      assert.match(result.stderr, /positional|Node test file/);
    }
    await writeFile(
      configPath,
      JSON.stringify({
        repositoryChecks: {
          repo: temporaryRoot,
          focusedTests: ["safe.test.ts"],
          formatPaths: ["fixture.mjs"],
        },
      }),
    );
    const result = runHelper("run_repository_checks.py", [
      "--config",
      configPath,
      "--plan",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.deepEqual(plan[0].command.slice(-2), ["--", "fixture.mjs"]);
    assert.deepEqual(plan[1].command.slice(-2), ["--", "safe.test.ts"]);
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

test("format filenames retain literal metacharacters through the fixed Node CLI", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "helper-literal-argv-"),
  );
  try {
    // Mirror only the fixed CLI path with an inert argv sink. No fixture input
    // is imported or evaluated, and no command interpreter is launched.
    const { mkdir } = await import("node:fs/promises");
    const cli = path.join(temporaryRoot, "node_modules/prettier/bin");
    await mkdir(cli, { recursive: true });
    await writeFile(
      path.join(cli, "prettier.cjs"),
      "console.log(JSON.stringify(process.argv.slice(2)));\n",
    );
    const filename = "safe&ver.mjs";
    await writeFile(path.join(temporaryRoot, filename), "// inert input\n");
    const configPath = path.join(temporaryRoot, "helpers.json");
    await writeFile(
      configPath,
      JSON.stringify({
        repositoryChecks: {
          repo: temporaryRoot,
          formatPaths: [filename],
          documentation: false,
          agentSupport: false,
          architecture: false,
          deployment: false,
        },
      }),
    );
    const planned = runHelper("run_repository_checks.py", [
      "--config",
      configPath,
      "--plan",
    ]);
    assert.equal(planned.status, 0, planned.stderr);
    const command = JSON.parse(planned.stdout)[0].command;
    assert.deepEqual(command, [
      "node",
      "node_modules/prettier/bin/prettier.cjs",
      "--check",
      "--",
      filename,
    ]);
    const executed = runHelper("run_repository_checks.py", [
      "--config",
      configPath,
    ]);
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(
      executed.stdout
        .split(/\r?\n/)
        .filter((line) => line === '["--check","--","safe&ver.mjs"]').length,
      1,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
