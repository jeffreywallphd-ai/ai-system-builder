import { webcrypto } from "node:crypto";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  IngestionTaskRecord,
  IngestionTaskTransportCommand,
} from "../../../../../modules/contracts/ingestion";
import { App } from "../App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});
Object.defineProperty(window, "crypto", {
  configurable: true,
  value: webcrypto,
});
const deterministicDigest = async () => new Uint8Array(32).buffer;
Object.defineProperty(globalThis.crypto.subtle, "digest", {
  configurable: true,
  value: deterministicDigest,
});
Object.defineProperty(window.crypto.subtle, "digest", {
  configurable: true,
  value: deterministicDigest,
});

function ingestionTask(
  status: IngestionTaskRecord["status"],
  acceptedBytes: number,
  fileStatus: IngestionTaskRecord["files"][number]["status"],
): IngestionTaskRecord {
  return {
    schemaVersion: "1.0",
    taskId: "ingestion.upload" as never,
    workspaceId: "workspace.upload" as never,
    kind: "file-batch",
    status,
    files: [
      {
        fileId: "file.upload" as never,
        checkpointId: "checkpoint.upload",
        fileName: "train.csv",
        mediaType: "text/csv",
        totalBytes: 3,
        status: fileStatus,
        acceptedBytes,
        nextChunkIndex: acceptedBytes ? 1 : 0,
        ...(acceptedBytes
          ? {
              lastChunk: {
                index: 0,
                sizeBytes: 3,
                digest: `sha256:${"0".repeat(64)}` as never,
              },
            }
          : {}),
        ...(fileStatus === "finalized"
          ? {
              output: {
                key: "uploads/train.csv",
                mediaType: "text/csv",
                sizeBytes: 3,
                digest: `sha256:${"1".repeat(64)}` as never,
              },
            }
          : {}),
      },
    ],
    progress: {
      acceptedBytes,
      totalBytes: 3,
      completedItems: fileStatus === "finalized" ? 1 : 0,
      totalItems: 1,
      percent: fileStatus === "finalized" ? 100 : acceptedBytes ? 100 : 0,
      message: status === "succeeded" ? "All files are ready." : "Adding files.",
    },
    revision: status === "queued" ? 1 : status === "transferring" ? 2 : 3,
    cleanupPending: status !== "succeeded",
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z",
    ...(status === "succeeded"
      ? { completedAt: "2026-07-30T12:00:00.000Z" }
      : {}),
  };
}

async function waitForElement<T extends Element>(
  container: HTMLElement,
  selector: string,
): Promise<T | null> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const element = container.querySelector<T>(selector);
    if (element) return element;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    });
  }
  return null;
}

function setInputFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });

  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("desktop renderer artifact workflow page", () => {
  let mountedRoot: Root | undefined;
  let mountedContainer: HTMLDivElement | undefined;

  function mountApp(): { root: Root; container: HTMLDivElement } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    mountedContainer = container;
    return { root, container };
  }

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => {
        mountedRoot?.unmount();
      });
    }
    mountedContainer?.remove();
    delete window.desktopApi;
    mountedRoot = undefined;
    mountedContainer = undefined;
    window.localStorage.clear();
  });

  it("uploads and refreshes artifact listing on the dedicated Artifacts page", async () => {
    const uploadArtifact = vi.fn().mockResolvedValue({
      operation: "artifact.upload",
      channel: "ipc.artifact.upload.response",
      ok: true,
      value: {
        descriptor: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
        },
      },
    });

    const browseArtifacts = vi
      .fn()
      .mockResolvedValue({
        operation: "artifact.browse",
        channel: "ipc.artifact.browse.response",
        ok: true,
        value: {
          items: [{ storageKey: "uploads/train.csv", artifactFamily: "tabular", originalName: "train.csv" }],
        },
      });

    const workspaces: Array<{ workspaceId: string; displayName: string; status: "active"; createdAt: string; settings?: { defaultIncludeSystemFoundationAssets?: boolean } }> = [];
    let selectedWorkspaceId: string | undefined;
    const ingestionCommands: IngestionTaskTransportCommand[] = [];
    const executeIngestionTask = vi.fn(
      async ({
        command,
      }: {
        workspaceId: string;
        command: IngestionTaskTransportCommand;
      }) => {
        ingestionCommands.push(command);
        const task =
          command.action === "create-files"
            ? ingestionTask("queued", 0, "pending")
            : command.action === "append-chunk"
              ? ingestionTask("transferring", 3, "transferring")
              : ingestionTask("succeeded", 3, "finalized");
        return { ok: true, value: { kind: "task" as const, task } };
      },
    );

    window.desktopApi = {
      listWorkspaces: vi.fn(async () => ({ ok: true, value: { workspaces } })),
      readActiveWorkspaceSelection: vi.fn(async () => ({ ok: true, value: selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : {} })),
      saveActiveWorkspaceSelection: vi.fn(async (selection: { workspaceId?: string }) => { selectedWorkspaceId = selection.workspaceId; return { ok: true, value: { selection } }; }),
      clearActiveWorkspaceSelection: vi.fn(async () => { selectedWorkspaceId = undefined; return { ok: true, value: {} }; }),
      createWorkspace: vi.fn(async (input: { command: { displayName: string; includeSystemFoundationAssets?: boolean } }) => { const workspace = { workspaceId: "workspace.upload", displayName: input.command.displayName, status: "active" as const, createdAt: "2026-05-14T00:00:00.000Z", updatedAt: "2026-05-14T00:00:00.000Z", settings: { defaultIncludeSystemFoundationAssets: input.command.includeSystemFoundationAssets } }; workspaces.push(workspace); selectedWorkspaceId = workspace.workspaceId; return { ok: true, value: { workspace } }; }),
      executeIngestionTask,
      listModelDownloads: vi.fn(async () => ({
        ok: true,
        value: { activities: [] },
      })),
      uploadArtifact,
      browseArtifacts,
      readArtifactDetail: vi.fn().mockResolvedValue({
        operation: "artifact.read",
        channel: "ipc.artifact.read.response",
        ok: true,
        value: { artifact: { locator: { storageKey: "uploads/cat.png" }, artifactFamily: "image" } },
      }),
      readArtifactContentDescriptor: vi.fn().mockResolvedValue({
        operation: "artifact.content.read",
        channel: "ipc.artifact.content.read.response",
        ok: true,
        value: { content: { locator: { storageKey: "uploads/cat.png" }, availability: "available", retrieval: "deferred" } },
      }),
      readArtifactViewerMedia: vi.fn().mockResolvedValue({
        operation: "artifact.media.view",
        channel: "ipc.artifact.media.view.response",
        ok: true,
        value: { storageKey: "uploads/cat.png", mediaType: "image/png", bytes: new Uint8Array([1, 2]) },
      }),
      publishArtifactToRepo: vi.fn().mockResolvedValue({
        operation: "artifact.publish",
        channel: "ipc.artifact.publish.response",
        ok: true,
        value: {
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            locator: "openai/demo/images/cat.png",
          },
          verification: {
            exists: true,
          },
        },
      }),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        operation: "artifact.publish.verify",
        channel: "ipc.artifact.publish.verify.response",
        ok: true,
        value: {
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            locator: "openai/demo/images/cat.png",
          },
          verification: {
            exists: true,
          },
        },
      }),
      registerArtifactFromRepo: vi.fn().mockResolvedValue({
        operation: "artifact.register.from-repo",
        channel: "ipc.artifact.register.from-repo.response",
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-import001",
          backing: {
            role: "imported-source",
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/cat.png",
              revision: "main",
              locator: "openai/demo/images/cat.png",
            },
            verification: {
              exists: true,
              verifiedAt: "2026-04-18T00:00:00.000Z",
            },
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        operation: "artifact.localize.from-repo",
        channel: "ipc.artifact.localize.from-repo.response",
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: {
            key: "artifacts/20260418000000-local01",
            mediaType: "image/png",
            sizeBytes: 2,
          },
          source: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            locator: "openai/demo/images/cat.png",
          },
          localizedAt: "2026-04-18T00:00:00.000Z",
        },
      }),
    };

    const { root, container } = mountApp();

    await act(async () => {
      root.render(<App />);
    });

    const artifactsButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Data");
    await act(async () => {
      artifactsButton?.dispatchEvent(new Event("click", { bubbles: true }));
    });

    const nameInput = container.querySelector("input[placeholder=\"My Project\"]") as HTMLInputElement | null;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(nameInput, "Upload Workspace");
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      nameInput!.closest("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const input = await waitForElement<HTMLInputElement>(
      container,
      "input[type='file']",
    );
    expect(input, container.textContent ?? "No rendered content").not.toBeNull();

    const file = new File([new Uint8Array([1, 2, 3])], "train.csv", { type: "text/csv" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    Object.defineProperty(file, "slice", {
      value: () => ({
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    });

    await act(async () => {
      setInputFiles(input as HTMLInputElement, [file]);
    });

    const addDataButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add data",
    );
    expect(addDataButton).toBeDefined();
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    await act(async () => {
      addDataButton?.click();
    });
    for (
      let attempt = 0;
      attempt < 100 && ingestionCommands.length < 3;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 5));
      });
    }

    expect(uploadArtifact).not.toHaveBeenCalled();
    expect(
      ingestionCommands.map((command) => command.action),
      container.textContent ?? "No rendered content",
    ).toEqual([
      "create-files",
      "append-chunk",
      "finalize-file",
    ]);
    expect(container.textContent).toContain("All files are ready.");
    expect(container.textContent).toContain("0 files selected");
    expect(
      container.querySelector("#application-notification-panel"),
    ).not.toBeNull();
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: "auto",
    });

    const artifactBrowserButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "Artifact Browser");
    await act(async () => {
      artifactBrowserButton?.click();
    });
    for (
      let attempt = 0;
      attempt < 100 && !container.textContent?.includes("train.csv");
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 5));
      });
    }
    expect(browseArtifacts).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("train.csv");
  });
});
