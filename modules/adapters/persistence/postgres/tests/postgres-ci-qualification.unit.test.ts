import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recoveryEntrypoint =
  "dev-tools/scripts/persistence/postgres-recovery-drill.mjs";
const recoveryImplementation =
  "dev-tools/scripts/persistence/postgres-recovery-drill.ts";

test("CI continuously runs the disposable PostgreSQL 18 live conformance suite", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const packageJson = await readFile("package.json", "utf8");
  const recoveryDrill = await readFile(recoveryImplementation, "utf8");
  const recoveryLauncher = await readFile(recoveryEntrypoint, "utf8");

  assert.match(workflow, /postgresql-qualification:/);
  assert.match(workflow, /image: postgres:18-bookworm/);
  assert.match(
    workflow,
    /pg_isready -U ai_system_builder -d ai_system_builder_qualification/,
  );
  assert.match(workflow, /run: npm run test:postgres-live/);
  assert.match(
    packageJson,
    /managed-postgres-system-runtime-database\.live\.integration\.test\.ts/,
  );
  assert.match(workflow, /run: npm run test:postgres-recovery/);
  assert.match(
    workflow,
    /RECOVERY_POSTGRES_CONTAINER: \$\{\{ job\.services\.postgres\.id \}\}/,
  );
  assert.match(workflow, /name: postgres-recovery-evidence/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(
    workflow,
    /RECOVERY_EVIDENCE_DIRECTORY: \$\{\{ github\.workspace \}\}\/artifacts\/qualification\/postgres-recovery/,
  );
  assert.match(workflow, /name: Verify recovery evidence/);
  assert.match(
    workflow,
    /name: Verify recovery evidence\n\s+if: \$\{\{ always\(\) \}\}/,
  );
  assert.match(
    workflow,
    /test -s "\$RECOVERY_EVIDENCE_DIRECTORY\/recovery-evidence\.json"/,
  );
  assert.match(recoveryDrill, /export async function runPostgresRecoveryDrill/);
  assert.match(recoveryLauncher, /^await runPostgresRecoveryDrill\(\)\.catch/m);
  assert.match(
    workflow,
    /name: postgres-recovery-evidence[\s\S]*if-no-files-found: warn/,
  );
  assert.match(workflow, /TEST_POSTGRES_SSL_MODE: disable/);
  assert.doesNotMatch(workflow, /TEST_POSTGRES_URL:\s*\$\{\{/);
});

test("PostgreSQL recovery drill entrypoint executes as ESM and reports configuration failures", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", recoveryEntrypoint],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        RECOVERY_POSTGRES_CONTAINER: "",
        RECOVERY_POSTGRES_DATABASE: "",
        RECOVERY_POSTGRES_USER: "",
        TEST_POSTGRES_URL: "",
      },
    },
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(
    result.stderr,
    /RECOVERY_POSTGRES_CONTAINER must be a safe Docker container id or name/,
  );
  assert.doesNotMatch(
    result.stderr,
    /Top-level await is currently not supported/,
  );
});
