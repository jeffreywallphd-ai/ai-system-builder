import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAssetDefinition } from "../../asset/validate-asset-definition.service";
import { readSystemFoundationBackingResourceBundle } from "../system-foundation-backing-resource-catalog";
import {
  auditSystemFoundationPresentationDefinition,
  SYSTEM_FOUNDATION_COMMON_STYLE_OVERRIDE_FIELD_IDS,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
  SYSTEM_FOUNDATION_THEME_CHOICE_FIELD_IDS,
  SYSTEM_FOUNDATION_THEME_COLOR_FIELD_IDS,
} from "../system-packs";

describe("System Foundation v3 property-complete presentation contracts", () => {
  it("publishes an additive exact v3 release without rewriting v2", () => {
    assert.equal(SYSTEM_FOUNDATION_PACK_V2_MANIFEST.version, "2.0.0");
    assert.equal(SYSTEM_FOUNDATION_PACK_V3_MANIFEST.version, "3.0.0");
    assert.equal(
      SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.length,
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length,
    );
    assert.ok(
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.every(
        (entry) => entry.definition.version === "2.0.0",
      ),
    );
    assert.ok(
      SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.every(
        (entry) =>
          entry.definition.version === "3.0.0" &&
          entry.definitionRef.version === "3.0.0",
      ),
    );
    assert.equal(
      definition("conversation.chat-shell", "2.0.0").configurationSchema
        ?.fields.length,
      0,
    );
  });

  it("declares every renderer-owned property for all frontend-backed assets", () => {
    const audits = SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.map((entry) =>
      auditSystemFoundationPresentationDefinition(entry.definition),
    );
    const frontend = audits.filter((audit) => audit.frontendBacked);
    assert.equal(frontend.length, 77);
    for (const audit of frontend) {
      assert.ok(
        audit.configurablePropertyIds.length > 0,
        `${audit.definitionId} has no declared properties`,
      );
      for (const fieldId of audit.rendererPropertyIds) {
        assert.ok(
          audit.configurablePropertyIds.includes(fieldId),
          `${audit.definitionId} renderer property ${fieldId} is undeclared`,
        );
      }
      assert.ok(audit.fixedStructuralElements.includes("semantic-html-element"));
      assert.ok(audit.fixedStructuralElements.includes("safe-preview-fixture-data"));
    }
  });

  it("completes conversation content properties including the chat-shell title", () => {
    const shell = definition("conversation.chat-shell", "3.0.0");
    assert.deepEqual(
      shell.configurationSchema?.fields
        .filter((field) =>
          ["title", "description", "accessibilityLabel"].includes(
            field.fieldId,
          ),
        )
        .map((field) => field.fieldId),
      ["title", "description", "accessibilityLabel"],
    );
    assert.equal(shell.defaultConfiguration?.title, "Conversation");

    const history = definition(
      "conversation.message-history-display",
      "3.0.0",
    );
    for (const fieldId of [
      "title",
      "userRoleLabel",
      "assistantRoleLabel",
      "emptyMessage",
      "accessibilityLabel",
    ]) {
      assert.ok(
        history.configurationSchema?.fields.some(
          (field) => field.fieldId === fieldId,
        ),
        fieldId,
      );
    }
    assert.equal(
      history.configurationSchema?.fields.some((field) =>
        /^sample/i.test(field.fieldId),
      ),
      false,
    );
  });

  it("requires an authority-backed model binding on message composers", () => {
    const composer = definition("conversation.message-composer", "3.0.0");
    const binding = composer.configurationSchema?.fields.find(
      (field) => field.fieldId === "modelBinding",
    );

    assert.equal(binding?.valueKind, "resource-reference");
    assert.equal(binding?.required, true);
    assert.equal(binding?.uiHint?.hintKind, "resource-picker");
    assert.equal(binding?.uiHint?.metadata?.resourceKind, "model");
    assert.equal(
      binding?.metadata?.resourceScope,
      "workspace-model-registry",
    );
    assert.ok(
      composer.configurationSchema?.requiredFieldIds.includes("modelBinding"),
    );
  });

  it("uses bounded semantic theme tokens and relevant per-asset overrides", () => {
    const root = definition("builtin.system.system", "3.0.0");
    const fields = root.configurationSchema?.fields ?? [];
    for (const fieldId of SYSTEM_FOUNDATION_THEME_COLOR_FIELD_IDS) {
      const field = fields.find((candidate) => candidate.fieldId === fieldId);
      assert.equal(field?.uiHint?.hintKind, "color", fieldId);
      assert.equal(field?.uiHint?.metadata?.editorScope, "styling", fieldId);
      assert.match(String(field?.defaultValue), /^#[0-9a-f]{6}$/i);
    }
    for (const fieldId of SYSTEM_FOUNDATION_THEME_CHOICE_FIELD_IDS) {
      const field = fields.find((candidate) => candidate.fieldId === fieldId);
      assert.equal(field?.uiHint?.hintKind, "select", fieldId);
      assert.ok((field?.options?.length ?? 0) >= 3, fieldId);
    }
    for (const fieldId of SYSTEM_FOUNDATION_COMMON_STYLE_OVERRIDE_FIELD_IDS) {
      assert.ok(fields.some((field) => field.fieldId === fieldId), fieldId);
    }

    const button = definition("builtin.form.submit-action", "3.0.0");
    for (const fieldId of [
      "styleButtonRole",
      "styleButtonTreatment",
      "styleFormRole",
      "styleFormTreatment",
      "styleControlSize",
    ]) {
      assert.ok(
        button.configurationSchema?.fields.some(
          (field) => field.fieldId === fieldId,
        ),
        fieldId,
      );
    }
    assert.ok(
      fields.every(
        (field) =>
          !/(?:rawCss|cssText|selector|width|height|dimension)/i.test(
            field.fieldId,
          ),
      ),
    );
  });

  it("generates semantic CSS variables and allowlisted role selectors only for v3", () => {
    const v2 = readSystemFoundationBackingResourceBundle(
      "builtin.system.system",
      "2.0.0",
    );
    const v3 = readSystemFoundationBackingResourceBundle(
      "builtin.system.system",
      "3.0.0",
    );
    assert.ok(v2);
    assert.ok(v3);
    const v2Css = file(v2, "frontend/styles.css");
    const v3Css = file(v3, "frontend/styles.css");
    assert.doesNotMatch(v2Css, /--aisb-theme-color-primary/);
    assert.match(v3Css, /--aisb-theme-color-primary: #2563eb/);
    assert.match(v3Css, /data-style-surface-role="primary"/);
    assert.match(v3Css, /data-style-button-treatment="outline"/);
    assert.match(v3Css, /data-style-form-treatment="filled"/);
    assert.doesNotMatch(v3Css, /eval\(|javascript:|expression\(/i);
  });

  it("passes canonical definition validation for every v3 asset", () => {
    for (const entry of SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets) {
      const result = validateAssetDefinition(entry.definition);
      const errors = result.issues.filter(
        (issue) => issue.severity === "error",
      );
      assert.equal(
        errors.length,
        0,
        `${entry.definition.definitionId}: ${errors
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
  });
});

function definition(definitionId: string, version: "2.0.0" | "3.0.0") {
  const manifest =
    version === "2.0.0"
      ? SYSTEM_FOUNDATION_PACK_V2_MANIFEST
      : SYSTEM_FOUNDATION_PACK_V3_MANIFEST;
  const result = manifest.assets.find(
    (entry) => String(entry.definition.definitionId) === definitionId,
  )?.definition;
  assert.ok(result, `${definitionId}@${version}`);
  return result;
}

function file(
  bundle: NonNullable<
    ReturnType<typeof readSystemFoundationBackingResourceBundle>
  >,
  path: string,
): string {
  const result = bundle.files.find((candidate) => candidate.path === path);
  assert.ok(result, path);
  return result.content;
}
