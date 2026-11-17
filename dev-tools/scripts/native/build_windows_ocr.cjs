// Trusted development/package composition only. The runtime never calls this.
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);
const root = path.resolve(__dirname, "../../..");
const script = path.join(__dirname, "build_windows_ocr.py");

async function buildWindowsOcrResource(platform, arch, execute = run) {
  if (platform !== "win32" || arch !== "x64") return;
  // Reuse the existing trusted operator interpreter setting. No shell or args
  // setting is used. Isolated Python imports only stdlib and the fixed repo root.
  const command = process.env.PYTHON_RUNTIME_COMMAND?.trim() || "python";
  const environment = Object.fromEntries(
    ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"].filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  try {
    const { stdout, stderr } = await execute(command, ["-I", "-S", "-B", script, "--build"], {
      cwd: root, env: environment, shell: false, windowsHide: true,
      timeout: 150_000, maxBuffer: 64 * 1024, encoding: "utf8",
    });
    if (stderr || typeof stdout !== "string" || stdout.length > 4096) throw new Error("Invalid build result");
    const result = JSON.parse(stdout);
    const validReady = result.status === "ready" && ["built", "reused"].includes(result.action)
      && Object.keys(result).length === 2;
    const validUnavailable = result.status === "unavailable"
      && ["unsupported-platform", "installed-toolchain-unavailable"].includes(result.reason)
      && Object.keys(result).length === 2;
    if (!validReady && !validUnavailable) throw new Error("Invalid build result");
    if (validUnavailable) console.info("Windows text recognition is unavailable. Standard features remain available.");
  } catch {
    // Optional engine failures never produce a blank desktop or select another
    // binary. The runtime independently denies stale/missing resource identity.
    console.info("Windows text recognition could not be built. Standard features remain available.");
  }
}

module.exports = { buildWindowsOcrResource };
