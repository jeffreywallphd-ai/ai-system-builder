import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { createWorkspaceId } from "../../../../contracts/workspace";
import { createLocalWorkspaceRepository } from "../createLocalWorkspaceRepository";
import { createLocalWorkspaceSystemPackActivationRepository } from "../createLocalWorkspaceSystemPackActivationRepository";
import { LocalWorkspacePersistenceError } from "../localWorkspacePersistenceErrors";
import {
  resolveActiveWorkspaceSelectionFile,
  resolveWorkspaceIndexFile,
  resolveWorkspaceRecordFile,
  resolveWorkspaceSystemPackActivationsFile,
} from "../localWorkspacePersistencePaths";
import { makeSystemFoundationActivation, makeTempRoot, makeWorkspaceRecord } from "./local-workspace-test-helpers";

const REPO_ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function combinedSource(relativeDirectory: string): string {
  const absoluteDirectory = join(REPO_ROOT, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return "";
  return readdirSync(absoluteDirectory, { recursive: true, withFileTypes: true })
    .filter((entry: { isFile(): boolean; name: string }) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".unit.test.ts"))
    .map((entry: { parentPath?: string; path?: string; name: string }) => {
      const parent = entry.parentPath ?? entry.path ?? absoluteDirectory;
      return readFileSync(join(parent, entry.name), "utf8");
    })
    .join("\n");
}

describe("local workspace persistence paths and boundaries", () => {
  it("builds paths under the workspace namespace using validated workspace IDs only", async () => {
    const rootDirectory = resolve(await makeTempRoot());
    const workspaceId = createWorkspaceId("workspace.alpha-01");

    assert.equal(resolveWorkspaceIndexFile(rootDirectory), join(rootDirectory, "workspaces", "index.json"));
    assert.equal(resolveActiveWorkspaceSelectionFile(rootDirectory), join(rootDirectory, "workspaces", "active-workspace.json"));
    assert.equal(resolveWorkspaceRecordFile(rootDirectory, workspaceId), join(rootDirectory, "workspaces", workspaceId, "workspace.json"));
    assert.equal(
      resolveWorkspaceSystemPackActivationsFile(rootDirectory, workspaceId),
      join(rootDirectory, "workspaces", workspaceId, "activations", "system-packs.json"),
    );
  });

  it("rejects unsafe IDs before path construction and never uses display name", async () => {
    const rootDirectory = await makeTempRoot();
    assert.throws(
      () => resolveWorkspaceRecordFile(rootDirectory, "../unsafe" as never),
      (error) => error instanceof LocalWorkspacePersistenceError && error.code === "workspace-persistence-invalid-record",
    );

    const workspace = makeWorkspaceRecord({ displayName: "Display/Name/Not/A/Path" });
    assert.equal(resolveWorkspaceRecordFile(rootDirectory, workspace.workspaceId).includes(workspace.displayName), false);
  });

  it("does not export path helpers from contract or application barrels", () => {
    const contracts = read("modules/contracts/workspace/index.ts");
    const applicationPorts = read("modules/application/ports/workspace/index.ts");

    assert.doesNotMatch(contracts, /localWorkspacePersistencePaths|resolveWorkspaceRecordFile|resolveWorkspaceIndexFile/);
    assert.doesNotMatch(applicationPorts, /localWorkspacePersistencePaths|resolveWorkspaceRecordFile|resolveWorkspaceIndexFile/);
  });

  it("keeps workspace persistence adapters free of forbidden outer-layer imports and system-pack installer calls", () => {
    const source = combinedSource("modules/adapters/persistence/workspace");

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:hosts|apps|ui|api|ipc|preload|renderer|thin-client|runtime\/.*adapter|provider-client|huggingface|openai|InstallSystemAssetPackService)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:InstallSystemAssetPackService|installSystemAssetPack|seedBuiltInAssetDefinitions|activateSystemPack|fetch\(|createRuntime|startRuntime)\b/i);
  });

  it("does not create artifact, image, model, or data directories while persisting workspace records and activations", async () => {
    const rootDirectory = await makeTempRoot();
    const workspaceId = createWorkspaceId("workspace.alpha");
    await createLocalWorkspaceRepository({ rootDirectory }).saveWorkspace(makeWorkspaceRecord({ workspaceId }));
    await createLocalWorkspaceSystemPackActivationRepository({ rootDirectory }).saveWorkspaceSystemPackActivation(
      makeSystemFoundationActivation(workspaceId),
    );

    const workspaceEntries = await readdir(join(rootDirectory, "workspaces", workspaceId));
    assert.deepEqual(workspaceEntries.sort(), ["activations", "workspace.json"]);
    for (const forbidden of ["artifacts", "artifact", "images", "image", "models", "model", "data", "datasets"]) {
      assert.equal(existsSync(join(rootDirectory, "workspaces", workspaceId, forbidden)), false);
    }
  });
});
