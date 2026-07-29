// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SystemRunWorkflowProfileSummary,
  SystemRunWorkflowSnapshot,
} from "../../../../contracts/system-run-workflow";
import {
  SystemRunWorkflow,
  type SystemRunWorkflowClient,
} from "../SystemRunWorkflow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SystemRunWorkflow", () => {
  it("loads summaries first and prepares only the explicitly opened profile", async () => {
    const prepare = vi.fn(async () => ({
      ok: true as const,
      value: snapshot(availableProfile),
    }));
    const client = clientWith({ prepare });
    await render(<SystemRunWorkflow workspaceId="workspace-a" client={client} />);

    await vi.waitFor(() => expect(client.listProfiles).toHaveBeenCalledOnce());
    expect(prepare).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Choose one verified system workflow");

    const profileSelect = select("Available workflow");
    await act(async () => {
      profileSelect.value = profileKey(availableProfile);
      profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Approved example release");

    await act(async () => button("Open workflow").click());
    await vi.waitFor(() =>
      expect(prepare).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        profileId: availableProfile.profileId,
        source: availableProfile.source,
      }),
    );
    expect(container?.textContent).toContain(
      "No system change or runtime action has occurred",
    );
    expect(container?.textContent).toContain("Create a record");
    expect(document.activeElement?.textContent).toContain(
      "Configure an action",
    );
  });

  it("requires review and confirmation, masks sensitive values, and invokes the exact snapshot", async () => {
    const invoke = vi.fn(async () => ({
      ok: true as const,
      value: resultSnapshot,
    }));
    const client = clientWith({ invoke });
    await render(<SystemRunWorkflow workspaceId="workspace-a" client={client} />);
    await openAvailableWorkflow();

    const actionSelect = select("Action");
    await act(async () => {
      actionSelect.value = "create-record";
      actionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await setInput("Record identifier *", "record-42");
    await setInput("Secret reference", "vault:test-reference");

    await act(async () => button("Review Create a record").click());
    expect(invoke).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Configured (hidden)");
    expect(container?.textContent).not.toContain("vault:test-reference");

    const confirmation = container?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(confirmation).not.toBeNull();
    await act(async () => {
      if (!confirmation) return;
      confirmation.click();
    });
    expect(button("Confirm Create a record").disabled).toBe(false);
    await act(async () => button("Confirm Create a record").click());

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-a",
        profileId: availableProfile.profileId,
        source: availableProfile.source,
        actionId: "create-record",
        expectedSnapshotRevision: "snapshot-1",
        values: {
          recordId: "record-42",
          secretReference: "vault:test-reference",
        },
      }),
    );
    expect(container?.textContent).toContain("Create a record completed.");
    expect(container?.textContent).toContain("Created record");
    expect(container?.textContent).toContain("allowed");
  });

  it("renders blocked profiles without preparing them", async () => {
    const client = clientWith();
    await render(<SystemRunWorkflow workspaceId="workspace-a" client={client} />);
    const profileSelect = select("Available workflow");
    await act(async () => {
      profileSelect.value = profileKey(blockedProfile);
      profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container?.textContent).toContain("Permission is required.");
    expect(button("Open workflow").disabled).toBe(true);
    expect(client.prepare).not.toHaveBeenCalled();
  });

  it("discards stale profile responses and clears private state when the workspace changes", async () => {
    const first = deferred<
      Awaited<ReturnType<SystemRunWorkflowClient["listProfiles"]>>
    >();
    const listProfiles = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        ok: true as const,
        value: [
          {
            ...availableProfile,
            title: "Workspace B workflow",
            source: {
              ...availableProfile.source,
              sourceId: "release-b",
              label: "Workspace B release",
            },
          },
        ],
      });
    const client = clientWith({ listProfiles });

    await render(
      <SystemRunWorkflow workspaceId="workspace-a" client={client} />,
      false,
    );
    expect(
      container?.querySelector(".ui-loading-spinner"),
    ).not.toBeNull();
    await act(async () => {
      root?.render(
        <SystemRunWorkflow workspaceId="workspace-b" client={client} />,
      );
    });
    await vi.waitFor(() => expect(container?.textContent).toContain("Workspace B workflow"));
    await act(async () =>
      first.resolve({ ok: true as const, value: [availableProfile] }),
    );

    expect(container?.textContent).toContain("Workspace B workflow");
    expect(container?.textContent).not.toContain("Records workflow");
  });

  it("shows sanitized preparation failures and lets the user retry", async () => {
    const prepare = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: "workflow.conflict" as const,
          message: "The workflow source changed. Refresh and try again.",
        },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: snapshot(availableProfile),
      });
    const client = clientWith({ prepare });
    await render(<SystemRunWorkflow workspaceId="workspace-a" client={client} />);

    const profileSelect = select("Available workflow");
    await act(async () => {
      profileSelect.value = profileKey(availableProfile);
      profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Open workflow").click());
    await vi.waitFor(() =>
      expect(container?.textContent).toContain(
        "The workflow source changed. Refresh and try again.",
      ),
    );
    expect(document.activeElement?.getAttribute("role")).toBe("alert");

    await act(async () => button("Open workflow").click());
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Create a record"),
    );
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("renders a newly registered profile using existing primitives without a reference-specific component", async () => {
    const extraProfile: SystemRunWorkflowProfileSummary = {
      ...availableProfile,
      profileId: "fixture.workflow.extra@1.0.0",
      title: "Future supported workflow",
      category: "fixture",
      source: {
        ...availableProfile.source,
        sourceId: "release-extra",
        label: "Future exact release",
      },
    };
    const client = clientWith({
      listProfiles: vi.fn(async () => ({
        ok: true as const,
        value: [availableProfile, extraProfile],
      })),
    });
    await render(<SystemRunWorkflow workspaceId="workspace-a" client={client} />);

    expect(select("Available workflow").options).toHaveLength(3);
    expect(container?.textContent).toContain("Future supported workflow");
  });

  it("invokes read-only actions directly and validates required fields before side-effect review", async () => {
    const directInvoke = vi.fn(async () => ({
      ok: true as const,
      value: {
        ...readSnapshot,
        snapshotRevision: "snapshot-read-2",
      },
    }));
    const directClient = clientWith({
      prepare: vi.fn(async () => ({
        ok: true as const,
        value: readSnapshot,
      })),
      invoke: directInvoke,
    });
    await render(
      <SystemRunWorkflow workspaceId="workspace-a" client={directClient} />,
    );
    await openWorkflow("Inspect records");
    await chooseAction("inspect-records");
    await act(async () => button("Inspect records").click());

    await vi.waitFor(() => expect(directInvoke).toHaveBeenCalledOnce());
    expect(directInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: "inspect-records",
        expectedSnapshotRevision: "snapshot-read-1",
        values: {},
      }),
    );
    expect(
      container?.querySelector('input[type="checkbox"]'),
    ).toBeNull();

    const validationInvoke = vi.fn();
    const validationClient = clientWith({ invoke: validationInvoke });
    await act(async () => {
      root?.render(
        <SystemRunWorkflow
          workspaceId="workspace-validation"
          client={validationClient}
        />,
      );
    });
    await vi.waitFor(() =>
      expect(validationClient.listProfiles).toHaveBeenCalled(),
    );
    await openAvailableWorkflow();
    await chooseAction("create-record");
    await act(async () => button("Review Create a record").click());

    expect(validationInvoke).not.toHaveBeenCalled();
    expect(container?.textContent).toContain(
      "Record identifier is required.",
    );
    expect(
      input("Record identifier *").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("renders every bounded result primitive and revokes image preview URLs", async () => {
    const createObjectURL = vi.fn(() => "blob:workflow-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = revokeObjectURL;
      },
    );
    const richClient = clientWith({
      prepare: vi.fn(async () => ({
        ok: true as const,
        value: richSnapshot,
      })),
    });
    await render(
      <SystemRunWorkflow workspaceId="workspace-a" client={richClient} />,
    );
    await openWorkflow("Service health");

    await vi.waitFor(() =>
      expect(
        container?.querySelector<HTMLImageElement>(
          'img[src="blob:workflow-preview"]',
        ),
      ).not.toBeNull(),
    );
    for (const expected of [
      "Workflow notice",
      "Service health",
      "Release details",
      "Reference rows",
      "Conversation transcript",
      "Generated artifacts",
      "Recent audit",
      "Diagnostics",
      "A bounded text preview.",
      "warning.example",
    ]) {
      expect(container?.textContent).toContain(expected);
    }
    expect(createObjectURL).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(
        <SystemRunWorkflow workspaceId="workspace-b" client={richClient} />,
      );
    });
    await vi.waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith(
        "blob:workflow-preview",
      ),
    );
  });
});

