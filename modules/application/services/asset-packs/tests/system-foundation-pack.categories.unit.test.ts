import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SYSTEM_FOUNDATION_PACK_CATEGORIES } from "../system-packs";

const SAFE_CATEGORY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

describe("system foundation pack categories", () => {
  it("uses unique safe category IDs", () => {
    const ids = SYSTEM_FOUNDATION_PACK_CATEGORIES.map((category) => category.categoryId);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, SAFE_CATEGORY_ID_PATTERN);
  });

  it("has user-facing labels, descriptions, and deterministic sort order", () => {
    const sortOrders = SYSTEM_FOUNDATION_PACK_CATEGORIES.map((category) => category.sortOrder);
    assert.deepEqual([...sortOrders].sort((left, right) => left - right), sortOrders);
    for (const category of SYSTEM_FOUNDATION_PACK_CATEGORIES) {
      assert.ok(category.displayName.trim().length > 0);
      assert.ok(category.description.trim().length > 0);
    }
  });

  it("does not use renderer-specific implementation language", () => {
    const output = JSON.stringify(SYSTEM_FOUNDATION_PACK_CATEGORIES);
    assert.doesNotMatch(output, /\b(?:renderer|react|vue|svelte|tsx|jsx|dom|css module|implementation path|component file)\b/i);
  });
});
