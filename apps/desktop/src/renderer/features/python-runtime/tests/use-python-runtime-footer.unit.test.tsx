import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePythonRuntimeFooter } from "../hooks/usePythonRuntimeFooter";
import type { DesktopPythonRuntimeClient } from "../api/desktopPythonRuntimeClient";

interface HookProbeProps {
  client: DesktopPythonRuntimeClient;
  enabled?: boolean;
}

function HookProbe({ client, enabled = true }: HookProbeProps) {
  const view = usePythonRuntimeFooter({ enabled, client });
  return (
    <div>
      <p data-testid="status">{view.statusLabel}</p>
      <p data-testid="health">{view.healthLabel}</p>
      <p data-testid="loading">{view.loading ? "loading" : "idle"}</p>
      <p data-testid="log-count">{String(view.logs.length)}</p>
    </div>
  );
}

function createSnapshot() {
  return {
    supervisorStatus: "ready" as const,
    healthy: true,
    runtimeStatus: "ready",
    capabilities: ["prepare-training-dataset"],
    logs: [],
    loadedModels: [],
    activeTaskCount: 0,
  };
}

describe("usePythonRuntimeFooter", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
    }
    mountedContainer?.remove();
    mountedRoot = undefined;
    mountedContainer = undefined;
    vi.useRealTimers();
  });

  it("polls runtime status every 10 seconds", async () => {
    const client: DesktopPythonRuntimeClient = {
      readStatus: vi.fn().mockResolvedValue(createSnapshot()),
      controlRuntime: vi.fn().mockResolvedValue(createSnapshot()),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={client} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(client.readStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(client.readStatus).toHaveBeenCalledTimes(4);
    expect(container.querySelector("[data-testid='loading']")?.textContent).toBe("idle");
  });

  it("does not start overlapping background polls while a refresh is in-flight", async () => {
    let resolveReadStatus: ((value: ReturnType<typeof createSnapshot>) => void) | undefined;
    const pending = new Promise<ReturnType<typeof createSnapshot>>((resolve) => {
      resolveReadStatus = resolve;
    });
    const client: DesktopPythonRuntimeClient = {
      readStatus: vi.fn().mockReturnValue(pending),
      controlRuntime: vi.fn().mockResolvedValue(createSnapshot()),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;

    await act(async () => {
      root.render(<HookProbe client={client} />);
    });
    await act(async () => {
      vi.advanceTimersByTime(25_000);
      await Promise.resolve();
    });

    expect(client.readStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReadStatus?.(createSnapshot());
      await Promise.resolve();
    });
  });
});
