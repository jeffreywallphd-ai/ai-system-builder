// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import { act, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  after,
  afterEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";

import {
  normalizeIngestionTaskTransportCommand,
  type IngestionTaskRecord,
  type IngestionTaskTransportCommand,
  type IngestionTaskTransportValue,
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
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
after(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});
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
  it("coverage census: preserves all approved scenario families and matches the current literal route declarations", () => {
    const repository = path.resolve(".");
    const read = (name: string) => {
      const file = path.join(repository, name);
      expect(statSync(file).size <= 256 * 1024).toBe(true);
      return readFileSync(file, "utf8");
    };
    const ledger = JSON.parse(read("docs/operations/comprehensive-ui-automation-coverage.json"));
    const discovery = JSON.parse(read("docs/operations/comprehensive-ui-automation-discovery.json"));
    expect(ledger.schema_version).toBe("comprehensive-ui-coverage-v1");
    expect(ledger.scenarios.map((value: any) => value.id)).toEqual(discovery.scenarioMatrix.map((value: any) => value.id));
    expect(new Set(ledger.scenarios.map((value: any) => value.id)).size).toBe(39);
    expect(ledger.full_testing_status).toBe("deferred-by-user");
    for (const scenario of ledger.scenarios) {
      const original = discovery.scenarioMatrix.find((value: any) => value.id === scenario.id);
      expect(scenario.required_behavior).toEqual(original.expectedBehavior);
      expect(scenario.hosts).toEqual(original.hosts);
      expect(scenario.actual_host_qualification).toBe("pending");
      for (const name of scenario.source_refs) {
        expect((/^(apps|modules|docs|dev-tools)\//.test(name) || name === "AGENTS.md") && !name.includes("..") && !name.includes("\\") && !name.includes(":")).toBe(true);
        expect(existsSync(path.join(repository, name))).toBe(true);
      }
    }
    for (const [host, file, alias, declaration] of [
      ["desktopRouteKeys", "apps/desktop/src/renderer/routes/desktopPages.ts", "DesktopPageKey", "desktopPageDefinitions"],
      ["thinClientRouteKeys", "apps/thin-client/src/routes/thinClientPages.ts", "ThinClientPageKey", "thinClientPageDefinitions"],
    ]) {
      const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true), union: string[] = [], registered: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isTypeAliasDeclaration(node) && node.name.text === alias && ts.isUnionTypeNode(node.type)) {
          for (const member of node.type.types) {
            expect(ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)).toBe(true);
            union.push((member as ts.LiteralTypeNode).literal.getText(tree).slice(1, -1));
          }
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === declaration) {
          expect(Boolean(node.initializer && ts.isArrayLiteralExpression(node.initializer))).toBe(true);
          for (const item of (node.initializer as ts.ArrayLiteralExpression).elements) {
            expect(ts.isObjectLiteralExpression(item)).toBe(true);
            const key = (item as ts.ObjectLiteralExpression).properties.find(value => ts.isPropertyAssignment(value) && value.name.getText(tree) === "key") as ts.PropertyAssignment;
            expect(Boolean(key && ts.isStringLiteral(key.initializer))).toBe(true);
            registered.push((key.initializer as ts.StringLiteral).text);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
      expect(union).toEqual(ledger.surface_census[host]);
      expect(registered.length).toBe(host === "desktopRouteKeys" ? union.length - 1 : union.length);
      expect(registered.every(key => union.includes(key))).toBe(true);
      expect(new Set(registered).size).toBe(registered.length);
    }
  });
  function deferredResponse() {
    let resolve!: (value: IngestionTaskTransportValue) => void;
    const promise = new Promise<IngestionTaskTransportValue>(done => { resolve = done; });
    return { promise, resolve };
  }
  function button(text: string) {
    const value = Array.from(container!.querySelectorAll("button")).find(item => item.textContent === text);
    expect(Boolean(value)).toBe(true);
    return value!;
  }
  async function mountAcquisition(client: { execute: any }, onComplete = () => undefined, workspaceId = "workspace-a", withNotifications = false) {
    if (!root) {
      container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    }
    const panel = <GuidedIngestionTaskPanel workspaceId={workspaceId} client={client} onComplete={onComplete} />;
    await act(async () => root!.render(withNotifications ? <NotificationProvider><ActiveNotificationWorkspace /><NotificationViewport />{panel}</NotificationProvider> : panel));
  }

  it("acquisition race: admits only one start before React commits the busy state", async () => {
    const created = deferredResponse(), commands: string[] = [];
    const client = { execute: async ({ command }: any) => {
      commands.push(command.action);
      return command.action === "create-website" ? created.promise : { kind: "task", task: websiteTask("cancelled") };
    } };
    await mountAcquisition(client); await chooseWebsiteAndEnterPage();
    try {
      await act(async () => { const add = button("Add data"); add.click(); add.click(); });
      expect(commands).toEqual(["create-website"]);
    } finally {
      await act(async () => created.resolve({ kind: "task", task: websiteTask("cancelled") }));
    }
  });

  for (const changed of ["workspace", "client"] as const) {
    it(`acquisition race: discards delayed creation after ${changed} replacement`, async () => {
      const created = deferredResponse(), commands: string[] = [], onComplete = testDouble.fn();
      const client = { execute: async ({ command }: any) => {
        commands.push(command.action);
        return command.action === "create-website" ? created.promise : { kind: "task", task: websiteTask("succeeded") };
      } };
      await mountAcquisition(client, onComplete); await chooseWebsiteAndEnterPage();
      await act(async () => button("Add data").click());
      const replacement = { execute: testDouble.fn() };
      await mountAcquisition(changed === "client" ? replacement : client, onComplete, changed === "workspace" ? "workspace-b" : "workspace-a");
      await act(async () => created.resolve({ kind: "task", task: websiteTask("queued") }));
      expect(commands).toEqual(["create-website"]);
      expect(onComplete).toHaveBeenCalledTimes(0);
      expect(replacement.execute).toHaveBeenCalledTimes(0);
      expect(container!.textContent).toContain("0 files selected");
      expect(container!.querySelector("textarea")).toBe(null);
      expect(scrollTo).toHaveBeenCalledTimes(0);
    });
  }

  it("acquisition race: retires a removed session before deferred passive cleanup", async () => {
    const created = deferredResponse(), onComplete = testDouble.fn();
    const client = { execute: async () => created.promise };
    let passiveRetired = false, completedBeforePassive = false;
    function RetirementProbe({ replaced }: { replaced: boolean }) {
      useEffect(() => () => { passiveRetired = true; }, []);
      useLayoutEffect(() => {
        if (!replaced) return;
        created.resolve({ kind: "task", task: websiteTask("succeeded") });
        // Force the concurrent scheduler to yield before the deleted tree's
        // passive cleanup. A real slow layout has the same ordering.
        const until = performance.now() + 15;
        while (performance.now() < until) { /* bounded commit delay */ }
      }, [replaced]);
      return null;
    }
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root!.render(<><RetirementProbe key="old" replaced={false} /><GuidedIngestionTaskPanel workspaceId="workspace-a" client={client} onComplete={() => { completedBeforePassive = !passiveRetired; onComplete(); }} /></>));
    await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      root!.render(<RetirementProbe key="new" replaced />);
      const deadline = performance.now() + 2000;
      while (!passiveRetired && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    }
    expect(completedBeforePassive).toBe(false);
    expect(onComplete).toHaveBeenCalledTimes(0);
    expect(passiveRetired).toBe(true);
  });

  it("acquisition race: rejects a foreign task before progress, notification or completion", async () => {
    const onComplete = testDouble.fn(), commands: string[] = [];
    const foreign = { ...websiteTask("succeeded"), workspaceId: "workspace-other", progress: { ...websiteTask("succeeded").progress, message: "synthetic foreign private content" } };
    const client = { execute: async ({ command }: any) => { commands.push(command.action); return { kind: "task", task: foreign }; } };
    await mountAcquisition(client, onComplete, "workspace-a", true); await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    expect(commands).toEqual(["create-website"]);
    expect(onComplete).toHaveBeenCalledTimes(0);
    expect(container!.textContent).not.toContain("synthetic foreign private content");
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("response");
  });

  it("acquisition race: stops before append when unmounted during a file slice", async () => {
    let finishSlice!: (value: ArrayBuffer) => void;
    const bytes = new Promise<ArrayBuffer>(done => { finishSlice = done; }), commands: string[] = [];
    const client = { execute: async ({ command }: any) => {
      commands.push(command.action); return { kind: "task", task: task(command.action === "create-files" ? "queued" : "succeeded", 0, "pending") };
    } };
    await mountAcquisition(client);
    const input = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "train.csv", type: "text/csv", size: 3, slice: () => ({ arrayBuffer: () => bytes }) }] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => button("Add data").click());
    await act(async () => root!.unmount()); root = undefined;
    await act(async () => { finishSlice(new Uint8Array([1, 2, 3]).buffer); await new Promise(done => setTimeout(done, 10)); });
    expect(commands).toEqual(["create-files"]);
  });

  it("acquisition race: failed cancellation keeps admission closed until an explicit status check", async () => {
    const running = deferredResponse(), commands: string[] = [];
    const client = { execute: async ({ command }: any) => {
      commands.push(command.action);
      if (command.action === "create-website") return { kind: "task", task: websiteTask("queued") };
      if (command.action === "run-website") return running.promise;
      if (command.action === "cancel") throw new Error("synthetic cancellation transport failure");
      return { kind: "task", task: websiteTask("cancelled") };
    } };
    await mountAcquisition(client); await chooseWebsiteAndEnterPage();
    try {
      await act(async () => button("Add data").click());
      await act(async () => button("Cancel").click());
      expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
      await act(async () => button("Check task status").click());
      expect(commands).toEqual(["create-website", "run-website", "cancel", "read"]);
      expect(container!.textContent).toContain("cancelled");
    } finally {
      await act(async () => running.resolve({ kind: "task", task: websiteTask("cancelled") }));
    }
  });

  it("acquisition race: nonterminal cancellation is not accepted as confirmation", async () => {
    const running = deferredResponse();
    const client = { execute: async ({ command }: any) => command.action === "run-website" ? running.promise : {
      kind: "task", task: websiteTask(command.action === "read" ? "cancelled" : "queued"),
    } };
    await mountAcquisition(client); await chooseWebsiteAndEnterPage();
    try {
      await act(async () => button("Add data").click());
      await act(async () => button("Cancel").click());
      expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
      expect(container!.textContent).toContain("Check task status");
    } finally { await act(async () => running.resolve({ kind: "task", task: websiteTask("cancelled") })); }
  });

  it("acquisition race: confirmed cancellation cannot be replaced by late older progress", async () => {
    const running = deferredResponse(), onComplete = testDouble.fn();
    const client = { execute: async ({ command }: any) => command.action === "run-website" ? running.promise : {
      kind: "task", task: websiteTask(command.action === "cancel" ? "cancelled" : "queued"),
    } };
    await mountAcquisition(client, onComplete); await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    await act(async () => button("Cancel").click());
    await act(async () => running.resolve({ kind: "task", task: websiteTask("queued") }));
    expect(container!.textContent).toContain("cancelled");
    expect(onComplete).toHaveBeenCalledTimes(0);
  });

  it("acquisition race: changing the source browser also retires a pending acquisition session", async () => {
    const created = deferredResponse(), commands: string[] = [];
    const client = { execute: async ({ command }: any) => {
      commands.push(command.action); return command.action === "create-website" ? created.promise : { kind: "task", task: websiteTask("succeeded") };
    } };
    await mountAcquisition(client); await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    await act(async () => root!.render(<GuidedIngestionTaskPanel workspaceId="workspace-a" client={client as never} sourceBrowserClient={{}} />));
    await act(async () => created.resolve({ kind: "task", task: websiteTask("queued") }));
    expect(commands).toEqual(["create-website"]);
    expect(container!.textContent).toContain("0 files selected");
  });

  it("acquisition race: unmount stops polling without pretending the accepted host task was cancelled", async () => {
    const running = deferredResponse(), commands: string[] = [], onComplete = testDouble.fn();
    const client = { execute: async ({ command }: any) => {
      commands.push(command.action); return command.action === "run-website" ? running.promise : { kind: "task", task: websiteTask("queued") };
    } };
    await mountAcquisition(client, onComplete); await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    await act(async () => root!.unmount()); root = undefined;
    await new Promise(done => setTimeout(done, 550));
    await act(async () => running.resolve({ kind: "task", task: websiteTask("succeeded") }));
    expect(commands).toEqual(["create-website", "run-website"]);
    expect(onComplete).toHaveBeenCalledTimes(0);
  });

  it("acquisition race: a foreign task identity cannot finish or release the current task", async () => {
    const commands: IngestionTaskTransportCommand[] = [], onComplete = testDouble.fn();
    const client = { execute: async ({ command }: any) => {
      commands.push(command);
      return { kind: "task", task: command.action === "create-website" ? websiteTask("queued") : command.action === "read" ? websiteTask("cancelled") : { ...websiteTask("succeeded"), taskId: "ingestion.foreign" } };
    } };
    await mountAcquisition(client, onComplete); await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(0);
    await act(async () => button("Check task status").click());
    expect(commands[2]).toEqual({ action: "read", taskId: "ingestion.website" });
    expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
  });

  it("acquisition race: an old run cannot reset a newly admitted task after confirmed cancellation", async () => {
    const first = deferredResponse(), second = deferredResponse(), onComplete = testDouble.fn();
    let creates = 0;
    const client = { execute: async ({ command }: any) => {
      if (command.action === "create-website") return { kind: "task", task: { ...websiteTask("queued"), taskId: ++creates === 1 ? "ingestion.website" : "ingestion.second" } };
      if (command.action === "run-website") return command.taskId === "ingestion.website" ? first.promise : second.promise;
      return { kind: "task", task: websiteTask("cancelled") };
    } };
    await mountAcquisition(client, onComplete); await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    await act(async () => button("Cancel").click());
    await act(async () => button("Add data").click());
    await act(async () => first.resolve({ kind: "task", task: websiteTask("succeeded") }));
    expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(0);
    await act(async () => second.resolve({ kind: "task", task: { ...websiteTask("succeeded"), taskId: "ingestion.second" as never } }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(creates).toBe(2);
  });

  it("acquisition race: cancellation requested before task creation is sent once identity arrives", async () => {
    const created = deferredResponse(), commands: string[] = [];
    const client = { execute: async ({ command }: any) => {
      commands.push(command.action);
      return command.action === "create-website" ? created.promise : { kind: "task", task: websiteTask("cancelled") };
    } };
    await mountAcquisition(client); await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    await act(async () => button("Cancel").click());
    expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    await act(async () => created.resolve({ kind: "task", task: websiteTask("queued") }));
    expect(commands).toEqual(["create-website", "cancel"]);
    expect(container!.textContent).toContain("cancelled");
  });

  it("acquisition race: duplicate cancel clicks issue one request and failed status checks stay locked", async () => {
    const running = deferredResponse(), cancelled = deferredResponse(), commands: string[] = [];
    let reads = 0;
    const client = { execute: async ({ command }: any) => {
      commands.push(command.action);
      if (command.action === "create-website") return { kind: "task", task: websiteTask("queued") };
      if (command.action === "run-website") return running.promise;
      if (command.action === "cancel") return cancelled.promise;
      if (++reads === 1) throw new Error("synthetic status transport failure");
      return { kind: "task", task: websiteTask("cancelled") };
    } };
    await mountAcquisition(client); await chooseWebsiteAndEnterPage();
    try {
      await act(async () => button("Add data").click());
      await act(async () => { const cancel = button("Cancel"); cancel.click(); cancel.click(); });
      expect(commands.filter(value => value === "cancel").length).toBe(1);
      await act(async () => cancelled.resolve({ kind: "task", task: websiteTask("transferring") }));
      await act(async () => button("Check task status").click());
      expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
      await act(async () => button("Check task status").click());
      expect(container!.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
      expect(commands).toEqual(["create-website", "run-website", "cancel", "read", "read"]);
    } finally { await act(async () => running.resolve({ kind: "task", task: websiteTask("cancelled") })); }
  });

  it("acquisition race: a retry admits only one resume before the busy render", async () => {
    const resumed = deferredResponse(), commands: string[] = [], onComplete = testDouble.fn();
    let runs = 0;
    const client = { execute: async ({ command }: any) => {
      commands.push(command.action);
      if (command.action === "create-website") return { kind: "task", task: websiteTask("queued") };
      if (command.action === "resume") return resumed.promise;
      return { kind: "task", task: websiteTask(++runs === 1 ? "failed" : "succeeded") };
    } };
    await mountAcquisition(client, onComplete); await chooseWebsiteAndEnterPage();
    await act(async () => button("Add data").click());
    try {
      await act(async () => { const retry = button("Try again"); retry.click(); retry.click(); });
      expect(commands.filter(value => value === "resume").length).toBe(1);
    } finally { await act(async () => resumed.resolve({ kind: "task", task: websiteTask("queued") })); }
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("acquisition workflow: transfers two distinct files across chunk boundaries without whole-file reads", async () => {
    const size = 1024 * 1024 + 17;
    const content = [new Uint8Array(size).fill(42), new Uint8Array([7, 8, 9])];
    const names = ["train.csv", "labels.jsonl"], slices: [string, number, number][] = [], commands: string[] = [];
    const received: Uint8Array[][] = [[], []];
    const digest = (value: Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
    let record: IngestionTaskRecord = { ...task("queued", 0, "pending"), files: content.map<IngestionTaskRecord["files"][number]>((value, index) => ({
      fileId: `file.multi${index}` as never, checkpointId: `checkpoint.multi${index}`, fileName: names[index]!,
      mediaType: index ? "application/jsonl" : "text/csv", totalBytes: value.length,
      status: "pending", acceptedBytes: 0, nextChunkIndex: 0,
    })) };
    const client = { execute: async ({ command, workspaceId }: any) => {
      expect(workspaceId).toBe("workspace-a"); commands.push(command.action);
      if (command.action === "create-files") {
        expect(command.files.map((value: any) => [value.fileName, value.sizeBytes])).toEqual(names.map((name, index) => [name, content[index].length]));
      } else {
        const index = record.files.findIndex(value => value.fileId === command.fileId), previous = record.files[index];
        expect(index >= 0).toBe(true);
        if (command.action === "append-chunk") {
          expect(command.expectedOffset).toBe(previous.acceptedBytes);
          expect(command.chunkIndex).toBe(received[index].length);
          expect(command.bytes.byteLength > 0 && command.bytes.byteLength <= 1024 * 1024).toBe(true);
          expect(command.sha256).toBe(digest(command.bytes));
          received[index].push(new Uint8Array(command.bytes));
          record = { ...record, status: "transferring", files: record.files.map((file, at) => at !== index ? file : {
            ...file, status: "transferring", acceptedBytes: previous.acceptedBytes + command.bytes.length,
            nextChunkIndex: previous.nextChunkIndex + 1,
          }) };
        } else {
          expect(command.action).toBe("finalize-file");
          const bytes = Buffer.concat(received[index]);
          expect(digest(bytes)).toBe(digest(content[index]));
          expect(previous.acceptedBytes).toBe(content[index].length);
          record = { ...record, files: record.files.map((file, at) => at !== index ? file : {
            ...file, status: "finalized", output: { key: `workspaces/workspace-a/${names[index]}`, mediaType: file.mediaType, sizeBytes: bytes.length, digest: digest(bytes) as never },
          }) };
          if (record.files.every(file => file.status === "finalized")) record = { ...record, status: "succeeded" };
        }
        record = { ...record, revision: record.revision + 1 };
      }
      return { kind: "task", task: record };
    } };
    const onComplete = testDouble.fn(); await mountAcquisition(client, onComplete);
    const input = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: content.map((value, index) => ({
      name: names[index], size: value.length, type: "", arrayBuffer: () => { throw new Error("Whole-file reads are forbidden."); },
      slice: (start: number, end: number) => { slices.push([names[index], start, end]); return { arrayBuffer: async () => value.slice(start, end).buffer }; },
    })) });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => { button("Add data").click(); await new Promise(done => setTimeout(done, 30)); });
    expect(commands).toEqual(["create-files", "append-chunk", "append-chunk", "finalize-file", "append-chunk", "finalize-file"]);
    expect(slices).toEqual([[names[0], 0, 1024 * 1024], [names[0], 1024 * 1024, size], [names[1], 0, 3]]);
    expect(record.files.map(file => file.output?.digest)).toEqual(content.map(digest));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toContain("0 files selected");
  });

  it("offers PDFs and transfers a PDF with missing browser MIME through the bounded file workflow", async () => {
    const commands: IngestionTaskTransportCommand[] = [];
    const onComplete = testDouble.fn();
    const record = (status: IngestionTaskRecord["status"], accepted: number, state: IngestionTaskRecord["files"][number]["status"]) => {
      const result = task(status, accepted, state);
      return { ...result, files: result.files.map(file => ({ ...file, fileName: "scan.PDF", mediaType: "application/pdf",
        ...(file.output ? { output: { ...file.output, key: "workspaces/workspace-a/artifacts/files/scan.pdf", mediaType: "application/pdf" } } : {}),
      })) };
    };
    const execute = testDouble.fn(async ({ command }: { command: IngestionTaskTransportCommand }) => {
      commands.push(normalizeIngestionTaskTransportCommand(command));
      return { kind: "task" as const, task: command.action === "create-files" ? record("queued", 0, "pending")
        : command.action === "append-chunk" ? record("transferring", 3, "transferring") : record("succeeded", 3, "finalized") };
    });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(<GuidedIngestionTaskPanel workspaceId="workspace-a" client={{ execute }} onComplete={onComplete} />));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept.split(",")).toContain(".pdf");
    expect(input.accept.split(",")).toContain("application/pdf");
    const file = { name: "scan.PDF", type: "", size: 3,
      arrayBuffer: () => { throw new Error("Whole-file allocation is not permitted."); },
      slice: () => ({ arrayBuffer: async () => new Uint8Array([37, 80, 68]).buffer }),
    } as unknown as File;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Add data")!;
    await act(async () => { add.click(); await new Promise(resolve => window.setTimeout(resolve, 10)); });
    expect(commands[0]).toEqual({ action: "create-files", files: [{ fileName: "scan.PDF", mediaType: "application/pdf", sizeBytes: 3 }] });
    expect(commands.map(command => command.action)).toEqual(["create-files", "append-chunk", "finalize-file"]);
    expect(Array.from((commands[1] as { bytes: Uint8Array }).bytes)).toEqual([37, 80, 68]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

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

  for (const [secondName, secondModified] of [["same.csv", 1000], ["same.csv", 2000], [" same.csv", 1000], ["same.csv ", 1000]] as const) {
    it(`refuses ambiguous normalized-name and equal-size files before creating a task (${JSON.stringify(secondName)}, modified ${secondModified})`, async () => {
      const execute = testDouble.fn(async ({ command }: { command: IngestionTaskTransportCommand }) => {
        normalizeIngestionTaskTransportCommand(command);
        throw new Error("Unexpected ingestion effect.");
      });
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => root?.render(
        <GuidedIngestionTaskPanel workspaceId="workspace-a" client={{ execute }} />,
      ));
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", { configurable: true, value: [
        new File(["A,B"], "same.csv", { type: "text/csv", lastModified: 1000 }),
        new File(["C,D"], secondName, { type: "text/csv", lastModified: secondModified }),
      ] });
      const normalized = normalizeIngestionTaskTransportCommand({ action: "create-files", files: Array.from(input.files!).map(file => ({ fileName: file.name, mediaType: file.type, sizeBytes: file.size })) });
      expect(normalized.action === "create-files" && normalized.files.map(file => file.fileName)).toEqual(["same.csv", "same.csv"]);
      await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Add data")!;
      await act(async () => { add.click(); await new Promise(resolve => window.setTimeout(resolve, 10)); });
      expect(execute).toHaveBeenCalledTimes(0);
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "Two selected files have the same name and size. Rename one file and select the files again.",
      );
      expect(container.textContent).toContain("2 files selected");
      expect(input.files?.length).toBe(2);
      expect(add.disabled).toBe(false);
    });
  }

  for (const selectedNames of [["same.csv", "same.csv"], [" same.csv", "same.csv "]] as const) {
  it(`keeps normalized equal names with different sizes distinct during transfer (${JSON.stringify(selectedNames)})`, async () => {
    const onComplete = testDouble.fn();
    const appended: { fileId: string; bytes: number[] }[] = [];
    const rows = [3, 4].map((size, index) => ({ ...task("queued", 0, "pending").files[0]!,
      fileName: "same.csv", fileId: `file.${index}` as never, checkpointId: `checkpoint.${index}`, totalBytes: size,
    }));
    const execute = testDouble.fn(async ({ command }: { workspaceId: string; command: IngestionTaskTransportCommand }) => {
      if (command.action === "append-chunk") {
        const row = rows.find(file => file.fileId === command.fileId)!;
        appended.push({ fileId: command.fileId, bytes: Array.from(command.bytes) });
        row.acceptedBytes = command.bytes.byteLength;
      }
      if (command.action === "finalize-file") rows.find(file => file.fileId === command.fileId)!.status = "finalized";
      const completed = rows.filter(file => file.status === "finalized").length;
      return { kind: "task" as const, task: { ...task(completed === 2 ? "succeeded" : "transferring", 0, "pending"),
        files: rows.map(file => ({ ...file })), progress: { acceptedBytes: rows.reduce((n, file) => n + file.acceptedBytes, 0), totalBytes: 7,
          completedItems: completed, totalItems: 2, percent: completed * 50, message: completed === 2 ? "All files are ready." : "Adding files." },
      } };
    });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(<GuidedIngestionTaskPanel workspaceId="workspace-a" client={{ execute }} onComplete={onComplete} />));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [
      new File([new Uint8Array([1, 2, 3])], selectedNames[0], { type: "text/csv" }),
      new File([new Uint8Array([4, 5, 6, 7])], selectedNames[1], { type: "text/csv" }),
    ] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Add data")!;
    await act(async () => { add.click(); await new Promise(resolve => window.setTimeout(resolve, 10)); });
    expect(appended).toEqual([{ fileId: "file.0", bytes: [1, 2, 3] }, { fileId: "file.1", bytes: [4, 5, 6, 7] }]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
  }

  it("refuses a newly ambiguous normalized selection before resuming a failed file task", async () => {
    const commands: IngestionTaskTransportCommand[] = [];
    const failedSeed = task("failed", 0, "failed");
    const failed = { ...failedSeed, files: failedSeed.files.map(file => ({ ...file,
      error: { code: "temporary-storage-failure", message: "Try again.", retryable: true },
    })) };
    const execute = testDouble.fn(async ({ command }: { command: IngestionTaskTransportCommand }) => {
      commands.push(normalizeIngestionTaskTransportCommand(command));
      return { kind: "task" as const, task: command.action === "create-files" ? task("queued", 0, "pending") : failed };
    });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(<GuidedIngestionTaskPanel workspaceId="workspace-a" client={{ execute }} />));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["A,B"], "train.csv", { type: "text/csv" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Add data")!;
    await act(async () => { add.click(); await new Promise(resolve => window.setTimeout(resolve, 10)); });
    expect(commands.some(command => command.action === "append-chunk")).toBe(true);
    const beforeRetry = commands.length;
    Object.defineProperty(input, "files", { configurable: true, value: [
      new File(["A,B"], "train.csv", { type: "text/csv" }),
      new File(["C,D"], " train.csv", { type: "text/csv" }),
    ] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const retry = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Try again")!;
    expect(Boolean(retry)).toBe(true);
    await act(async () => { retry.click(); await new Promise(resolve => window.setTimeout(resolve, 10)); });
    expect(commands.length).toBe(beforeRetry);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Two selected files have the same name and size. Rename one file and select the files again.",
    );
  });

  it("refuses an ambiguous saved task before transferring any selected bytes", async () => {
    const commands: IngestionTaskTransportCommand[] = [];
    const ambiguous = task("queued", 0, "pending");
    const execute = testDouble.fn(async ({ command }: { command: IngestionTaskTransportCommand }) => {
      commands.push(command);
      return { kind: "task" as const, task: { ...ambiguous, files: [ambiguous.files[0]!, { ...ambiguous.files[0]!, fileId: "file.other" as never }] } };
    });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root?.render(<GuidedIngestionTaskPanel workspaceId="workspace-a" client={{ execute }} />));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["A,B"], "train.csv", { type: "text/csv" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Add data")!;
    await act(async () => { add.click(); await new Promise(resolve => window.setTimeout(resolve, 10)); });
    expect(commands.map(command => command.action)).toEqual(["create-files"]);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "This task contains files with the same name and size. Start a new task with renamed files.",
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
