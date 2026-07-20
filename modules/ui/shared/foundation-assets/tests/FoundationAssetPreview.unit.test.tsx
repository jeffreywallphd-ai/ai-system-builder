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
