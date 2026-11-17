// Fixed Vitest adapter: CLI positional paths are substring filters, so use an
// exact include configuration and verify the collected set before accepting it.
import path from "node:path";
import { startVitest } from "vitest/node";

const files = process.argv.slice(3);
if (process.argv[2] !== "--" || files.length === 0 || files.length > 100 ||
    new Set(files).size !== files.length || files.some((p) => !/^(?:modules|apps|dev-tools)\//.test(p) || p.includes("..") || p.includes("\\") || /[*?{}\[\]!()]/.test(p) || !/\.test\.[cm]?[jt]sx?$/.test(p))) {
  throw new Error("Use bounded canonical source-owned test paths.");
}
const expected = files.map((p) => path.resolve(p)).sort();
const context = await startVitest("test", [], { config: false, watch: false, run: true,
  include: files, exclude: [], environment: "jsdom", maxWorkers: 1, passWithNoTests: false });
try {
  const collected = context.state.getFiles();
  if (JSON.stringify(collected.map((f) => path.resolve(f.filepath)).sort()) !== JSON.stringify(expected) ||
      collected.some((f) => f.result?.state !== "pass") || context.state.getUnhandledErrors().length) process.exitCode = 1;
} finally { await context.close(); }