const availableProfile: SystemRunWorkflowProfileSummary = {
  schemaVersion: "1.0",
  profileId: "fixture.workflow.records@1.0.0",
  source: {
    kind: "approved-release",
    sourceId: "release-a",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    label: "Approved example release",
  },
  title: "Records workflow",
  description: "Create and inspect bounded records.",
  category: "data",
  availability: "available",
  blockers: [],
};

const blockedProfile: SystemRunWorkflowProfileSummary = {
  ...availableProfile,
  profileId: "fixture.workflow.blocked@1.0.0",
  title: "Blocked workflow",
  availability: "blocked",
  blockers: [
    {
      code: "workflow.fixture.forbidden",
      message: "Permission is required.",
    },
  ],
};

const snapshot = (
  profile: SystemRunWorkflowProfileSummary,
): SystemRunWorkflowSnapshot => ({
  schemaVersion: "1.0",
  profile,
  snapshotRevision: "snapshot-1",
  refreshedAt: "2026-07-28T00:00:00.000Z",
  blocks: [
    {
      blockId: "records",
      kind: "table",
      title: "Records",
      columns: [{ columnId: "recordId", label: "Record" }],
      rows: [],
      emptyMessage: "No records have been created.",
    },
  ],
  actions: [
    {
      actionId: "create-record",
      label: "Create a record",
      description: "Create one bounded record.",
      intent: "mutate",
      emphasis: "normal",
      requiresConfirmation: true,
      enabled: true,
      fields: [
        {
          fieldId: "recordId",
          label: "Record identifier",
          kind: "text",
          required: true,
          maximumLength: 160,
        },
        {
          fieldId: "secretReference",
          label: "Secret reference",
          kind: "secret-reference",
          required: false,
          sensitive: true,
          maximumLength: 200,
        },
      ],
    },
  ],
});

