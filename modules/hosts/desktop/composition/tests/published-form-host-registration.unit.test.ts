import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import type { IpcMainHandlePort } from "../../../../adapters/transport/ipc-electron/ipcMainHandlePort";
import { createDesktopPublishedFormRequest, DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS } from "../../../../contracts/ipc";
import { createOrganizationId } from "../../../../contracts/organization";
import { composeDesktopHost } from "../composeDesktopHost";

const channels = DESKTOP_SYSTEM_BUILDER_PUBLISHED_FORM_CHANNELS;
const org = createOrganizationId("org-forms");
const now = "2026-11-12T00:00:00.000Z";
const selection = { workspaceId: "workspace-missing", releaseId: "system-release:" + "a".repeat(64) };

test("the Desktop root registers form IPC only with local workspace authority", { timeout: 30_000 }, async () => {
  const parent = await realpath(tmpdir());
  const folder = await realpath(await mkdtemp(path.join(parent, "desktop-form-registration-")));
  try {
    for (const configured of [false, true]) {
      const storageRootDirectory = path.join(folder, configured ? "owned" : "unconfigured");
      const documents = createInMemoryStructuredDocumentStore();
      const host = composeDesktopHost({
        runtimeDataRootDirectory: storageRootDirectory,
        persistence: { documents, organizationDocuments: documents.forOrganization(org) },
        ...(configured ? { localIdentity: { organizationId: org, principalId: "local-form-author",
          principalDisplayName: "Form author", createdAt: now, updatedAt: now } } : {}),
        settings: { localSettingsFilePath: path.join(storageRootDirectory, "settings.json") },
        artifactRepo: { huggingFaceTokenConfigFilePath: path.join(storageRootDirectory, "no-token.json") },
        logSink() {},
        now: () => now,
      });
      try {
        const handlers = new Map<string, Parameters<IpcMainHandlePort["handle"]>[1]>();
        host.registerDesktopIpc({ ipcMain: { handle(channel, listener) { handlers.set(channel, listener); } },
          senderTrust: { isTrustedSender: () => true }, storageRootDirectory,
          runtimeRootDirectory: path.join(storageRootDirectory, "runtime") });
        assert.equal(handlers.has(channels.listPublishedForms.request.value), configured);
        assert.equal(handlers.has(channels.submitPublishedForm.request.value), configured);
        if (configured) {
          const list = handlers.get(channels.listPublishedForms.request.value)!;
          const result = await list({}, createDesktopPublishedFormRequest("listPublishedForms", selection)) as {
            ok: boolean; error?: { code: string };
          };
          assert.equal(result.ok, false);
          assert.equal(result.error?.code, "forbidden");
        }
      } finally {
        await host.shutdownBackgroundTasks();
      }
    }
  } finally {
    const target = await realpath(folder);
    assert.equal(target, folder);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith("desktop-form-registration-"));
    await rm(target, { recursive: true, force: true });
  }
});
