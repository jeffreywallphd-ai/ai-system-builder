import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createOrganizationId,
  isOrganizationId,
  normalizeOrganizationRole,
} from "..";

describe("organization contracts", () => {
  it("accepts safe durable identifiers and normalizes roles", () => {
    assert.equal(createOrganizationId("org-acme_1"), "org-acme_1");
    assert.equal(normalizeOrganizationRole(" ADMIN "), "admin");
    assert.equal(normalizeOrganizationRole(" OPERATOR "), "operator");
  });

  it("rejects paths, locators, token-like values, and invalid roles", () => {
    for (const value of [
      "../org",
      "org/acme",
      "org\\acme",
      "https://example.test/org",
      "token_secret",
      " org-acme ",
      "",
    ]) {
      assert.equal(isOrganizationId(value), false, value);
    }
    assert.throws(() => normalizeOrganizationRole("superadmin"), /must be one of/);
  });
});
