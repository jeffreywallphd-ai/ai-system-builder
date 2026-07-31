import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const persistenceRoot = join(process.cwd(), "modules/adapters/persistence");
const forbiddenDirectCollectionWrite =
  /\.(?:writeCollection|writePlans|writeBindings|writeInventory)\s*\(/;

function repositoryAdapterFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "tests" ? [] : repositoryAdapterFiles(path);
    }
    return entry.isFile() &&
      /^createLocal.*RepositoryAdapters?\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

test("database-backed repository adapters route collection writes through atomic mutation", () => {
  const violations = repositoryAdapterFiles(persistenceRoot)
    .filter((path) =>
      forbiddenDirectCollectionWrite.test(readFileSync(path, "utf8")),
    )
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"));

  assert.deepEqual(
    violations,
    [],
    "Repository adapters must use record-store mutation methods so database revisions can prevent lost updates.",
  );
});
