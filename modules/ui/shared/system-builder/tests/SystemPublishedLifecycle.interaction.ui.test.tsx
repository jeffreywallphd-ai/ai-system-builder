// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemPublicationBuildSummary } from "../../../../contracts/system-build";
import type {
  SystemDeploymentLaunchDescriptor,
  SystemPublishedLifecycleAction,
  SystemPublishedLifecycleProjection,
} from "../../../../contracts/system-deployment";
import { SystemPublishedLifecycleCard } from "../SystemPublishedLifecycleCard";
import type { SystemPublishedLifecycleClient } from "../SystemPublishedLifecycleClient";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
});

describe("published build lifecycle controls", () => {
  it("installs and activates together, reports host-window start, and exposes Stop only while running", async () => {
    const invoke = vi.fn(
      async (input: {
        action: SystemPublishedLifecycleAction;
        expectedRevision: string;
      }) => {
        if (input.action === "install")
          return deploymentSuccess(
            projection(
              "active-stopped",
              "r2",
              ["start", "deactivate", "uninstall"],
              "visual",
            ),
          );
        if (input.action === "start")
          return deploymentSuccess({
            ...projection("running", "r3", ["stop"], "visual"),
            launchDescriptor,
          });
        if (input.action === "stop")
          return deploymentSuccess(
            projection(
              "active-stopped",
              "r4",
              ["start", "deactivate", "uninstall"],
              "visual",
            ),
          );
        return deploymentSuccess(
          projection("not-installed", "r5", ["install"]),
        );
      },
    );
    const client = {
      read: vi.fn(async () =>
        deploymentSuccess(projection("not-installed", "r1", ["install"])),
      ),
      invoke,
    } as unknown as SystemPublishedLifecycleClient;

    await mount(
      <SystemPublishedLifecycleCard
        workspaceId="workspace-a"
        build={build}
        client={client}
        visualStartNotice="The system opened in its own window."
      />,
    );

    await vi.waitFor(() => expect(button("Install")).toBeDefined());
    expect(document.body.textContent).not.toContain("Deployment identifier");
    expect(document.body.textContent).not.toContain("Open System");

    await act(async () => button("Install").click());
    expect(invoke).toHaveBeenLastCalledWith({
      workspaceId: "workspace-a",
      releaseId: "release-2",
      action: "install",
      expectedRevision: "r1",
    });
    expect(document.body.textContent).toContain("Installed and activated.");
    expect(button("Start")).toBeDefined();
    expect(button("Deactivate")).toBeDefined();
    expect(button("Uninstall")).toBeDefined();
    expect(findButton("Activate")).toBeUndefined();

    await act(async () => button("Start").click());
    expect(document.body.textContent).toContain("opened in its own window");
    expect(button("Stop")).toBeDefined();
    expect(findButton("Start")).toBeUndefined();
    expect(findButton("Deactivate")).toBeUndefined();
    expect(findButton("Uninstall")).toBeUndefined();

    await act(async () => button("Stop").click());
    expect(button("Start")).toBeDefined();
    expect(button("Deactivate")).toBeDefined();
    expect(button("Uninstall")).toBeDefined();
  });

  it("shows no controls when the lifecycle projection cannot be read", async () => {
    const client = {
      read: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "lifecycle.inactive-source",
          message: "This release is no longer available.",
        },
      })),
      invoke: vi.fn(),
    } as unknown as SystemPublishedLifecycleClient;
    await mount(
      <SystemPublishedLifecycleCard
        workspaceId="workspace-a"
        build={build}
        client={client}
      />,
    );
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("no longer available"),
    );
    expect(findButton("Install")).toBeUndefined();
    expect(findButton("Start")).toBeUndefined();
    expect(findButton("Uninstall")).toBeUndefined();
  });

  it("keeps a failed Start message visible after refreshing authoritative status", async () => {
    const client = {
      read: vi.fn(async () =>
        deploymentSuccess(
          projection(
            "active-stopped",
            "r1",
            ["start", "deactivate", "uninstall"],
            "visual",
          ),
        ),
      ),
      invoke: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "deployment.runtime-window.unavailable",
          message: "The published system window could not be opened.",
        },
      })),
    } as unknown as SystemPublishedLifecycleClient;
    await mount(
      <SystemPublishedLifecycleCard
        workspaceId="workspace-a"
        build={build}
        client={client}
      />,
    );
    await vi.waitFor(() => expect(button("Start")).toBeDefined());

    await act(async () => button("Start").click());

    expect(document.body.textContent).toContain(
      "The published system window could not be opened.",
    );
    expect(client.read).toHaveBeenCalledTimes(2);
    expect(button("Start")).toBeDefined();
  });

  it("discards a late Start response after the selected published build changes", async () => {
    const pendingStart =
      deferred<
        ReturnType<typeof deploymentSuccess<SystemPublishedLifecycleProjection>>
      >();
    const firstClient = {
      read: vi.fn(async () =>
        deploymentSuccess(
          projection(
            "active-stopped",
            "r1",
            ["start", "deactivate", "uninstall"],
            "visual",
          ),
        ),
      ),
      invoke: vi.fn(() => pendingStart.promise),
    } as unknown as SystemPublishedLifecycleClient;
    const secondBuild = {
      ...build,
      buildId: "build-3",
      releaseId: "release-3",
      versionNumber: 3,
    } as unknown as SystemPublicationBuildSummary;
    const secondClient = {
      read: vi.fn(async () =>
        deploymentSuccess({
          ...projection("not-installed", "next-r1", ["install"]),
          releaseId: "release-3",
        }),
      ),
      invoke: vi.fn(),
    } as unknown as SystemPublishedLifecycleClient;

    await mount(
      <SystemPublishedLifecycleCard
        workspaceId="workspace-a"
        build={build}
        client={firstClient}
      />,
    );
    await vi.waitFor(() => expect(button("Start")).toBeDefined());
    act(() => {
      button("Start").click();
      button("Start").click();
    });
    expect(firstClient.invoke).toHaveBeenCalledOnce();
    await act(async () => {
      root?.render(
        <SystemPublishedLifecycleCard
          workspaceId="workspace-a"
          build={secondBuild}
          client={secondClient}
        />,
      );
    });
    await vi.waitFor(() => expect(button("Install")).toBeDefined());
    await act(async () => {
      pendingStart.resolve(
        deploymentSuccess({
          ...projection("running", "r2", ["stop"], "visual"),
          launchDescriptor,
        }),
      );
      await pendingStart.promise;
    });
    expect(button("Install")).toBeDefined();
  });
});

