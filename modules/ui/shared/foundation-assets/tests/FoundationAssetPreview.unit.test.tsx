import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "../../../../testing/node-test";
import {
  FoundationAssetPreview,
  MAX_FOUNDATION_PREVIEW_COLLECTION_ITEMS,
  MAX_FOUNDATION_PREVIEW_TABLE_COLUMNS,
  MAX_FOUNDATION_PREVIEW_TABLE_ROWS,
  MAX_FOUNDATION_PREVIEW_TEXT_CHARACTERS,
} from "../FoundationAssetPreview";

describe("FoundationAssetPreview", () => {
  it("renders accessible form, table, conversation, and fail-closed policy representatives", () => {
    const form = renderToStaticMarkup(
      <FoundationAssetPreview definitionId="builtin.feature.record-form" />,
    );
    expect(form).toContain("Accessible form preview");
    expect(form).toContain("<form");
    expect(form).toContain("<label");
    expect(form).toContain('type="submit"');

    const data = renderToStaticMarkup(
      <FoundationAssetPreview definitionId="builtin.feature.data-preview" />,
    );
    expect(data).toContain("Bounded data preview");
    expect(data).toContain("<table");
    expect(data).toContain('scope="col"');

    const conversation = renderToStaticMarkup(
      <FoundationAssetPreview definitionId="conversation.basic-assistant-system" />,
    );
    expect(conversation).toContain("Conversation preview");
    expect(conversation).toContain('aria-label="Example conversation"');
    expect(conversation).toContain("Send preview");

    const policy = renderToStaticMarkup(
      <FoundationAssetPreview definitionId="builtin.security.authorization-policy" />,
    );
    expect(policy).toContain("Fail-closed policy preview");
    expect(policy).toContain("Denied by default");
    expect(policy).toContain('role="status"');
  });

  it("returns a truthful unsupported state outside the closed registry", () => {
    const html = renderToStaticMarkup(
      <FoundationAssetPreview definitionId="workspace.unknown" />,
    );
    expect(html).toContain("Preview unavailable");
    expect(html).toContain('role="status"');
  });

  it("renders current Card content and actions as real configurable regions", () => {
    const html = renderToStaticMarkup(
      <FoundationAssetPreview
        definitionId="builtin.ui.card"
        version="2.0.0"
        displayName="Fallback card"
        configuration={{
          title: "Customer summary",
          description: "Review the selected customer.",
        }}
        presentation="composed"
        regions={{
          content: <p>Customer details</p>,
          actions: <button type="button">Open customer</button>,
        }}
      />,
    );
    expect(html).toContain("<article");
    expect(html).toContain("<h2>Customer summary</h2>");
    expect(html).toContain("Review the selected customer.");
    expect(html).toContain('data-slot="content"');
    expect(html).toContain("Customer details");
    expect(html).toContain('data-slot="actions"');
    expect(html).toContain("Open customer");
    expect(html).not.toContain(">Header<");
    expect(html).not.toContain(">Content<");
    expect(html).not.toContain(">Actions<");
  });

  it("renders every current structural UI primitive as a semantic nested surface", () => {
    const cases = [
      ["builtin.ui.container", "<div", "Nested content"],
      ["builtin.ui.section", "<section", "Nested content"],
      ["builtin.ui.panel", "<section", "Nested content"],
      ["builtin.ui.card", "<article", "Nested content"],
      ["builtin.ui.stack", "<div", "Nested item"],
      ["builtin.ui.grid", "<div", "Nested item"],
      ["builtin.ui.tabs", 'role="tablist"', "Nested tab"],
      ["builtin.ui.collapsible-section", "<details", "Nested content"],
    ] as const;
    for (const [definitionId, semanticMarker, childText] of cases) {
      const itemSlot =
        definitionId === "builtin.ui.stack" ||
        definitionId === "builtin.ui.grid"
          ? "items"
          : definitionId === "builtin.ui.tabs"
            ? "tabs"
            : "content";
      const html = renderToStaticMarkup(
        <FoundationAssetPreview
          definitionId={definitionId}
          version="2.0.0"
          displayName="Configured surface"
          configuration={{ title: "Configured surface" }}
          presentation="composed"
          regions={{ [itemSlot]: <p>{childText}</p> }}
        />,
      );
      expect(html).toContain(semanticMarker);
      expect(html).toContain(childText);
      expect(html).not.toContain("Preview unavailable");
    }
  });

  it("renders declared conversation content and bounded semantic style attributes", () => {
    const shell = renderToStaticMarkup(
      <FoundationAssetPreview
        definitionId="conversation.chat-shell"
        version="3.0.0"
        displayName="Fallback conversation"
        configuration={{
          title: "Support assistant",
          description: "Ask a support question.",
          accessibilityLabel: "Support conversation",
          styleSurfaceRole: "secondary",
          styleBorder: "strong",
        }}
        presentation="composed"
      />,
    );
    expect(shell).toContain("Support assistant");
    expect(shell).toContain("Ask a support question.");
    expect(shell).toContain('aria-label="Support conversation"');
    expect(shell).toContain('data-style-surface-role="secondary"');
    expect(shell).toContain('data-style-border="strong"');

    const history = renderToStaticMarkup(
      <FoundationAssetPreview
        definitionId="conversation.message-history-display"
        version="3.0.0"
        configuration={{
          title: "Recent messages",
          userRoleLabel: "Customer",
          assistantRoleLabel: "Helper",
          emptyMessage: "No support messages yet.",
          accessibilityLabel: "Recent support messages",
        }}
        presentation="composed"
      />,
    );
    for (const value of [
      "Recent messages",
      "No support messages yet.",
      'aria-label="Recent support messages"',
    ]) {
      expect(history).toContain(value);
    }
    expect(history).not.toContain("<li>");

    const root = renderToStaticMarkup(
      <FoundationAssetPreview
        definitionId="builtin.system.system"
        version="3.0.0"
        configuration={{
          themeColorPrimary: "#123456",
          themeFontFamily: "serif",
          themeTextSize: "large",
          themeButtonTreatment: "outline",
          themeFormTreatment: "filled",
        }}
        presentation="composed"
      />,
    );
    expect(root).toContain("--foundation-color-primary:#123456");
    expect(root).toContain('data-theme-font-family="serif"');
    expect(root).toContain('data-theme-text-size="large"');
    expect(root).toContain('data-theme-button-treatment="outline"');
    expect(root).toContain('data-theme-form-treatment="filled"');
  });

  it("renders field groups, radio groups, lists, and preview placeholders with their native semantics", () => {
    const group = renderToStaticMarkup(
      <FoundationAssetPreview
        definitionId="builtin.form.field-group"
        version="2.0.0"
        displayName="Preferences"
        configuration={{ title: "Preferences", collapsible: true }}
        presentation="composed"
        regions={{ fields: <p>Notification fields</p> }}
      />,
    );
    expect(group).toContain("<details");
    expect(group).toContain("Notification fields");

    const radio = renderToStaticMarkup(
      <FoundationAssetPreview
        definitionId="builtin.form.radio-group"
        version="2.0.0"
        displayName="Frequency"
        configuration={{
          label: "Frequency",
          required: true,
          defaultValue: "daily",
          staticOptions: [
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
          ],
        }}
        presentation="composed"
      />,
    );
    expect(radio).toContain('type="radio"');
    expect(radio).toContain("Daily");
    expect(radio).toContain("Weekly");
    expect(radio).toContain("checked");

    for (const definitionId of [
      "builtin.display.list",
      "builtin.display.image-preview-placeholder",
      "builtin.display.resource-preview-placeholder",
    ]) {
      const html = renderToStaticMarkup(
        <FoundationAssetPreview
          definitionId={definitionId}
          version="2.0.0"
          displayName="Configured display"
          presentation="composed"
        />,
      );
      expect(html).not.toContain("Example preview content");
      expect(html).not.toContain("Preview unavailable");
    }
  });

  it("bounds authored preview collections, table dimensions, and text", () => {
    const oversizedText = "x".repeat(
      MAX_FOUNDATION_PREVIEW_TEXT_CHARACTERS + 50,
    );
    const form = renderToStaticMarkup(
      <FoundationAssetPreview
        definitionId="builtin.feature.record-form"
        configuration={{
          fields: Array.from(
            { length: MAX_FOUNDATION_PREVIEW_COLLECTION_ITEMS + 10 },
            (_, index) => ({ label: `Field ${index}`, value: oversizedText }),
          ),
        }}
      />,
    );
    expect((form.match(/<label/g) ?? []).length).toBe(
      MAX_FOUNDATION_PREVIEW_COLLECTION_ITEMS,
    );
    expect(form).not.toContain(oversizedText);

    const table = renderToStaticMarkup(
      <FoundationAssetPreview
        definitionId="builtin.feature.data-preview"
        configuration={{
          rows: Array.from(
            { length: MAX_FOUNDATION_PREVIEW_TABLE_ROWS + 5 },
            () =>
              Array.from(
                { length: MAX_FOUNDATION_PREVIEW_TABLE_COLUMNS + 5 },
                (_, index) => `Cell ${index}`,
              ),
          ),
        }}
      />,
    );
    expect((table.match(/<tr>/g) ?? []).length).toBe(
      MAX_FOUNDATION_PREVIEW_TABLE_ROWS + 1,
    );
    expect((table.match(/<td>/g) ?? []).length).toBe(
      MAX_FOUNDATION_PREVIEW_TABLE_ROWS * MAX_FOUNDATION_PREVIEW_TABLE_COLUMNS,
    );
  });
});
