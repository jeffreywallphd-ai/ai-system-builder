import recoveryDrillModule from "./postgres-recovery-drill.ts";

const { runPostgresRecoveryDrill } = recoveryDrillModule;

await runPostgresRecoveryDrill().catch((error) => {
  const message =
    error instanceof Error
      ? error.message
      : "PostgreSQL recovery drill failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
