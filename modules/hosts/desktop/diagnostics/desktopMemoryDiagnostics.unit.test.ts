import { describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  createDesktopMemorySnapshot,
  recordDesktopMemorySnapshot,
} from "./desktopMemoryDiagnostics";

describe("desktop memory diagnostics", () => {
  const processLike = {
    pid: 1234,
    platform: "linux",
    arch: "x64",
    versions: {
      node: "20.0.0",
      electron: "38.0.0",
      chrome: "140.0.0",
    },
    uptime: () => 1.25,
    memoryUsage: () => ({
      rss: 100,
      heapTotal: 80,
      heapUsed: 40,
      external: 10,
      arrayBuffers: 5,
    }),
  };

  it("does not emit snapshots when diagnostics are disabled", () => {
    const log = testDouble.fn<(line: string) => void>();

    const snapshot = recordDesktopMemorySnapshot(
      { milestone: "desktop.test.disabled", component: "desktop-test" },
      { env: {}, processLike, log },
    );

    expect(snapshot).toBeUndefined();
    expect(log.mock.calls).toEqual([]);
  });

  it("includes stable required fields when diagnostics are enabled", () => {
    const lines: string[] = [];

    const snapshot = recordDesktopMemorySnapshot(
      { milestone: "desktop.test.enabled", component: "desktop-test", detail: { stage: "unit" } },
      {
        env: { DESKTOP_MEMORY_DIAGNOSTICS: "1" },
        now: () => "2026-05-15T00:00:00.000Z",
        processLike,
        log: (line) => lines.push(line),
      },
    );

    expect(lines.length).toBe(1);
    expect(snapshot).toEqual({
      event: "desktop.memory.snapshot",
      timestamp: "2026-05-15T00:00:00.000Z",
      milestone: "desktop.test.enabled",
      component: "desktop-test",
      process: {
        pid: 1234,
        type: "node",
        uptimeMs: 1250,
      },
      memory: {
        rss: 100,
        heapTotal: 80,
        heapUsed: 40,
        external: 10,
        arrayBuffers: 5,
      },
      system: {
        platform: "linux",
        arch: "x64",
        versions: {
          node: "20.0.0",
          electron: "38.0.0",
          chrome: "140.0.0",
        },
      },
      detail: { stage: "unit" },
    });
    expect(JSON.parse(lines[0])).toEqual(snapshot);
  });

  it("does not throw when optional fields are unavailable", () => {
    const snapshot = createDesktopMemorySnapshot(
      { milestone: "desktop.test.optional", component: "desktop-test" },
      {
        now: () => "2026-05-15T00:00:00.000Z",
        processLike: {},
      },
    );

    expect(snapshot.memory).toBeUndefined();
    expect(snapshot.process.uptimeMs).toBeUndefined();
    expect(snapshot.system.versions).toEqual({});
  });
});