const build = {
  buildId: "build-2",
  systemRevisionId: "revision-2",
  versionNumber: 2,
  status: "succeeded",
  publicationStatus: "published",
  statusMessage: "Published",
  releaseId: "release-2",
  publishedAt: "2026-07-28T12:02:00.000Z",
  createdAt: "2026-07-28T12:00:00.000Z",
  outputCount: 2,
  evidenceCount: 1,
  diagnosticCount: 0,
} as unknown as SystemPublicationBuildSummary;

const launchDescriptor = {
  schemaVersion: "1.0",
  kind: "trusted-declarative",
  releaseId: "release-2",
  releaseDigest: `sha256:${"2".repeat(64)}`,
  runtimeProfileId: "builtin.runtime.controlled-chatbot@1.0.0",
} as unknown as SystemDeploymentLaunchDescriptor;

function projection(
  state: SystemPublishedLifecycleProjection["state"],
  revision: string,
  eligibleActions: readonly SystemPublishedLifecycleAction[],
  runtimeKind?: SystemPublishedLifecycleProjection["runtimeKind"],
): SystemPublishedLifecycleProjection {
  return {
    schemaVersion: "1.0",
    releaseId: "release-2",
    state,
    revision,
    eligibleActions,
    health:
      state === "running"
        ? "ready"
        : state === "not-installed"
          ? "unknown"
          : "stopped",
    runtimeKind,
    diagnostics: [],
  } as unknown as SystemPublishedLifecycleProjection;
}

function deploymentSuccess<T>(value: T) {
  return { ok: true as const, value };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function mount(element: React.ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(
    document.body.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent === label);
}

function button(label: string): HTMLButtonElement {
  const result = findButton(label);
  if (!result) throw new Error(`Missing ${label} button.`);
  return result;
}
