import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";

import {
  exactSystemFoundationDefinitionReference,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
} from "../../../../application/services/asset-packs/system-packs";
import {
  remapSystemBuilderLayout,
  systemBuilderSlotAcceptsDefinition,
  SystemBuilderReferenceTemplateRegistry,
} from "../../../../application/services/system-builder";
import type { AssetReference } from "../../../../contracts/asset";
import type {
  SystemBuilderComposerAsset,
  SystemBuilderTemplateId,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { describe, expect, it } from "../../../../testing/node-test";
import {
  buildSystemCompositionPreviewModel,
  SystemCompositionPreviewSurface,
} from "../SystemCompositionPreview";

const timestamp = "2026-07-19T00:00:00.000Z";
const workspaceId = createWorkspaceId("workspace-reference-preview-html");

const referenceCases: readonly {
  readonly templateId: SystemBuilderTemplateId;
  readonly systemId: string;
  readonly name: string;
  readonly layoutId:
    | "builtin.layout.application.navigation"
    | "builtin.layout.application.standard";
  readonly fixture: string;
}[] = [
  {
    templateId: "reference.secured-data-entry@1.0.0",
    systemId: "reference-entry-preview",
    name: "Secured data entry",
    layoutId: "builtin.layout.application.navigation",
    fixture: "secured-data-entry.preview.html",
  },
  {
    templateId: "reference.controlled-chatbot@1.0.0",
    systemId: "reference-chat-preview",
    name: "Controlled chatbot",
    layoutId: "builtin.layout.application.standard",
    fixture: "controlled-chatbot.preview.html",
  },
  {
    templateId: "reference.secured-data-review@1.0.0",
    systemId: "reference-review-preview",
    name: "Secured data review",
    layoutId: "builtin.layout.application.navigation",
    fixture: "secured-data-review.preview.html",
  },
];

describe("reference-system preview HTML fidelity", () => {
  for (const referenceCase of referenceCases) {
    it(`matches the authored ${referenceCase.templateId} semantic HTML mockup`, async () => {
      const materialized =
        new SystemBuilderReferenceTemplateRegistry().materialize(
          referenceCase.templateId,
          {
            systemId: referenceCase.systemId,
            name: referenceCase.name,
            actorId: "preview-test",
            timestamp,
          },
        );
      if (!materialized) throw new Error("Reference template was not found.");

      const migrated = await remapSystemBuilderLayout(
        {
          workspaceId,
          actorId: "preview-test",
          systemId: referenceCase.systemId as never,
          expectedRecordRevision: 1,
          targetLayoutPresetRef: exactSystemFoundationDefinitionReference(
            referenceCase.layoutId,
          ),
          composition: materialized.composition,
          instances: materialized.instances,
          bindings: materialized.bindings,
        },
        definitionReader(),
        timestamp,
      );
      const model = buildSystemCompositionPreviewModel(
        migrated.instances,
        migrated.placements,
        migrated.composition.rootInstanceRefs,
        composerCatalog(),
      );
      assertCompatibleReferencePlacements(
        migrated.instances,
        migrated.placements,
      );
      const actualHtml = renderToStaticMarkup(
        <SystemCompositionPreviewSurface roots={model.roots} />,
      );
      const idealHtml = readFileSync(
        resolve(
          process.cwd(),
          "modules/ui/shared/system-builder/tests/fixtures",
          referenceCase.fixture,
        ),
        "utf8",
      );

      expect(actualHtml).not.toContain("Visual preview unavailable");
      expect(canonicalSemanticHtml(actualHtml)).toBe(
        canonicalSemanticHtml(idealHtml),
      );
    });
  }
});

function assertCompatibleReferencePlacements(
  instances: readonly import("../../../../contracts/asset").AssetInstance[],
  placements: readonly import("../../../../contracts/asset").AssetPlacement[],
): void {
  const byInstance = new Map(
    instances.map((instance) => [String(instance.instanceId), instance]),
  );
  const definitions = new Map(
    SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.map((entry) => [
      String(entry.definition.definitionId),
      entry.definition,
    ]),
  );
  for (const placement of placements) {
    const parentInstance = byInstance.get(
      String(placement.parentInstanceRef.id),
    );
    const childInstance = byInstance.get(String(placement.childInstanceRef.id));
    const parent = parentInstance
      ? definitions.get(String(parentInstance.definitionRef.id))
      : undefined;
    const child = childInstance
      ? definitions.get(String(childInstance.definitionRef.id))
      : undefined;
    const slot = parent?.slots?.find(
      (candidate) => candidate.slotId === placement.slotId,
    );
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(slot).toBeDefined();
    if (parent && child && slot) {
      expect(systemBuilderSlotAcceptsDefinition(slot, child, parent)).toBe(
        true,
      );
    }
  }
}

function definitionReader() {
  const definitions = SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.map(
    (entry) => entry.definition,
  );
  return {
    readExactDefinition: async (reference: AssetReference) =>
      definitions.find(
        (candidate) =>
          String(candidate.definitionId) === String(reference.id) &&
          candidate.version === reference.version,
      ),
  };
}

function composerCatalog(): readonly SystemBuilderComposerAsset[] {
  return SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.map(
    ({ definition, definitionRef }) =>
      ({
        definitionRef,
        definitionId: String(definition.definitionId),
        version: definition.version,
        displayName: definition.displayName,
        description: definition.description,
        assetType: definition.assetType,
        assetFamily: definition.assetFamily,
        lifecycleStatus: definition.lifecycleStatus,
        builtIn: true,
        configurationSchema: definition.configurationSchema,
        defaultConfiguration: definition.defaultConfiguration,
        ports: definition.ports ?? [],
        slots: definition.slots ?? [],
      }) as SystemBuilderComposerAsset,
  );
}

const semanticAttributes = new Set([
  "aria-current",
  "aria-label",
  "aria-selected",
  "data-slot",
  "max",
  "min",
  "open",
  "placeholder",
  "readonly",
  "required",
  "role",
  "scope",
  "selected",
  "type",
  "value",
]);

function canonicalSemanticHtml(html: string): string {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const document = dom.window.document;
  const preview = document.querySelector(
    ".system-composition-preview__surface",
  );
  const container = preview ?? document.body;
  const wrappers = Array.from(
    container.querySelectorAll("div[data-preview-instance]"),
  ) as Element[];
  for (const wrapper of wrappers) {
    if (wrapper.attributes.length === 1) {
      wrapper.replaceWith(...Array.from(wrapper.childNodes));
    }
  }
  container.normalize();
  return JSON.stringify(
    Array.from(container.childNodes as NodeListOf<ChildNode>)
      .map(canonicalNode)
      .filter((value): value is CanonicalNode => Boolean(value)),
  );
}

type CanonicalNode =
  | { readonly text: string }
  | {
      readonly tag: string;
      readonly attributes: readonly (readonly [string, string])[];
      readonly children: readonly CanonicalNode[];
    };

function canonicalNode(node: Node): CanonicalNode | undefined {
  if (node.nodeType === node.TEXT_NODE) {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    return text ? { text } : undefined;
  }
  if (!(node instanceof node.ownerDocument!.defaultView!.Element)) {
    return undefined;
  }
  const attributes = Array.from(node.attributes)
    .filter((attribute) => semanticAttributes.has(attribute.name))
    .map((attribute) => [attribute.name, attribute.value] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    tag: node.tagName.toLowerCase(),
    attributes,
    children: Array.from(node.childNodes)
      .map(canonicalNode)
      .filter((value): value is CanonicalNode => Boolean(value)),
  };
}