const resultSnapshot: SystemRunWorkflowSnapshot = {
  ...snapshot(availableProfile),
  snapshotRevision: "snapshot-2",
  blocks: [
    {
      blockId: "notice",
      kind: "notice",
      title: "Created record",
      message: "The authorized record was created.",
      tone: "success",
    },
    {
      blockId: "audit",
      kind: "audit",
      title: "Recent activity",
      items: [
        {
          entryId: "audit-1",
          action: "create-record",
          outcome: "allowed",
          occurredAt: "2026-07-28T00:00:00.000Z",
          summary: "The record was created.",
        },
      ],
    },
  ],
};

const readSnapshot: SystemRunWorkflowSnapshot = {
  ...snapshot(availableProfile),
  snapshotRevision: "snapshot-read-1",
  actions: [
    {
      actionId: "inspect-records",
      label: "Inspect records",
      description: "Read the current bounded records.",
      intent: "read",
      emphasis: "normal",
      requiresConfirmation: false,
      enabled: true,
      fields: [],
    },
  ],
};

const richSnapshot: SystemRunWorkflowSnapshot = {
  ...readSnapshot,
  blocks: [
    {
      blockId: "notice",
      kind: "notice",
      title: "Workflow notice",
      message: "The bounded snapshot is ready.",
      tone: "neutral",
    },
    {
      blockId: "status",
      kind: "status",
      title: "Service health",
      status: "ready",
      summary: "The service is available.",
    },
    {
      blockId: "details",
      kind: "key-value",
      title: "Release details",
      entries: [{ key: "revision", label: "Revision", value: 2 }],
    },
    {
      blockId: "table",
      kind: "table",
      title: "Reference rows",
      columns: [{ columnId: "name", label: "Name" }],
      rows: [{ rowId: "row-1", values: { name: "Example" } }],
    },
    {
      blockId: "transcript",
      kind: "transcript",
      title: "Conversation transcript",
      entries: [
        {
          entryId: "entry-1",
          role: "assistant",
          text: "A bounded response.",
        },
      ],
    },
    {
      blockId: "artifacts",
      kind: "artifacts",
      title: "Generated artifacts",
      items: [
        {
          artifactRef: "artifact:image",
          label: "Image preview",
          mediaType: "image/png",
          previewKind: "image",
          previewStatus: "ready",
          previewBytes: [137, 80, 78, 71],
        },
        {
          artifactRef: "artifact:text",
          label: "Text preview",
          previewKind: "text",
          previewStatus: "ready",
          previewText: "A bounded text preview.",
        },
      ],
    },
    {
      blockId: "audit",
      kind: "audit",
      title: "Recent audit",
      items: [
        {
          entryId: "audit-1",
          action: "inspect-records",
          outcome: "allowed",
          occurredAt: "2026-07-28T00:00:00.000Z",
          summary: "The bounded read was allowed.",
        },
      ],
    },
    {
      blockId: "diagnostics",
      kind: "diagnostics",
      title: "Diagnostics",
      items: [
        {
          severity: "warning",
          code: "warning.example",
          message: "An example bounded warning.",
        },
      ],
    },
  ],
};

