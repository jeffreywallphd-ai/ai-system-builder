import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeSystemBuilder } from "../composeSystemBuilder";

describe("composeSystemBuilder", () => {
  it("composes one shared use-case family over structured persistence", async () => {
    const builder = composeSystemBuilder({
      documents: createInMemoryStructuredDocumentStore(),
      definitions: { readExactDefinition: async () => undefined },
      assetRegistryRead: {
        listDefinitionCards: async () => ({ items: [] }),
        readDefinitionDetail: async () => undefined,
      },
      generateSystemId: () => "system-composed",
      now: () => "2026-07-17T00:00:00.000Z",
    });
    const workspaceId = createWorkspaceId("workspace-a");
    const created = await builder.useCases.create.execute({ workspaceId, name: "Portal", actorId: "user-1" });
    expect(created.ok).toBe(true);
    expect((await builder.useCases.list.execute({ workspaceId })).length).toBe(1);
  });
});
