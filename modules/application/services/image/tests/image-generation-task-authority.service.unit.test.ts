import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageGenerationTaskAuthorityService } from "../image-generation-task-authority.service";
import { ImageGenerationFinalizationOrchestratorService } from "../image-generation-finalization-orchestrator.service";

test("accepted organization/workspace authority denies foreign, missing, pending and revoked access before runtime I/O", async () => {
  let organizationId: string | undefined = "org-a"; let allowed = true; let reads = 0;
  const authority = new ImageGenerationTaskAuthorityService({
    organizationContextProvider: { getCurrentOrganizationContext: () => organizationId ? { organizationId, principalId: "principal-a" } : undefined } as never,
    workspaceRepository: { readWorkspace: async (workspaceId: any) => ({ workspaceId, status: "active" }) } as never,
    workspaceAuthorization: { authorizeWorkspaceOperation: async () => { if (!allowed) throw new Error("denied"); } },
  });
  const lease = await authority.reserve("task-a", "workspace-a");
  await assert.rejects(authority.assertOwned("task-a", "workspace-a", "read"));
  lease.accept();
  const service = new ImageGenerationFinalizationOrchestratorService({ taskAuthority: authority,
    organizationContextProvider: { getCurrentOrganizationContext: () => organizationId ? { organizationId, principalId: "principal-a" } : undefined } as never,
    runtimeTaskRegistry: { getTaskStatus: async () => { reads++; return { requestId: "task-a", workspaceId: "workspace-a", taskType: "image-generation", status: "succeeded", data: { outputs: [{ artifactId: "artifact-a", storageKey: "generated/a.png" }] } }; } } as never,
    finalizeImageGenerationService: {} as never,
  });
  assert.equal((await service.finalizeIfCompleted("task-a", "workspace-a")).finalized, true);
  for (const org of ["org-b", undefined]) {
    organizationId = org;
    await assert.rejects(service.finalizeIfCompleted("task-a", "workspace-a"));
  }
  organizationId = "org-a";
  await assert.rejects(service.finalizeIfCompleted("task-a", "workspace-b"));
  allowed = false;
  await assert.rejects(service.finalizeIfCompleted("task-a", "workspace-a"));
  assert.equal(reads, 1);
});

test("missing persisted workspace authority fails closed; released reservations can retry", async () => {
  const unavailable = new ImageGenerationTaskAuthorityService({ workspaceRepository: { readWorkspace: async () => undefined } as never });
  await assert.rejects(unavailable.reserve("task-a", "workspace-a"));
  const service = new ImageGenerationTaskAuthorityService({ workspaceRepository: { readWorkspace: async (workspaceId: any) => ({ workspaceId, status: "active" }) } as never, workspaceAuthorization: { authorizeWorkspaceOperation: async () => {} } });
  (await service.reserve("task-a", "workspace-a")).release();
  const lease = await service.reserve("task-a", "workspace-a"); lease.accept(); lease.release();
  await service.assertOwned("task-a", "workspace-a", "read");
  await assert.rejects(service.reserve("task-a", "workspace-a"));
});
