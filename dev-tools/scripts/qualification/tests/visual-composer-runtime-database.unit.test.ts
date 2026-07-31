import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { createOrganizationId } from "../../../../modules/contracts/organization";
import {
  normalizeSystemDeploymentId,
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeInstance,
} from "../../../../modules/contracts/system-deployment";
import { normalizeSystemReleaseId } from "../../../../modules/contracts/system-build";
import { createVisualComposerQualificationRuntimeDatabase } from "../visual-composer/visual-composer-runtime-database";

const NOW = "2026-07-29T18:00:00.000Z";

describe("visual composer qualification runtime database", () => {
  it("isolates documents by exact runtime instance", async () => {
    const adapter = createVisualComposerQualificationRuntimeDatabase(() => NOW);
    const first = await provisionInstance(adapter, "runtime.first");
    const second = await provisionInstance(adapter, "runtime.second");

    const firstSession = await adapter.acquire(first);
    const secondSession = await adapter.acquire(second);
    await firstSession.documents.writeDocument("qualification", "message", {
      value: "first",
    });

    assert.deepEqual(
      (await firstSession.documents.readDocument("qualification", "message"))
        ?.value,
      { value: "first" },
    );
    assert.equal(
      await secondSession.documents.readDocument("qualification", "message"),
      undefined,
    );
  });

  it("rejects a forged runtime data binding", async () => {
    const adapter = createVisualComposerQualificationRuntimeDatabase(() => NOW);
    const instance = await provisionInstance(adapter, "runtime.bound");

    await assert.rejects(
      () =>
        adapter.acquire({
          ...instance,
          dataBindingId: normalizeSystemRuntimeDataBindingId(
            "sqlite:runtime.other",
          ),
        }),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & { code?: string }).code ===
          "qualification-runtime.binding-mismatch",
    );
  });

  it("deletes only after exact retained-data confirmation", async () => {
    const adapter = createVisualComposerQualificationRuntimeDatabase(() => NOW);
    const instance = await provisionInstance(adapter, "runtime.retained");

    await adapter.deleteRetained(instance, {
      runtimeInstanceId: instance.runtimeInstanceId,
      confirmation: "delete-retained-runtime-data",
    });
    await assert.rejects(() => adapter.acquire(instance));
  });
});

async function provisionInstance(
  adapter: ReturnType<typeof createVisualComposerQualificationRuntimeDatabase>,
  id: string,
): Promise<SystemRuntimeInstance> {
  const runtimeInstanceId = normalizeSystemRuntimeInstanceId(id);
  const organizationId = createOrganizationId("qualification.organization");
  const workspaceId = createWorkspaceId("workspace.qualification");
  const provisioned = await adapter.provision({
    runtimeInstanceId,
    organizationId,
    workspaceId,
  });
  return {
    runtimeInstanceId,
    organizationId,
    workspaceId,
    deploymentId: normalizeSystemDeploymentId(`deployment.${id}`),
    releaseId: normalizeSystemReleaseId(`release.${id}`),
    dataBindingId: provisioned.dataBindingId,
    databaseEngine: provisioned.databaseEngine,
    status: "allocated",
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
