import { spawnSync } from "node:child_process";
import process from "node:process";

const python =
  process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const controlledTestModule =
  "modules.adapters.runtime.python.worker.tests.test_model_training_task_matrix_e2e";
const result = spawnSync(
  python,
  ["-m", "unittest", "-v", controlledTestModule],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HF_HUB_DISABLE_PROGRESS_BARS: "1",
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      TOKENIZERS_PARALLELISM: "false",
      WANDB_DISABLED: "true",
    },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(
    "Unable to start the controlled model-training E2E runtime:",
    result.error.message,
  );
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
