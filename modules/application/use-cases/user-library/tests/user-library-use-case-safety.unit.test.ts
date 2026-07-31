import assert from "node:assert/strict";
import test from "node:test";
import { containsUnsafeUserLibraryUseCaseMetadata, sanitizeUserLibraryUseCaseMetadata } from "../user-library-use-case-safety";

test("flags unsafe metadata keys and sanitizes them", () => {
  assert.equal(containsUnsafeUserLibraryUseCaseMetadata({ prompt: "secret" }), true);
  assert.equal(sanitizeUserLibraryUseCaseMetadata({ prompt: "secret" }), undefined);
  assert.deepEqual(sanitizeUserLibraryUseCaseMetadata({ safe: true }), { safe: true });
});
