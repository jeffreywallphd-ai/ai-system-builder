import { spawnSync } from "node:child_process";
import process from "node:process";

const python =
  process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const result = spawnSync(
  python,
  [
    "-m",
    "unittest",
    "modules.adapters.runtime.python.worker.tests.test_dataset_preparation_creation_matrix_e2e",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(
    "Unable to start the dataset-preparation E2E test runtime:",
    result.error.message,
  );
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
