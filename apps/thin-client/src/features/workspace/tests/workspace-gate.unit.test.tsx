import { JSDOM } from "jsdom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../../modules/testing/node-test";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
(globalThis as any).InputEvent = dom.window.InputEvent;
(globalThis as any).FormData = dom.window.FormData;

import {
  ActiveWorkspaceProvider,
  WorkspaceCreateForm,
  WorkspaceGate,
  WorkspaceSwitcher,
  type WorkspaceClient,
  type WorkspaceUiRecord,
} from "../index";

function client(
  records: WorkspaceUiRecord[] = [],
  selected?: string,
): WorkspaceClient {
  return {
    listWorkspaces: testDouble.fn(async () => records),
    readActiveWorkspaceSelection: testDouble.fn(async () => ({
      workspaceId: selected,
    })),
    saveActiveWorkspaceSelection: testDouble.fn(async (id) => {
      selected = id;
    }),
    clearActiveWorkspaceSelection: testDouble.fn(async () => {
      selected = undefined;
    }),
    createWorkspace: testDouble.fn(async (input) => {
      const record = {
        id: "workspace.generated-backend-id",
        displayName: input.name,
        status: "active",
        includeSystemFoundationAssets: input.includeSystemFoundationAssets,
        createdAt: "2026-05-14T00:00:00.000Z",
      } as WorkspaceUiRecord;
      records.push(record);
      selected = record.id;
      return record;
    }),
  };
}

describe("thin-client WorkspaceGate", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });
  async function render(
    workspaceClient: WorkspaceClient,
    childRenderer = testDouble.fn(() => <div>Feature client content</div>),
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ActiveWorkspaceProvider client={workspaceClient}>
          <WorkspaceGate pageLabel="Assets">{childRenderer}</WorkspaceGate>
        </ActiveWorkspaceProvider>,
      );
    });
    await act(async () => {});
    return childRenderer;
  }

  it("does not render child feature content before a workspace is active", async () => {
    const childRenderer = await render(client());
    expect(container!.textContent).toContain(
      "Create a workspace to use Assets, Artifacts, Data, Models, and Images.",
    );
    expect(container!.textContent).toContain(
      "Include System Foundation assets",
    );
    expect(container!.textContent).not.toContain("Feature client content");
    expect(childRenderer).not.toHaveBeenCalled();
  });

  it("creates through the workspace client and does not slug display names into ids", async () => {
    const workspaceClient = client();
    await render(workspaceClient);
    const input = container!.querySelector(
      "input[placeholder='My Project']",
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "My Project");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container!
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await act(async () => {});
    expect(workspaceClient.createWorkspace).toHaveBeenCalledWith({
      name: "My Project",
      includeSystemFoundationAssets: true,
    });
    expect(container!.textContent).toContain("Feature client content");
    expect(
      JSON.stringify((workspaceClient.createWorkspace as any).mock.calls),
    ).not.toContain("my-project");
  });

  it("keeps empty-name validation local when navigating away", async () => {
    const records = [
      {
        id: "workspace.alpha",
        displayName: "Alpha Project",
        status: "active",
        createdAt: "2026-05-14T00:00:00.000Z",
      } as WorkspaceUiRecord,
    ];
    const workspaceClient = client(records, "workspace.alpha");
    const NavigationHarness = () => {
      const [showCreate, setShowCreate] = useState(true);
      return (
        <>
          {showCreate ? (
            <WorkspaceCreateForm compact />
          ) : (
            <WorkspaceGate pageLabel="Assets">
              <div>Destination content</div>
            </WorkspaceGate>
          )}
          <button type="button" onClick={() => setShowCreate(false)}>
            Navigate away
          </button>
        </>
      );
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ActiveWorkspaceProvider client={workspaceClient}>
          <NavigationHarness />
        </ActiveWorkspaceProvider>,
      );
    });
    await act(async () => {});

    await act(async () => {
      container!
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(container!.textContent).toContain("Enter a workspace name.");
    expect(workspaceClient.createWorkspace).not.toHaveBeenCalled();
    const navigateButton = Array.from(
      container!.querySelectorAll("button"),
    ).find((button) => button.textContent === "Navigate away");
    await act(async () => {
      navigateButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(container!.textContent).toContain("Destination content");
    expect(container!.textContent).not.toContain("Enter a workspace name.");
  });

  it("gates safely when persisted selection points to a missing workspace", async () => {
    await render(client([], "workspace.missing"));
    expect(container!.textContent).toContain("This workspace is unavailable.");
    expect(container!.textContent).not.toContain("Feature client content");
  });

  it("switches by display name through the workspace client", async () => {
    const records = [
      {
        id: "workspace.alpha",
        displayName: "Alpha Project",
        status: "active",
        createdAt: "2026-05-14T00:00:00.000Z",
      } as WorkspaceUiRecord,
      {
        id: "workspace.beta",
        displayName: "Beta Project",
        status: "active",
        createdAt: "2026-05-14T00:00:00.000Z",
      } as WorkspaceUiRecord,
    ];
    const workspaceClient = client(records, "workspace.alpha");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ActiveWorkspaceProvider client={workspaceClient}>
          <WorkspaceSwitcher />
        </ActiveWorkspaceProvider>,
      );
    });
    await act(async () => {});

    expect(container!.textContent).toContain(
      "Current workspace: Alpha Project",
    );
    expect(container!.textContent).not.toContain("workspace.alpha");
    const selector = container!.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )!.set!.call(selector, "workspace.beta");
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const changeButton = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent === "Change workspace",
    );
    await act(async () => {
      changeButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await act(async () => {});

    expect(workspaceClient.saveActiveWorkspaceSelection).toHaveBeenCalledWith(
      "workspace.beta",
    );
    expect(container!.textContent).toContain("Current workspace: Beta Project");
    expect(container!.textContent).not.toContain("workspace.beta");
  });
});