function clientWith(
  overrides: Partial<SystemRunWorkflowClient> = {},
): SystemRunWorkflowClient {
  return {
    listProfiles:
      overrides.listProfiles ??
      vi.fn(async () => ({
        ok: true as const,
        value: [availableProfile, blockedProfile],
      })),
    prepare:
      overrides.prepare ??
      vi.fn(async () => ({
        ok: true as const,
        value: snapshot(availableProfile),
      })),
    invoke:
      overrides.invoke ??
      vi.fn(async () => ({
        ok: true as const,
        value: resultSnapshot,
      })),
  };
}

async function render(element: ReactNode, waitForReady = true) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  if (waitForReady) {
    await vi.waitFor(() =>
      expect(container?.querySelector(".ui-loading-spinner")).toBeNull(),
    );
  }
}

async function openAvailableWorkflow() {
  await openWorkflow("Create a record");
}

async function openWorkflow(expectedAction: string) {
  const profileSelect = select("Available workflow");
  await act(async () => {
    profileSelect.value = profileKey(availableProfile);
    profileSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => button("Open workflow").click());
  await vi.waitFor(() =>
    expect(container?.textContent).toContain(expectedAction),
  );
}

async function chooseAction(actionId: string) {
  const actionSelect = select("Action");
  await act(async () => {
    actionSelect.value = actionId;
    actionSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function select(label: string): HTMLSelectElement {
  const labels = Array.from(container?.querySelectorAll("label") ?? []);
  const owner = labels.find((candidate) =>
    candidate.textContent?.includes(label),
  );
  const element = owner?.querySelector("select");
  if (!element) throw new Error(`Select not found: ${label}`);
  return element;
}

async function setInput(label: string, value: string) {
  const target = input(label);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function input(label: string): HTMLInputElement {
  const labels = Array.from(container?.querySelectorAll("label") ?? []);
  const owner = labels.find((candidate) =>
    candidate.textContent?.includes(label.replace(" *", "")),
  );
  const element = owner?.querySelector("input");
  if (!element) throw new Error(`Input not found: ${label}`);
  return element;
}

function button(label: string): HTMLButtonElement {
  const element = Array.from(
    container?.querySelectorAll<HTMLButtonElement>("button") ?? [],
  ).find((candidate) => candidate.textContent?.includes(label));
  if (!element) throw new Error(`Button not found: ${label}`);
  return element;
}

function profileKey(profile: SystemRunWorkflowProfileSummary): string {
  return [
    profile.profileId,
    profile.source.kind,
    profile.source.sourceId,
    profile.source.sourceDigest ?? "",
    profile.source.sourceRevision ?? "",
  ].join("|");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
