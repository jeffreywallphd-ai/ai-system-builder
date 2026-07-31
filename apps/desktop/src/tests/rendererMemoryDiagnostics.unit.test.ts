import { describe, expect, it } from "../../../../modules/testing/node-test";

import {
  createRendererMemorySnapshot,
  recordRendererMemorySnapshot,
} from "../renderer/diagnostics/rendererMemoryDiagnostics";

describe("renderer memory diagnostics", () => {
  const performanceLike = {
    now: () => 42.4,
    memory: {
      jsHeapSizeLimit: 300,
      totalJSHeapSize: 200,
      usedJSHeapSize: 100,
    },
  } as Performance & {
    readonly memory: {
      readonly jsHeapSizeLimit: number;
      readonly totalJSHeapSize: number;
      readonly usedJSHeapSize: number;
    };
  };

  it("does not emit when disabled", () => {
    const lines: string[] = [];

    const snapshot = recordRendererMemorySnapshot(
      { milestone: "renderer.test.disabled", component: "renderer-test" },
      { enabled: false, performanceLike, log: (line) => lines.push(line) },
    );

    expect(snapshot).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it("emits a renderer snapshot with best-effort performance memory when enabled", () => {
    const lines: string[] = [];

    const snapshot = recordRendererMemorySnapshot(
      { milestone: "renderer.test.enabled", component: "renderer-test", detail: { activePage: "home" } },
      {
        enabled: true,
        now: () => "2026-05-15T00:00:00.000Z",
        performanceLike,
        log: (line) => lines.push(line),
      },
    );

    expect(lines.length).toBe(1);
    expect(snapshot).toEqual({
      event: "desktop.renderer.memory.snapshot",
      timestamp: "2026-05-15T00:00:00.000Z",
      milestone: "renderer.test.enabled",
      component: "renderer-test",
      process: {
        type: "renderer",
        uptimeMs: 42,
      },
      memory: {
        jsHeapSizeLimit: 300,
        totalJSHeapSize: 200,
        usedJSHeapSize: 100,
      },
      detail: { activePage: "home" },
    });
    expect(JSON.parse(lines[0])).toEqual(snapshot);
  });
});
