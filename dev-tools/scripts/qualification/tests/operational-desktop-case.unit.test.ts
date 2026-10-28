import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const probe = vi.hoisted(() => ({ existing: false, statCalls: [] as string[], calls: [] as Array<{ executable: string; argvPrefix: string[]; script: string; dataRoot: string; large: string; runAsNode: string; timeout: number; windowsHide: boolean }> }));
vi.mock("node:fs", () => { const lstatSync = (value: string, options: { throwIfNoEntry: boolean }) => {
  if (options.throwIfNoEntry !== false) throw new Error("Unexpected fixture stat mode.");
  probe.statCalls.push(value); return probe.existing ? {} : undefined;
}; return { lstatSync, default: { lstatSync } }; });
// Capture only fixed safe facts; never retain/dump the full inherited environment.
vi.mock("node:child_process", () => { const spawnSync = (executable: string, argv: string[], options: { env: Record<string, string>; timeout: number; windowsHide: boolean }) => {
  const parts = argv[argv.length - 1]!.split(/[\\/]/);
  probe.calls.push({ executable, argvPrefix: argv.slice(0, -1), script: parts[parts.length - 1]!, dataRoot: options.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT, large: options.env.VISUAL_COMPOSER_LARGE_FIXTURE, runAsNode: options.env.ELECTRON_RUN_AS_NODE, timeout: options.timeout, windowsHide: options.windowsHide });
  return { status: 0 };
}; return { spawnSync, default: { spawnSync } }; });
import { prepareIsolatedDesktopCase } from "../visual-composer/e2e/isolated-desktop-case";
const base = path.resolve("artifacts/qualification/visual-composer/d/operational-fixture");
beforeEach(() => { probe.calls.length = 0; probe.statCalls.length = 0; probe.existing = false; vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", base); vi.stubEnv("VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE", "synthetic-electron-node"); });
afterEach(() => { vi.unstubAllEnvs(); });
describe("fixed operational desktop slot", () => {
  it("uses its own admitted slot, existing seed command and fixed hidden 30second bound", () => {
    const result = prepareIsolatedDesktopCase("operational");
    expect(result.dataRoot).toBe(path.join(base, "operational"));
    expect(result.env.HF_HUB_CACHE).toBe(path.join(base, "operational", "controlled-model-cache"));
    expect(probe.calls).toEqual([{ executable: "synthetic-electron-node", argvPrefix: ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx"], script: "visual-composer-desktop-seed.ts", dataRoot: result.dataRoot, large: "0", runAsNode: "1", timeout: 30_000, windowsHide: true }]);
    expect(result.dataRoot).not.toBe(path.join(base, "browse"));
    expect(probe.statCalls).toEqual([result.dataRoot]);
  });
  it.each(["../escape", "unknown", "operational/child", "", 1, null])("refuses an arbitrary slot before any spawn %#", value => {
    expect(() => prepareIsolatedDesktopCase(value as never)).toThrow(); expect(probe.calls).toHaveLength(0);
  });
  it.each(["relative/artifacts/qualification/visual-composer/d/fixture", path.resolve(".local-codex/outside"), ""])("refuses an unqualified root before any spawn %#", value => {
    vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", value);
    expect(() => prepareIsolatedDesktopCase("operational")).toThrow(); expect(probe.calls).toHaveLength(0);
  });
  it("refuses a sample index for a non-cold operational case", () => {
    expect(() => prepareIsolatedDesktopCase("operational", 0)).toThrow(); expect(probe.calls).toHaveLength(0);
  });
  it("refuses a lookalike qualification path outside this repository before stat or spawn", () => {
    vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", path.resolve("..", "outside-fixture", "artifacts/qualification/visual-composer/d/run"));
    expect(() => prepareIsolatedDesktopCase("operational")).toThrow();
    expect(probe.statCalls).toHaveLength(0); expect(probe.calls).toHaveLength(0);
  });
  it("retains an existing or dangling slot and requires a new run without seeding it", () => {
    probe.existing = true;
    expect(() => prepareIsolatedDesktopCase("operational")).toThrow("An existing operational profile requires a fresh qualification run.");
    expect(probe.statCalls).toEqual([path.join(base, "operational")]); expect(probe.calls).toHaveLength(0);
  });
});
