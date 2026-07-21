import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemBuilderRepository } from "../../../../adapters/persistence/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { SystemBuilderRevision } from "../../../../contracts/system-builder";
import { SYSTEM_FOUNDATION_PACK_V3_MANIFEST } from "../../../services/asset-packs/system-packs";
import {
  SystemBuilderReferenceTemplateRegistry,
  ValidateSystemBuilderRevisionService,
} from "../../../services/system-builder";
import { CreateSystemBuilderFromTemplateUseCase } from "../system-builder-use-cases";

const workspaceId = createWorkspaceId("workspace-reference");
const definitions = SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.map(
  (entry) => entry.definition,
);
const validator = new ValidateSystemBuilderRevisionService(
  {
    async readExactDefinition(reference) {
      return definitions.find(
        (definition) =>
          String(definition.definitionId) === String(reference.id) &&
          String(definition.version) === String(reference.version),
      );
    },
  },
  () => "2026-07-17T00:00:00.000Z",
);

describe("secured data-entry system template", () => {
  it("materializes only canonical exact-version assets and passes real composition validation", async () => {
    const registry = new SystemBuilderReferenceTemplateRegistry();
    expect(registry.list().map((item) => item.templateId)).toEqual([
      "reference.secured-data-entry@1.0.0",
      "reference.controlled-chatbot@1.0.0",
      "reference.secured-data-review@1.0.0",
    ]);
    const value = registry.materialize("reference.secured-data-entry@1.0.0", {
      systemId: "secured-reference",
      name: "Secured requests",
      actorId: "person-1",
      timestamp: "2026-07-17T00:00:00.000Z",
    });
    expect(value).toBeDefined();
    if (!value) return;
    expect(value.instances.length).toBeGreaterThan(30);
    expect(
      value.instances.every(
        (item) =>
          item.definitionRef.kind === "asset-definition-version" &&
          item.definitionRef.version === "3.0.0",
      ),
    ).toBe(true);
    expect(
      value.instances.map((item) => String(item.definitionRef.id)),
    ).toContain("builtin.form.date-time-field");
    expect(
      value.instances.map((item) => String(item.definitionRef.id)),
    ).toContain("builtin.security.field-mask");
    const result = await validator.execute(value);
    expect(result.status).toBe("valid");
    expect(result.issues).toEqual([]);
  });

  it("creates the record and immutable first revision atomically from the closed template", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const registry = new SystemBuilderReferenceTemplateRegistry();
    const useCase = new CreateSystemBuilderFromTemplateUseCase(
      {
        repository,
        validator,
        generateSystemId: () => "secured-system",
        now: () => "2026-07-17T00:00:00.000Z",
      },
      registry,
    );
    const result = await useCase.execute({
      workspaceId,
      templateId: "reference.secured-data-entry@1.0.0",
      name: "Service requests",
      actorId: "person-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("validated");
    const revisions = await repository.listRevisions(
      workspaceId,
      result.value.systemId,
    );
    expect(revisions.length).toBe(1);
    expect(revisions[0].instances.length).toBeGreaterThan(30);
    expect(revisions[0].validationIssues).toEqual([]);
    expectCurrentReferenceRevision(revisions[0]);
  });
});

describe("controlled chatbot system template", () => {
  it("materializes a closed, fail-closed assistant composition that passes real validation", async () => {
    const registry = new SystemBuilderReferenceTemplateRegistry();
    const value = registry.materialize("reference.controlled-chatbot@1.0.0", {
      systemId: "controlled-chatbot",
      name: "Support assistant",
      actorId: "person-1",
      timestamp: "2026-07-17T00:00:00.000Z",
    });
    expect(value).toBeDefined();
    if (!value) return;
    const byDefinition = new Map(
      value.instances.map((item) => [String(item.definitionRef.id), item]),
    );
    expect(byDefinition.has("conversation.basic-assistant-system")).toBe(true);
    expect(byDefinition.has("builtin.ai.instruction-template")).toBe(true);
    expect(byDefinition.has("builtin.ai.generation-settings")).toBe(true);
    expect(byDefinition.has("builtin.ai.controlled-inference-action")).toBe(
      true,
    );
    expect(byDefinition.has("builtin.ai.safe-fallback")).toBe(true);
    expect(
      byDefinition.get("builtin.security.authentication-requirement")
        ?.selectedConfiguration,
    ).toEqual({ required: true });
    expect(
      byDefinition.get("builtin.security.conversation-policy")
        ?.selectedConfiguration,
    ).toEqual({
      allowedRoles: ["owner", "editor", "viewer", "developer"],
      maximumInputCharacters: 4000,
      allowContextSources: false,
      toolsMode: "disabled",
    });
    expect(
      value.instances.every(
        (item) =>
          item.definitionRef.kind === "asset-definition-version" &&
          item.definitionRef.version === "3.0.0",
      ),
    ).toBe(true);
    const validation = await validator.execute(value);
    expect(validation.issues).toEqual([]);
    expect(validation.status).toBe("valid");
    expect(JSON.stringify(validation)).not.toContain(
      "Answer clearly, use only approved context",
    );
  });

  it("creates a validated record with template-specific product copy", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const registry = new SystemBuilderReferenceTemplateRegistry();
    const useCase = new CreateSystemBuilderFromTemplateUseCase(
      {
        repository,
        validator,
        generateSystemId: () => "chatbot-system",
        now: () => "2026-07-17T00:00:00.000Z",
      },
      registry,
    );
    const result = await useCase.execute({
      workspaceId,
      templateId: "reference.controlled-chatbot@1.0.0",
      actorId: "person-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("validated");
    expect(result.value.name).toBe("Reference system");
    expect(result.value.description).toContain("release-bound text assistant");
    const revisions = await repository.listRevisions(
      workspaceId,
      result.value.systemId,
    );
    expectCurrentReferenceRevision(revisions[0]);
    const chatShell = revisions[0].instances.find(
      (instance) =>
        String(instance.definitionRef.id) === "conversation.chat-shell",
    );
    expect(chatShell?.selectedConfiguration?.title).toBe("Conversation");
  });
});

describe("secured data-review system template", () => {
  it("materializes an exact-version, fail-closed review composition that passes real validation", async () => {
    const registry = new SystemBuilderReferenceTemplateRegistry();
    const value = registry.materialize("reference.secured-data-review@1.0.0", {
      systemId: "secured-review",
      name: "Artifact review",
      actorId: "person-1",
      timestamp: "2026-07-17T00:00:00.000Z",
    });
    expect(value).toBeDefined();
    if (!value) return;
    const byDefinition = new Map(
      value.instances.map((item) => [String(item.definitionRef.id), item]),
    );
    expect(byDefinition.has("builtin.shell.resource-browser")).toBe(true);
    expect(byDefinition.has("builtin.shell.detail-page")).toBe(true);
    expect(byDefinition.has("builtin.preview.text")).toBe(true);
    expect(byDefinition.has("builtin.preview.table")).toBe(true);
    expect(byDefinition.has("builtin.preview.raster-image")).toBe(true);
    expect(byDefinition.has("builtin.preview.pdf")).toBe(true);
    expect(byDefinition.has("builtin.preview.unsupported")).toBe(true);
    expect(
      byDefinition.get("builtin.security.authentication-requirement")
        ?.selectedConfiguration,
    ).toEqual({ required: true });
    expect(
      byDefinition.get("builtin.security.artifact-read-policy")
        ?.selectedConfiguration,
    ).toEqual({
      allowedRoles: ["owner", "editor", "viewer", "developer"],
      allowedMediaTypes: [
        "text/plain",
        "text/markdown",
        "application/json",
        "text/csv",
        "application/csv",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "application/pdf",
      ],
      maximumListItems: 100,
      maximumPreviewBytes: 2_097_152,
    });
    expect(
      byDefinition.get("builtin.security.field-mask")?.selectedConfiguration,
    ).toEqual({
      protectedFields: [
        "checksum",
        "sourceLocator",
        "providerPayload",
        "storagePath",
      ],
      visibleToRoles: ["owner", "developer"],
    });
    expect(
      value.instances.every(
        (item) =>
          item.definitionRef.kind === "asset-definition-version" &&
          item.definitionRef.version === "3.0.0",
      ),
    ).toBe(true);
    const validation = await validator.execute(value);
    expect(validation.issues).toEqual([]);
    expect(validation.status).toBe("valid");
  });

  it("creates a validated review system record from the closed template", async () => {
    const repository = createStructuredSystemBuilderRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const registry = new SystemBuilderReferenceTemplateRegistry();
    const useCase = new CreateSystemBuilderFromTemplateUseCase(
      {
        repository,
        validator,
        generateSystemId: () => "review-system",
        now: () => "2026-07-17T00:00:00.000Z",
      },
      registry,
    );
    const result = await useCase.execute({
      workspaceId,
      templateId: "reference.secured-data-review@1.0.0",
      name: "Production data review",
      actorId: "person-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("validated");
    expect(result.value.name).toBe("Production data review");
    expect(result.value.description).toContain("bounded previews");
    const revisions = await repository.listRevisions(
      workspaceId,
      result.value.systemId,
    );
    expectCurrentReferenceRevision(revisions[0]);
  });
});

function expectCurrentReferenceRevision(
  revision: SystemBuilderRevision | undefined,
): void {
  expect(revision).toBeDefined();
  if (!revision) return;
  expect(
    revision.instances.every(
      (instance) => instance.definitionRef.version === "3.0.0",
    ),
  ).toBe(true);
  expect(String(revision.structure?.layoutPresetRef?.id)).toBe(
    "builtin.layout.application.minimal",
  );
  expect(revision.structure?.layoutPresetRef?.version).toBe("3.0.0");
  expect(revision.placements?.length ?? 0).toBeGreaterThan(2);
  expect(
    new Set(revision.instances.map((instance) => String(instance.instanceId)))
      .size,
  ).toBe(revision.instances.length);
  const root = revision.instances.find(
    (instance) =>
      String(instance.instanceId) ===
      String(revision.composition.rootInstanceRefs[0]?.id),
  );
  expect(root?.selectedConfiguration?.themeColorPrimary).toBe("#2563eb");
  expect(root?.selectedConfiguration?.themeButtonTreatment).toBe("solid");
}
