import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { createWorkspaceId } from "../../../../contracts/workspace";
import { createLocalWorkspaceSelectionRepository } from "../createLocalWorkspaceSelectionRepository";
import { LocalWorkspacePersistenceError } from "../localWorkspacePersistenceErrors";
import { resolveActiveWorkspaceSelectionFile } from "../localWorkspacePersistencePaths";
import { assertSanitizedErrorText, makeTempRoot } from "./local-workspace-test-helpers";

describe("createLocalWorkspaceSelectionRepository", () => {
  it("returns an empty selection when no selection file exists", async () => {
    const repository = createLocalWorkspaceSelectionRepository({ rootDirectory: await makeTempRoot() });

    assert.deepEqual(await repository.readActiveWorkspaceSelection(), {});
  });

  it("saves and reads active workspace selection without verifying existence", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceSelectionRepository({ rootDirectory });
    const workspaceId = createWorkspaceId("workspace.not-created-yet");

    await repository.saveActiveWorkspaceSelection({
      workspaceId,
      selectedAt: "2026-05-14T00:00:00.000Z",
    });

    assert.deepEqual(await repository.readActiveWorkspaceSelection(), {
      workspaceId,
      selectedAt: "2026-05-14T00:00:00.000Z",
    });
    assert.deepEqual(await readdir(join(rootDirectory, "workspaces")), ["active-workspace.json"]);
  });

  it("clears selection back to empty", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceSelectionRepository({ rootDirectory });
    await repository.saveActiveWorkspaceSelection({
      workspaceId: createWorkspaceId("workspace.alpha"),
      selectedAt: "2026-05-14T00:00:00.000Z",
    });

    await repository.clearActiveWorkspaceSelection();

    assert.deepEqual(await repository.readActiveWorkspaceSelection(), {});
  });

  it("treats invalid persisted selection as empty preference", async () => {
    const rootDirectory = await makeTempRoot();
    const selectionFile = resolveActiveWorkspaceSelectionFile(rootDirectory);
    await mkdir(dirname(selectionFile), { recursive: true });
    await writeFile(selectionFile, JSON.stringify({ workspaceId: "../../secret", selectedAt: 42, secret: "SECRET_TOKEN" }), "utf8");

    assert.deepEqual(await createLocalWorkspaceSelectionRepository({ rootDirectory }).readActiveWorkspaceSelection(), {});
  });

  it("reports corrupt selection JSON with sanitized errors", async () => {
    const rootDirectory = await makeTempRoot();
    const selectionFile = resolveActiveWorkspaceSelectionFile(rootDirectory);
    await mkdir(dirname(selectionFile), { recursive: true });
    await writeFile(selectionFile, '{"SECRET_TOKEN":"value", bad json curl http://localhost}', "utf8");

    try {
      await createLocalWorkspaceSelectionRepository({ rootDirectory }).readActiveWorkspaceSelection();
      assert.fail("Expected corrupt selection to fail.");
    } catch (error) {
      assert.equal((error as LocalWorkspacePersistenceError).code, "workspace-selection-persistence-read-failed");
      assertSanitizedErrorText(`${(error as { code?: string }).code ?? ""} ${(error as Error).message}`, rootDirectory);
    }
  });
});
