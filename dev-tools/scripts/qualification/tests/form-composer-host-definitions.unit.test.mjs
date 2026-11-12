import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { pickFormDesktopSystemEnvironment, prepareFormDesktopProfile } from "../visual-composer/e2e/form-composer-desktop-profile.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const definitions = [
  ["playwright.visual-composer.config.ts", "packaged-desktop", "packaged-desktop-form-composer", "packaged Desktop"],
  ["playwright.managed-reference.config.ts", "managed-thin-chrome", "managed-reference-form-composer", "managed browser"],
];

test("Form Desktop launch keeps system settings and excludes provider and process overrides", () => {
  const scoped = pickFormDesktopSystemEnvironment({ SystemRoot: "synthetic-system-root", Path: "synthetic-path", TMP: "synthetic-temp",
    HF_TOKEN: "synthetic-provider-token", HUGGING_FACE_TOKEN: "synthetic-provider-token", OPENAI_API_KEY: "synthetic-provider-token",
    VISUAL_COMPOSER_DESKTOP_EXECUTABLE: "foreign-program", PYTHON_RUNTIME_COMMAND: "foreign-program", NODE_OPTIONS: "foreign-options" });
  assert.deepEqual(scoped, { SystemRoot: "synthetic-system-root", Path: "synthetic-path", TMP: "synthetic-temp" });
});

test("Form Desktop refuses an unexpected profile before seeding", (context) => {
  const vars = { VISUAL_COMPOSER_QUALIFICATION_RUN_ID: "form-desktop-fixture-run-001", VISUAL_COMPOSER_DESKTOP_DATA_ROOT: "unexpected-profile" };
  for (const [key, value] of Object.entries(vars)) {
    const previous = process.env[key];
    context.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
  assert.throws(() => prepareFormDesktopProfile("authoring"), /profile must match the active run/);
  assert.throws(() => prepareFormDesktopProfile("unknown"), /case must be known/);
});

for (const [config, project, spec, name] of definitions) {
  test(`the fixed ${project} project discovers four Form Composer journeys without launching a host`, () => {
    const env = { ...pickFormDesktopSystemEnvironment(process.env), CI: "1", FORCE_COLOR: "0" };
    const result = spawnSync(process.execPath, ["node_modules/playwright/cli.js", "test", "--list", "--reporter=list",
      "--config", `dev-tools/config/${config}`, `--project=${project}`, `${spec}.e2e.spec.ts`], {
      cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
    });
    assert.equal(result.status, 0, "The scoped Playwright definition must load without a host.");
    const cases = result.stdout.split(/\r?\n/).filter(line => line.includes("›"));
    const expected = [
      `${name} authors and reopens an intake and a branching form`,
      `${name} publishes and submits the intake into its released records`,
      `${name} publishes and submits the questionnaire into its released records`,
      `${name} Form Composer and preview reflow at actual 400 percent zoom`,
    ];
    assert.equal(cases.length, expected.length);
    for (const [index, line] of cases.entries()) {
      assert.ok(line.includes(`[${project}] › ${spec}.e2e.spec.ts`));
      assert.ok(line.endsWith(`› ${expected[index]}`));
    }
  });
}
