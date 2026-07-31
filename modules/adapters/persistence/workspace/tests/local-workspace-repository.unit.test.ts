import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { createWorkspaceId } from "../../../../contracts/workspace";
import { createLocalWorkspaceRepository } from "../createLocalWorkspaceRepository";
import { LocalWorkspacePersistenceError } from "../localWorkspacePersistenceErrors";
import { resolveWorkspaceIndexFile, resolveWorkspaceRecordFile } from "../localWorkspacePersistencePaths";
import { assertSanitizedErrorText, errorText, makeTempRoot, makeWorkspaceRecord } from "./local-workspace-test-helpers";

describe("createLocalWorkspaceRepository", () => {
  it("lists no workspaces from an empty repository", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceRepository({ rootDirectory });

    assert.deepEqual(await repository.listWorkspaces(), []);
  });

  it("saves, reads, lists, updates, archives, and keeps index and record files consistent", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceRepository({ rootDirectory });
    const alpha = makeWorkspaceRecord();
    const beta = makeWorkspaceRecord({
      workspaceId: createWorkspaceId("workspace.beta"),
      displayName: "Workspace Beta",
      createdAt: "2026-05-14T01:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z",
    });

    await repository.saveWorkspace(beta);
    await repository.saveWorkspace(alpha);

    assert.deepEqual(await repository.readWorkspace(alpha.workspaceId), alpha);
    assert.deepEqual((await repository.listWorkspaces()).map((workspace) => workspace.workspaceId), [
      alpha.workspaceId,
      beta.workspaceId,
    ]);

    const updatedAlpha = { ...alpha, displayName: "Renamed Alpha", updatedAt: "2026-05-14T02:00:00.000Z" };
    await repository.updateWorkspace(updatedAlpha);
    assert.equal((await repository.readWorkspace(alpha.workspaceId))?.displayName, "Renamed Alpha");

    const archived = await repository.archiveWorkspace(beta.workspaceId, "2026-05-14T03:00:00.000Z");
    assert.equal(archived?.status, "archived");
    assert.equal(archived?.updatedAt, "2026-05-14T03:00:00.000Z");

    const index = JSON.parse(await readFile(resolveWorkspaceIndexFile(rootDirectory), "utf8"));
    const alphaFile = JSON.parse(await readFile(resolveWorkspaceRecordFile(rootDirectory, alpha.workspaceId), "utf8"));
    assert.equal(index.find((record: { workspaceId: string }) => record.workspaceId === alpha.workspaceId).displayName, "Renamed Alpha");
    assert.equal(alphaFile.displayName, "Renamed Alpha");
  });


  it("keeps save as create-or-replace and update as existing-record-only", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceRepository({ rootDirectory });
    const workspace = makeWorkspaceRecord();
    const updated = { ...workspace, displayName: "Updated Workspace", updatedAt: "2026-05-14T02:00:00.000Z" };

    await repository.saveWorkspace(workspace);
    assert.deepEqual(await repository.readWorkspace(workspace.workspaceId), workspace);

    await repository.saveWorkspace(updated);
    assert.equal((await repository.readWorkspace(workspace.workspaceId))?.displayName, "Updated Workspace");

    const updatedAgain = { ...updated, displayName: "Updated Through Update", updatedAt: "2026-05-14T03:00:00.000Z" };
    await repository.updateWorkspace(updatedAgain);
    assert.equal((await repository.readWorkspace(workspace.workspaceId))?.displayName, "Updated Through Update");
    assert.equal((await repository.listWorkspaces()).length, 1);
  });

  it("does not create missing workspaces through update and reports sanitized missing-update errors", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceRepository({ rootDirectory });
    const missing = makeWorkspaceRecord({ displayName: "Missing Workspace" });

    try {
      await repository.updateWorkspace(missing);
      assert.fail("Expected missing workspace update to fail.");
    } catch (error) {
      assert.equal((error as LocalWorkspacePersistenceError).code, "workspace-persistence-missing-record");
      assertSanitizedErrorText(errorText(error), rootDirectory);
    }

    assert.equal(await repository.readWorkspace(missing.workspaceId), undefined);
    assert.deepEqual(await repository.listWorkspaces(), []);
  });

  it("isolates workspace records and does not use display names as filesystem paths", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceRepository({ rootDirectory });
    const alpha = makeWorkspaceRecord({ displayName: "Alpha/Display Name With Spaces" });
    const beta = makeWorkspaceRecord({
      workspaceId: createWorkspaceId("workspace.beta"),
      displayName: "Beta Display",
      createdAt: "2026-05-14T01:00:00.000Z",
      updatedAt: "2026-05-14T01:00:00.000Z",
    });

    await repository.saveWorkspace(alpha);
    await repository.saveWorkspace(beta);

    assert.notEqual(resolveWorkspaceRecordFile(rootDirectory, alpha.workspaceId), resolveWorkspaceRecordFile(rootDirectory, beta.workspaceId));
    assert.equal(resolveWorkspaceRecordFile(rootDirectory, alpha.workspaceId).includes(alpha.displayName), false);
    assert.deepEqual(await repository.readWorkspace(beta.workspaceId), beta);
  });

  it("rejects unsafe workspace IDs before path construction", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceRepository({ rootDirectory });

    await assert.rejects(
      repository.readWorkspace("../../secret" as never),
      (error) => error instanceof LocalWorkspacePersistenceError && error.code === "workspace-persistence-invalid-record",
    );
  });

  it("reports corrupt JSON with sanitized errors", async () => {
    const rootDirectory = await makeTempRoot();
    const repository = createLocalWorkspaceRepository({ rootDirectory });
    const workspace = makeWorkspaceRecord();
    const recordFile = resolveWorkspaceRecordFile(rootDirectory, workspace.workspaceId);
    await mkdir(dirname(recordFile), { recursive: true });
    await writeFile(recordFile, '{"SECRET_TOKEN":"value", bad json curl http://localhost}', "utf8");

    await assert.rejects(async () => repository.readWorkspace(workspace.workspaceId));
    try {
      await repository.readWorkspace(workspace.workspaceId);
    } catch (error) {
      assertSanitizedErrorText(`${(error as { code?: string; message?: string }).code ?? ""} ${(error as Error).message}`, rootDirectory);
      assert.equal((error as LocalWorkspacePersistenceError).code, "workspace-persistence-read-failed");
    }
  });

  it("keeps public error messages sanitized when index records are invalid", async () => {
    const rootDirectory = await makeTempRoot();
    const indexFile = resolveWorkspaceIndexFile(rootDirectory);
    await mkdir(dirname(indexFile), { recursive: true });
    await writeFile(indexFile, JSON.stringify([{ workspaceId: "../unsafe", displayName: "SECRET_TOKEN", status: "active" }]), "utf8");
    const repository = createLocalWorkspaceRepository({ rootDirectory });

    try {
      await repository.listWorkspaces();
      assert.fail("Expected invalid index to fail.");
    } catch (error) {
      assert.equal((error as LocalWorkspacePersistenceError).code, "workspace-persistence-invalid-record");
      assertSanitizedErrorText(errorText(error).replace((error as Error).stack ?? "", ""), rootDirectory);
    }
  });
});
