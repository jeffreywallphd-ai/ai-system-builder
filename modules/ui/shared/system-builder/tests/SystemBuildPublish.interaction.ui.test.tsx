// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SystemBuildRecord,
  SystemBuildResult,
  SystemPublicationWorkspace,
} from "../../../../contracts/system-build";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import { SystemBuildTestModal } from "../SystemBuildTestModal";
import { SystemPublishWorkspace } from "../SystemPublishWorkspace";
import { NotificationTestHarness, readNotificationMessages } from "../../notifications/tests/NotificationTestHarness";
import type { SystemBuildClient } from "../SystemBuildReleaseWorkflow";
import type { SystemPublishedLifecycleClient } from "../SystemPublishedLifecycleClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
});

describe("guided System build and publication interactions", () => {
  it("prepares the exact saved version and requests one host-guided build", async () => {
    const prepare = vi.fn(async (
      _input: Parameters<SystemBuildClient["prepare"]>[0],
    ) => success({
      systemId: "system-1",
      systemRevisionId: "revision-2",
      systemName: "Support assistant",
      revisionNumber: 2,
      targetLabel: "This computer",
      status: "ready" as const,
      checks: [
        {
          id: "current" as const,
          label: "Current version",
          status: "passed" as const,
          message: "This is the current saved version.",
        },
      ],
    }));
    const request = vi.fn(async (
      _input: Parameters<SystemBuildClient["request"]>[0],
    ) => success(buildRecord()));
    const client = { prepare, request } as unknown as SystemBuildClient;

    await mount(
      <SystemBuildTestModal
        open
        workspaceId="workspace-a"
        system={{ systemId: "system-1", name: "Support assistant" } as SystemBuilderRecord}
        revision={{ revisionId: "revision-2" } as SystemBuilderRevision}
        buildClient={client}
        onClose={vi.fn()}
      />,
    );

    await vi.waitFor(() => expect(prepare).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      systemId: "system-1",
      systemRevisionId: "revision-2",
    }));
    expect(document.body.textContent).toContain("This computer");
    const buildAction = button(document.body, "Build & test");
    await vi.waitFor(() => expect(document.activeElement).toBe(buildAction));
    await act(async () => buildAction.click());
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "workspace-a",
      systemId: "system-1",
      systemRevisionId: "revision-2",
    });
    expect(request.mock.calls[0]?.[0]).not.toHaveProperty("deploymentProfile");
    expect(request.mock.calls[0]?.[0]).not.toHaveProperty("toolchainProfile");
    expect(document.body.textContent).toContain("Build and checks completed");
    expect(document.body.textContent).toContain("ready to review in Publish");
  });

  it("defaults to the newest ready build and publishes only after explicit confirmation", async () => {
    const publicationWorkspace = vi
      .fn()
      .mockResolvedValueOnce(success(publicationFixture()))
      .mockResolvedValueOnce(success(publishedFixture()));
    const approve = vi.fn(async (
      _input: Parameters<SystemBuildClient["approve"]>[0],
    ) => success({ releaseId: "release-2" }));
    const client = { publicationWorkspace, approve } as unknown as SystemBuildClient;
    const lifecycleClient = {
      read: vi.fn(async () => success({
        schemaVersion: "1.0",
        releaseId: "release-2",
        state: "not-installed",
        revision: "lifecycle-1",
        eligibleActions: ["install"],
        health: "unknown",
        diagnostics: [],
      })),
      invoke: vi.fn(),
    } as unknown as SystemPublishedLifecycleClient;
    await mount(
      <SystemPublishWorkspace
        workspaceId="workspace-a"
        buildClient={client}
        lifecycleClient={lifecycleClient}
      />,
    );

    const buildSelect = await vi.waitFor(() => {
      const select = document.body.querySelectorAll<HTMLSelectElement>("select")[1];
      expect(select).not.toBeNull();
      expect(select?.value).toBe("build-2");
      return select!;
    });
    expect(buildSelect.value).toBe("build-2");
    expect(document.body.textContent).toContain("Ready to publish");

    await act(async () => button(document.body, "Publish build").click());
    expect(approve).not.toHaveBeenCalled();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("Support assistant");
    expect(dialog?.textContent).toContain("build 2");
    expect(dialog?.textContent).toContain("cannot be changed");

    await act(async () => button(dialog!, "Publish").click());
    await vi.waitFor(() => expect(approve).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      buildId: "build-2",
      expectedLockDigest: digest("2"),
    }));
    expect(publicationWorkspace).toHaveBeenCalledTimes(2);
    expect(readNotificationMessages(document.body)).toContain("Support assistant, build 2, was published.");
    expect(container?.textContent).not.toContain("Support assistant, build 2, was published.");
    expect(document.body.textContent).toContain("Published builds");
    expect(document.body.textContent).toContain("Install");
    expect(document.body.textContent).not.toContain("Deployment identifier");
    expect(document.body.textContent).not.toContain("Open System");
  });
});

async function mount(element: React.ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<NotificationTestHarness>{element}</NotificationTestHarness>));
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const result = Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent === label);
  if (!result) throw new Error(`Missing ${label} button.`);
  return result;
}

function success<T>(value: T): SystemBuildResult<T> {
  return { ok: true, value };
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64)}`;
}

function buildRecord(): SystemBuildRecord {
  return {
    buildId: "build-2",
    targetWorkspaceId: "workspace-a",
    systemId: "system-1",
    systemRevisionId: "revision-2",
    status: "succeeded",
    revision: 3,
    lockDigest: digest("2"),
    outputArtifacts: [],
    evidenceArtifacts: [],
    diagnostics: [],
    assurance: "repeatable",
    cancellationRequested: false,
    createdAt: "2026-07-28T12:00:00.000Z",
    completedAt: "2026-07-28T12:01:00.000Z",
    requestedBy: "person-1",
  } as unknown as SystemBuildRecord;
}

function publicationFixture(): SystemPublicationWorkspace {
  return {
    systems: [{
      systemId: "system-1",
      name: "Support assistant",
      builds: [
        {
          buildId: "build-3",
          systemRevisionId: "revision-2",
          versionNumber: 3,
          status: "failed",
          publicationStatus: "unavailable",
          statusMessage: "Build checks did not pass",
          createdAt: "2026-07-28T13:00:00.000Z",
          outputCount: 0,
          evidenceCount: 0,
          diagnosticCount: 1,
        },
        {
          buildId: "build-2",
          systemRevisionId: "revision-2",
          versionNumber: 2,
          status: "succeeded",
          publicationStatus: "ready",
          statusMessage: "Ready to publish",
          expectedLockDigest: digest("2"),
          createdAt: "2026-07-28T12:00:00.000Z",
          outputCount: 2,
          evidenceCount: 1,
          diagnosticCount: 0,
        },
      ],
    }],
  } as unknown as SystemPublicationWorkspace;
}

function publishedFixture(): SystemPublicationWorkspace {
  const fixture = publicationFixture();
  return {
    systems: [{
      ...fixture.systems[0]!,
      builds: fixture.systems[0]!.builds.map((build) =>
        String(build.buildId) === "build-2"
          ? {
              ...build,
              publicationStatus: "published" as const,
              statusMessage: "Published",
              releaseId: "release-2",
              publishedAt: "2026-07-28T12:02:00.000Z",
            }
          : build,
      ),
    }],
  } as unknown as SystemPublicationWorkspace;
}
