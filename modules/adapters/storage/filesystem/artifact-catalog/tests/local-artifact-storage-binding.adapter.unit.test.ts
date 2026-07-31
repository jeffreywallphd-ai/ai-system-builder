import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "../../../../../testing/node-test";
import { createLocalArtifactStorageBindingAdapter } from "../createLocalArtifactStorageBindingAdapter";

describe("createLocalArtifactStorageBindingAdapter", () => {
  it("preserves workspace ownership and filters binding reads by workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "artifact-binding-workspace-"));
    const adapter = createLocalArtifactStorageBindingAdapter({ rootDirectory: root });

    const workspaceA = await adapter.upsertArtifactStorageBinding({ binding: { workspaceId: "workspace-a" as never, artifactId: "artifact-1", role: "primary", backing: { kind: "artifact-object", provider: "filesystem", locator: "workspaces/workspace-a/generated/images/x.png" } } });
    const workspaceB = await adapter.upsertArtifactStorageBinding({ binding: { workspaceId: "workspace-b" as never, artifactId: "artifact-1", role: "primary", backing: { kind: "artifact-object", provider: "filesystem", locator: "workspaces/workspace-b/generated/images/x.png" } } });

    expect(workspaceA.ok).toBe(true);
    expect(workspaceB.ok).toBe(true);
    if (!workspaceA.ok || !workspaceB.ok) return;
    expect(workspaceA.value.binding.workspaceId).toBe("workspace-a");
    expect(workspaceB.value.binding.workspaceId).toBe("workspace-b");

    const workspaceARead = await adapter.readArtifactStorageBindings({ workspaceId: "workspace-a" as never, artifactId: "artifact-1" });
    const workspaceBRead = await adapter.readArtifactStorageBindings({ workspaceId: "workspace-b" as never, artifactId: "artifact-1" });

    expect(workspaceARead.ok).toBe(true);
    expect(workspaceBRead.ok).toBe(true);
    if (!workspaceARead.ok || !workspaceBRead.ok) return;
    expect(workspaceARead.value.bindings.map((binding) => binding.workspaceId)).toEqual(["workspace-a"]);
    expect(workspaceBRead.value.bindings.map((binding) => binding.workspaceId)).toEqual(["workspace-b"]);
    expect(JSON.stringify(workspaceARead.value.bindings)).not.toContain("workspace-b/generated");
  });

  it("reads a bounded set of artifact bindings in one workspace-scoped batch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "artifact-binding-batch-"));
    const adapter = createLocalArtifactStorageBindingAdapter({ rootDirectory: root });
    for (const artifactId of ["artifact-1", "artifact-2", "artifact-3"]) {
      await adapter.upsertArtifactStorageBinding({
        binding: {
          workspaceId: "workspace-a" as never,
          artifactId,
          role: "primary",
          backing: {
            kind: "artifact-object",
            provider: "filesystem",
            locator: `workspaces/workspace-a/${artifactId}`,
          },
        },
      });
    }

    const result = await adapter.readArtifactStorageBindingsBatch({
      workspaceId: "workspace-a" as never,
      artifactIds: ["artifact-1", "artifact-3"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected batch binding read success.");
    expect(result.value.bindings.map((binding) => binding.artifactId).sort()).toEqual([
      "artifact-1",
      "artifact-3",
    ]);

    const oversized = await adapter.readArtifactStorageBindingsBatch({
      artifactIds: Array.from({ length: 251 }, (_, index) => `artifact-${index}`),
    });
    expect(oversized.ok).toBe(false);
  });
});
