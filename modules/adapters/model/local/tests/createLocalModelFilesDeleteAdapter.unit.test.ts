import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalModelLocationAuthorityAdapter } from "../createLocalModelLocationAuthorityAdapter";

test("unqualified model file actions deny before any filesystem or shell effect", async () => {
  let shells = 0;
  const adapter = createLocalModelLocationAuthorityAdapter({ rootDirectory: "unused", approvedRoots: [], revealPath: () => { shells++; } });
  for (const request of [{ workspaceId: "workspace-a", modelRecordId: "model-a" },
    { workspaceId: "workspace-a", modelRecordId: "legacy", localPath: "untrusted", relativeFilePath: "../outside" }]) {
    await assert.rejects(adapter.deleteLocalModelFiles(request), { code: "unavailable" });
    await assert.rejects(adapter.revealModelLocation(request), { code: "unavailable" });
  }
  assert.equal(shells, 0);
});

test("owned model file positive and replacement-race qualification", { skip: "Pending a qualified native file authority; portable path-based effects remain disabled." }, () => {});
