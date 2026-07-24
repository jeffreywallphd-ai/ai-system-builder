// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SystemBuilderManagementItem,
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import { SystemManagementWorkspace } from "../SystemManagementWorkspace";
import type { SystemBuilderClient } from "../SystemBuilderWorkspace";

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

describe("SystemManagementWorkspace", () => {
  it("lists systems, previews the exact revision, and hands a system to Compose", async () => {
    const item = managementItem();
    const revision = systemRevision();
    const onOpenInCompose = vi.fn();
    const client = systemClient({ item, revision });

    await renderWorkspace(client, onOpenInCompose);

    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Customer portal"),
    );
    expect(container?.textContent).toContain("Published");
    expect(container?.textContent).toContain("2 assets · 1 releases");

    await act(async () => button(container!, "Preview").click());
    const previewDialog = await vi.waitFor(() => {
      const dialog =
        document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.textContent).toContain("Preview: Customer portal");
      return dialog!;
    });
    expect(client.readRevision).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      systemId: "system-1",
      revisionId: "revision-2",
    });
    expect(previewDialog.textContent).toContain(
      "does not execute backend logic",
    );

    await act(async () =>
      previewDialog
        .querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')
        ?.click(),
    );
    await act(async () => button(container!, "Open in Compose").click());
    expect(onOpenInCompose).toHaveBeenCalledWith("system-1");
  });

  it("duplicates and archive-deletes without discarding immutable history", async () => {
    const item = managementItem();
    const client = systemClient({ item, revision: systemRevision() });
    const onActiveSystemsChanged = vi.fn();

    await renderWorkspace(client, vi.fn(), onActiveSystemsChanged);
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Customer portal"),
    );

    await act(async () => button(container!, "Duplicate").click());
    const cloneDialog = await dialogContaining("Duplicate Customer portal");
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => button(cloneDialog, "Duplicate system").click());
    await vi.waitFor(() =>
      expect(client.clone).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        sourceSystemId: "system-1",
        name: "Customer portal copy",
      }),
    );
    expect(onActiveSystemsChanged).toHaveBeenCalledTimes(1);

    await vi.waitFor(() =>
      expect(container?.textContent).toContain(
        "Customer portal copy was created",
      ),
    );
    await act(async () => button(container!, "Delete").click());
    const deleteDialog = await dialogContaining("Delete Customer portal?");
    expect(deleteDialog.textContent).toContain(
      "Immutable revisions and releases are retained",
    );
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => button(deleteDialog, "Delete system").click());

    await vi.waitFor(() =>
      expect(client.archive).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        systemId: "system-1",
        expectedRevision: 4,
      }),
    );
    expect(onActiveSystemsChanged).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain(
      "can be restored from the Archived view",
    );
  });

  it("restores an archived system from the same management list", async () => {
    const item = managementItem({ archived: true });
    const client = systemClient({ item, revision: systemRevision() });
    const onActiveSystemsChanged = vi.fn();

    await renderWorkspace(client, vi.fn(), onActiveSystemsChanged);
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Archived"),
    );
    await act(async () => button(container!, "Restore").click());

    await vi.waitFor(() =>
      expect(client.restore).toHaveBeenCalledWith({
        workspaceId: "workspace-a",
        systemId: "system-1",
        expectedRevision: 4,
      }),
    );
    expect(onActiveSystemsChanged).toHaveBeenCalledOnce();
    expect(container?.textContent).toContain(
      "Customer portal was restored to active systems",
    );
  });
});

async function renderWorkspace(
  client: SystemBuilderClient,
  onOpenInCompose: (systemId: string) => void,
  onActiveSystemsChanged?: () => void,
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <SystemManagementWorkspace
        workspaceId="workspace-a"
        client={client}
        onOpenInCompose={onOpenInCompose}
        onActiveSystemsChanged={onActiveSystemsChanged}
      />,
    );
  });
}

function button(scope: ParentNode, label: string): HTMLButtonElement {
  const match = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function dialogContaining(text: string): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const match = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).find((candidate) => candidate.textContent?.includes(text));
    expect(match).toBeDefined();
    return match!;
  });
}

function managementItem(
  overrides: { readonly archived?: boolean } = {},
): SystemBuilderManagementItem {
  const archived = overrides.archived ?? false;
  return {
    systemId: "system-1",
    name: "Customer portal",
    description: "Customer self-service system",
    designStatus: archived ? "archived" : "validated",
    archived,
    publicationStatus: "published",
    recordRevision: 4,
    currentRevisionId: "revision-2",
    assetCount: 2,
    releaseCount: 1,
    latestRelease: {
      releaseId: "release-1",
      systemRevisionId: "revision-2",
      approvedAt: "2026-07-17T12:00:00.000Z",
    },
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    actions: {
      canPreview: true,
      canOpenInCompose: !archived,
      canDelete: !archived,
      canRestore: archived,
      deleteStrategy: "archive",
    },
  } as unknown as SystemBuilderManagementItem;
}

function systemRevision(): SystemBuilderRevision {
  return {
    revisionId: "revision-2",
    systemId: "system-1",
    targetWorkspaceId: "workspace-a",
    revisionNumber: 2,
    composition: {
      compositionId: "system-1.composition",
      compositionType: "system",
      displayName: "Customer portal",
      version: "0.2.0",
      lifecycleStatus: "validated",
      rootInstanceRefs: [],
      instanceRefs: [],
      bindingRefs: [],
      provenance: { sourceKind: "human-authored" },
    },
    instances: [],
    bindings: [],
    placements: [],
    validationIssues: [],
    createdAt: "2026-07-18T12:00:00.000Z",
    createdBy: "person-1",
  } as unknown as SystemBuilderRevision;
}

function managementPage(items: readonly SystemBuilderManagementItem[]) {
  return Promise.resolve({
    ok: true as const,
    value: {
      items,
      totalCount: items.length,
      query: {
        view: "active" as const,
        sort: "updated-desc" as const,
        limit: 25,
      },
    },
  });
}

function systemClient({
  item,
  revision,
}: {
  readonly item: SystemBuilderManagementItem;
  readonly revision: SystemBuilderRevision;
}): SystemBuilderClient {
  const record = {
    systemId: "system-copy",
    targetWorkspaceId: "workspace-a",
    name: "Customer portal copy",
    status: "draft",
    revision: 1,
    currentRevisionId: "revision-copy-1",
    composition: revision.composition,
    createdAt: "2026-07-18T13:00:00.000Z",
    updatedAt: "2026-07-18T13:00:00.000Z",
    createdBy: "person-1",
    updatedBy: "person-1",
  } as unknown as SystemBuilderRecord;
  return {
    listManagement: vi.fn(() => managementPage([item])),
    readRevision: vi.fn().mockResolvedValue({ ok: true, value: revision }),
    listComposerAssets: vi.fn().mockResolvedValue({
      ok: true,
      value: { items: [], totalCount: 0 },
    }),
    archive: vi.fn().mockResolvedValue({ ok: true, value: record }),
    restore: vi.fn().mockResolvedValue({ ok: true, value: record }),
    clone: vi.fn().mockResolvedValue({ ok: true, value: record }),
    list: vi.fn(),
    listTemplates: vi.fn(),
    createFromTemplate: vi.fn(),
    create: vi.fn(),
    saveRevision: vi.fn(),
    listRevisions: vi.fn(),
  } as unknown as SystemBuilderClient;
}
