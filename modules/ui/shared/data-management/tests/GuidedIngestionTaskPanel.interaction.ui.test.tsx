// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";

import type {
  IngestionTaskRecord,
  IngestionTaskTransportCommand,
} from "../../../../contracts/ingestion";
import { NotificationViewport } from "../../notifications/NotificationCenter";
import {
  NotificationProvider,
  useNotificationCenter,
} from "../../notifications/NotificationProvider";
import { GuidedIngestionTaskPanel } from "../GuidedIngestionTaskPanel";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let scrollTo = testDouble.fn();
Object.defineProperty(dom.window, "scrollTo", {
  configurable: true,
  value: scrollTo,
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function ActiveNotificationWorkspace() {
  const notifications = useNotificationCenter();
  useEffect(
    () => notifications.setActiveWorkspaceId("workspace-a"),
    [notifications.setActiveWorkspaceId],
  );
  return null;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  scrollTo = testDouble.fn();
  Object.defineProperty(dom.window, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
});

function task(
  status: IngestionTaskRecord["status"],
  acceptedBytes: number,
  fileStatus: IngestionTaskRecord["files"][number]["status"],
): IngestionTaskRecord {
  return {
    schemaVersion: "1.0",
    taskId: "ingestion.test" as never,
    workspaceId: "workspace-a" as never,
    kind: "file-batch",
    status,
    files: [
      {
        fileId: "file.test" as never,
        checkpointId: "checkpoint.test",
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
                digest: `sha256:${"0".repeat(64)}`,
              },
            }
          : {}),
        ...(fileStatus === "finalized"
          ? {
              output: {
                key: "workspaces/workspace-a/artifacts/files/train.csv",
                mediaType: "text/csv",
                sizeBytes: 3,
                digest: `sha256:${"1".repeat(64)}`,
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
      message:
        status === "succeeded" ? "All files are ready." : "Adding files.",
    },
    revision: status === "queued" ? 1 : status === "transferring" ? 2 : 3,
    cleanupPending: status !== "succeeded",
    checkpointExpiresAt: "2026-07-31T12:00:00.000Z",
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z",
    ...(status === "succeeded"
      ? { completedAt: "2026-07-30T12:00:00.000Z" }
      : {}),
  };
}

function websiteTask(
  status: "queued" | "transferring" | "succeeded" | "failed" | "cancelled",
): IngestionTaskRecord {
  const fileStatus =
    status === "succeeded"
      ? "finalized"
      : status === "failed"
        ? "failed"
        : status === "cancelled"
          ? "cancelled"
          : "pending";
  return {
    schemaVersion: "1.0",
    taskId: "ingestion.website" as never,
    workspaceId: "workspace-a" as never,
    kind: "website",
    status,
    files: [
      {
        fileId: "file.website" as never,
        checkpointId: "checkpoint.website",
        fileName: "page.html",
        mediaType: "text/html",
        totalBytes: 0,
        status: fileStatus,
        acceptedBytes: 0,
        nextChunkIndex: 0,
        websiteSource: { requestedUrl: "https://example.com/docs" },
        ...(status === "succeeded"
          ? {
              output: {
                key: "workspaces/workspace-a/page.html",
                mediaType: "text/html",
                sizeBytes: 4,
                digest: `sha256:${"1".repeat(64)}`,
                sourceId: "source.website",
                sourceSnapshotId: "snapshot.website",
                derivedArtifactKeys: ["workspaces/workspace-a/page.txt"],
              },
            }
          : {}),
        ...(status === "failed"
          ? {
              error: {
                code: "website-unavailable",
                message: "The page is temporarily unavailable.",
                retryable: true,
              },
            }
          : {}),
      },
    ],
    progress: {
      acceptedBytes: 0,
      totalBytes: 0,
      completedItems: status === "succeeded" ? 1 : 0,
      totalItems: 1,
      percent: status === "succeeded" ? 100 : 0,
      message:
        status === "succeeded"
          ? "Website capture is ready."
          : status === "failed"
            ? "Website capture paused."
            : status === "cancelled"
              ? "The task was cancelled."
              : "Adding website data.",
    },
    revision: status === "queued" ? 1 : status === "transferring" ? 2 : 3,
    cleanupPending: false,
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z",
    ...(["succeeded", "failed", "cancelled"].includes(status)
      ? { completedAt: "2026-07-30T12:00:00.000Z" }
      : {}),
  };
}

function huggingFaceTask(status: "queued" | "succeeded"): IngestionTaskRecord {
  const revision = "a".repeat(40);
  return {
    schemaVersion: "1.0",
    taskId: "ingestion.hugging-face" as never,
    workspaceId: "workspace-a" as never,
    kind: "hugging-face",
    status,
    files: [
      {
        fileId: "file.hugging-face" as never,
        checkpointId: "checkpoint.hugging-face",
        fileName: "train.parquet",
        mediaType: "application/vnd.apache.parquet",
        totalBytes: 0,
        status: status === "succeeded" ? "finalized" : "pending",
        acceptedBytes: 0,
        nextChunkIndex: 0,
        providerSource: {
          provider: "huggingface",
          repository: "openai/example-data",
          path: "data/train.parquet",
          revision,
        },
        ...(status === "succeeded"
          ? {
              output: {
                key: "workspaces/workspace-a/artifacts/train.parquet",
                mediaType: "application/vnd.apache.parquet",
                sizeBytes: 0,
                providerRevision: revision,
              },
            }
          : {}),
      },
    ],
    progress: {
      acceptedBytes: 0,
      totalBytes: 0,
      completedItems: status === "succeeded" ? 1 : 0,
      totalItems: 1,
      percent: status === "succeeded" ? 100 : 0,
      message:
        status === "succeeded"
          ? "Provider data is ready."
          : "Ready to import selected files.",
    },
    revision: status === "succeeded" ? 2 : 1,
    cleanupPending: false,
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z",
    ...(status === "succeeded"
      ? { completedAt: "2026-07-30T12:00:00.000Z" }
      : {}),
  };
}

async function chooseWebsiteAndEnterPage(): Promise<void> {
  const website = Array.from(
    container!.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).find((input) =>
    input.parentElement?.textContent?.includes("Website pages"),
  )!;
  await act(async () => website.click());
  const input = container!.querySelector<HTMLTextAreaElement>("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, "https://example.com/docs");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("GuidedIngestionTaskPanel", () => {
  it("renders the plain-language ordered source workflow with technical limits under Advanced settings", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <GuidedIngestionTaskPanel
          workspaceId="workspace-a"
          client={{ execute: testDouble.fn() }}
        />,
      ),
    );
    expect(container.textContent).toContain("1. Choose a source");
    expect(container.textContent).toContain("2. Select the data");
    expect(container.textContent).toContain("3. Add data");
    expect(
      container
        .querySelector("fieldset")
        ?.classList.contains("ui-choice-group"),
    ).toBe(true);
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(fileInput.classList.contains("ui-file-input")).toBe(true);
    expect(fileInput.multiple).toBe(true);
    const selectedFiles = [
      new File(["first"], "first.csv", { type: "text/csv" }),
      new File(["second"], "second.jsonl", {
        type: "application/jsonl",
      }),
    ];
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: selectedFiles,
    });
    await act(async () =>
      fileInput.dispatchEvent(new Event("change", { bubbles: true })),
    );
    expect(container.textContent).toContain("2 files selected");
    expect(container.textContent).toContain("first.csv");
    expect(container.textContent).toContain("second.jsonl");
    const website = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((input) =>
      input.parentElement?.textContent?.includes("Website pages"),
    )!;
    await act(async () => website.click());
    expect(container.textContent).toContain("Specific pages");
    expect(container.textContent).toContain("Advanced settings");
    expect(container.textContent).toContain(
      "To minimize the potential for abusive scraping practices, only 25 pages can be scraped at a time.",
    );
    expect(container.textContent).toContain(
      "You are responsible for following the data use and web scraping policies of the sites you enter above.",
    );
  });

  it("streams a selected file in a bounded chunk and finalizes with server-computed integrity", async () => {
    const commands: IngestionTaskTransportCommand[] = [];
    const onComplete = testDouble.fn();
    const execute = testDouble.fn(
      async ({
        command,
      }: {
        workspaceId: string;
        command: IngestionTaskTransportCommand;
      }) => {
        commands.push(command);
        if (command.action === "create-files")
          return { kind: "task" as const, task: task("queued", 0, "pending") };
        if (command.action === "append-chunk")
          return {
            kind: "task" as const,
            task: task("transferring", 3, "transferring"),
          };
        return {
          kind: "task" as const,
          task: task("succeeded", 3, "finalized"),
        };
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <NotificationProvider>
          <ActiveNotificationWorkspace />
          <NotificationViewport />
          <GuidedIngestionTaskPanel
            workspaceId="workspace-a"
            client={{ execute }}
            onComplete={onComplete}
          />
        </NotificationProvider>,
      ),
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = {
      name: "train.csv",
      type: "text/csv",
      size: 3,
      slice: () => ({
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    } as File;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add data",
    )!;
    await act(async () => {
      add.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(commands.map((command) => command.action)).toEqual([
      "create-files",
      "append-chunk",
      "finalize-file",
    ]);
    expect((commands[1] as { bytes: Uint8Array }).bytes.byteLength).toBe(3);
    expect(commands[2]).toEqual({
      action: "finalize-file",
      taskId: "ingestion.test",
      fileId: "file.test",
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("0 files selected");
    expect(container.textContent).not.toContain("train.csv");
    expect(input.value).toBe("");
    expect(add.disabled).toBe(true);
    expect(Boolean(container.querySelector('[role="dialog"]'))).toBe(true);
    expect(container.textContent).toContain("All files are ready.");
    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  });

  it("creates and runs a bounded website task from the simple source workflow", async () => {
    const commands: IngestionTaskTransportCommand[] = [];
    const execute = testDouble.fn(
      async ({
        command,
      }: {
        workspaceId: string;
        command: IngestionTaskTransportCommand;
      }) => {
        commands.push(command);
        return {
          kind: "task" as const,
          task:
            command.action === "create-website"
              ? websiteTask("queued")
              : websiteTask("succeeded"),
        };
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <GuidedIngestionTaskPanel
          workspaceId="workspace-a"
          client={{ execute }}
        />,
      ),
    );
    await chooseWebsiteAndEnterPage();
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add data",
    )!;
    await act(async () => {
      add.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(commands).toEqual([
      {
        action: "create-website",
        scope: {
          kind: "pages",
          urls: ["https://example.com/docs"],
          maximumPages: 10,
        },
      },
      { action: "run-website", taskId: "ingestion.website" },
    ]);
    expect(container.textContent).toContain("0 files selected");
  });

  it("keeps source inputs stable while working and confirms cancellation", async () => {
    const commands: IngestionTaskTransportCommand[] = [];
    let finishRun:
      | ((value: { kind: "task"; task: IngestionTaskRecord }) => void)
      | undefined;
    const run = new Promise<{ kind: "task"; task: IngestionTaskRecord }>(
      (resolve) => {
        finishRun = resolve;
      },
    );
    const execute = testDouble.fn(
      async ({
        command,
      }: {
        workspaceId: string;
        command: IngestionTaskTransportCommand;
      }) => {
        commands.push(command);
        if (command.action === "create-website")
          return { kind: "task" as const, task: websiteTask("queued") };
        if (command.action === "run-website") return run;
        const cancelled = {
          kind: "task" as const,
          task: websiteTask("cancelled"),
        };
        finishRun?.(cancelled);
        return cancelled;
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <GuidedIngestionTaskPanel
          workspaceId="workspace-a"
          client={{ execute }}
        />,
      ),
    );
    await chooseWebsiteAndEnterPage();
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add data",
    )!;
    await act(async () => {
      add.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")?.disabled,
    ).toBe(true);
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel",
    )!;
    await act(async () => {
      cancel.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(commands.map((command) => command.action)).toEqual([
      "create-website",
      "run-website",
      "cancel",
    ]);
    expect(container.textContent).toContain("cancelled");
  });

  it("offers a plain retry action for a retryable website failure", async () => {
    const commands: IngestionTaskTransportCommand[] = [];
    let runCount = 0;
    const execute = testDouble.fn(
      async ({
        command,
      }: {
        workspaceId: string;
        command: IngestionTaskTransportCommand;
      }) => {
        commands.push(command);
        if (command.action === "create-website")
          return { kind: "task" as const, task: websiteTask("queued") };
        if (command.action === "resume")
          return { kind: "task" as const, task: websiteTask("transferring") };
        runCount += 1;
        return {
          kind: "task" as const,
          task: websiteTask(runCount === 1 ? "failed" : "succeeded"),
        };
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <GuidedIngestionTaskPanel
          workspaceId="workspace-a"
          client={{ execute }}
        />,
      ),
    );
    await chooseWebsiteAndEnterPage();
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add data",
    )!;
    await act(async () => {
      add.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(
      container.querySelector<HTMLTextAreaElement>("textarea")?.value,
    ).toBe("https://example.com/docs");
    expect(scrollTo).not.toHaveBeenCalled();
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    )!;
    await act(async () => {
      retry.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    expect(commands.map((command) => command.action)).toEqual([
      "create-website",
      "run-website",
      "resume",
      "run-website",
    ]);
    expect(container.textContent).toContain("0 files selected");
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("browses Hugging Face datasets and imports only checked files at the returned immutable revision", async () => {
    const commands: IngestionTaskTransportCommand[] = [];
    const immutableRevision = "a".repeat(40);
    const browseHuggingFaceNamespaceDatasets = testDouble
      .fn()
      .mockResolvedValue([
        { namespace: "openai", repository: "openai/example-data" },
        { namespace: "openai", repository: "openai/other-data" },
      ]);
    const browseHuggingFaceDatasetParquetFiles = testDouble
      .fn()
      .mockResolvedValue([
        {
          repository: "openai/example-data",
          path: "data/train.parquet",
          revision: immutableRevision,
          sizeBytes: 12,
        },
      ]);
    const execute = testDouble.fn(
      async ({
        command,
      }: {
        workspaceId: string;
        command: IngestionTaskTransportCommand;
      }) => {
        commands.push(command);
        return {
          kind: "task" as const,
          task: huggingFaceTask(
            command.action === "create-hugging-face" ? "queued" : "succeeded",
          ),
        };
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <GuidedIngestionTaskPanel
          workspaceId="workspace-a"
          client={{ execute }}
          sourceBrowserClient={{
            browseHuggingFaceNamespaceDatasets,
            browseHuggingFaceDatasetParquetFiles,
          }}
        />,
      ),
    );

    const providerChoice = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((input) =>
      input.parentElement?.textContent?.includes("Hugging Face dataset"),
    )!;
    await act(async () => providerChoice.click());
    const namespaceInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Hugging Face name"]',
    )!;
    const inputSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      inputSetter?.call(namespaceInput, "openai");
      namespaceInput.dispatchEvent(new Event("input", { bubbles: true }));
      namespaceInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const findDatasets = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Find datasets",
    )!;
    await act(async () => {
      findDatasets.click();
      await Promise.resolve();
    });

    const datasetCheckbox = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((input) =>
      input.parentElement?.textContent?.includes("openai/example-data"),
    )!;
    await act(async () => datasetCheckbox.click());
    const viewFiles = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "View files from selected datasets",
    )!;
    await act(async () => {
      viewFiles.click();
      await Promise.resolve();
    });

    const fileCheckbox = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((input) =>
      input.parentElement?.textContent?.includes("data/train.parquet"),
    )!;
    await act(async () => fileCheckbox.click());
    expect(container.textContent).toContain(
      "The exact version of each selected file is recorded automatically.",
    );
    const add = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add data",
    )!;
    await act(async () => {
      add.click();
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });

    expect(browseHuggingFaceNamespaceDatasets).toHaveBeenCalledWith({
      namespace: "openai",
    });
    expect(browseHuggingFaceDatasetParquetFiles).toHaveBeenCalledWith({
      repository: "openai/example-data",
    });
    expect(commands).toEqual([
      {
        action: "create-hugging-face",
        files: [
          {
            repository: "openai/example-data",
            path: "data/train.parquet",
            revision: immutableRevision,
          },
        ],
      },
      { action: "run-hugging-face", taskId: "ingestion.hugging-face" },
    ]);
    expect(container.textContent).toContain("0 files selected");
  });

  it("does not expose provider credentials or local paths when dataset browsing fails", async () => {
    const browseHuggingFaceNamespaceDatasets = testDouble
      .fn()
      .mockRejectedValue(
        new Error("token=private-value C:\\Users\\person\\provider-cache"),
      );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <GuidedIngestionTaskPanel
          workspaceId="workspace-a"
          client={{ execute: testDouble.fn() }}
          sourceBrowserClient={{
            browseHuggingFaceNamespaceDatasets,
            browseHuggingFaceDatasetParquetFiles: testDouble.fn(),
          }}
        />,
      ),
    );
    const providerChoice = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((input) =>
      input.parentElement?.textContent?.includes("Hugging Face dataset"),
    )!;
    await act(async () => providerChoice.click());
    const namespaceInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Hugging Face name"]',
    )!;
    const inputSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      inputSetter?.call(namespaceInput, "openai");
      namespaceInput.dispatchEvent(new Event("input", { bubbles: true }));
      namespaceInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const findDatasets = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Find datasets",
    )!;
    await act(async () => {
      findDatasets.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "Datasets could not be loaded. Check the Hugging Face settings and try again.",
    );
    expect(container.textContent).not.toContain("private-value");
    expect(container.textContent).not.toContain("provider-cache");
  });

  it("saves a token-only Hugging Face Step 2 card through the shared settings client", async () => {
    const getHuggingFaceTokenStatus = testDouble
      .fn()
      .mockResolvedValue({ configured: false });
    const setHuggingFaceToken = testDouble
      .fn()
      .mockResolvedValue({ configured: true, maskedToken: "********" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <GuidedIngestionTaskPanel
          workspaceId="workspace-a"
          client={{ execute: testDouble.fn() }}
          sourceBrowserClient={{
            getHuggingFaceTokenStatus,
            setHuggingFaceToken,
            clearHuggingFaceToken: testDouble.fn(),
            browseHuggingFaceNamespaceDatasets: testDouble.fn(),
            browseHuggingFaceDatasetParquetFiles: testDouble.fn(),
          }}
        />,
      ),
    );
    const providerChoice = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ).find((input) =>
      input.parentElement?.textContent?.includes("Hugging Face dataset"),
    )!;
    await act(async () => {
      providerChoice.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Hugging Face settings");
    expect(container.textContent).toContain(
      "Public datasets work without a token.",
    );
    expect(container.textContent).not.toContain("Default namespace");
    const tokenInput = container.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    const inputSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      inputSetter?.call(tokenInput, "hf_test_secret");
      tokenInput.dispatchEvent(new Event("input", { bubbles: true }));
      tokenInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const saveToken = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save token",
    )!;
    await act(async () => {
      saveToken.click();
      await Promise.resolve();
    });

    expect(setHuggingFaceToken).toHaveBeenCalledWith({
      token: "hf_test_secret",
    });
    expect(container.textContent).toContain(
      "Hugging Face access is now configured in Settings.",
    );
    expect(container.textContent).not.toContain("hf_test_secret");
  });
});
