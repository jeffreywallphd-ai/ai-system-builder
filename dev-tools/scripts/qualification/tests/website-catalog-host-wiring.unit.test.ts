import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Source wiring only. The composed UI tests execute application/catalog effects;
// this check does not start a host or qualify production security/native effects.
for (const [name, file, storage, catalog] of [
  ["desktop", "modules/hosts/desktop/composition/composeDesktopIngestionFeature.ts", "options.artifacts.storage", "options.artifacts.artifactCatalog"],
  ["server", "modules/hosts/server/composition/composeServerHost.ts", "storage", "artifactCatalog"],
] as const) {
  test(`${name} wires website compensation to the existing artifact catalog`, () => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const constructions: ts.ObjectLiteralExpression[] = [];
    function inspect(node: ts.Node) {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "GovernedWebsiteIngestionUseCases") {
        assert.equal(node.arguments?.length, 1);
        assert.ok(node.arguments && ts.isObjectLiteralExpression(node.arguments[0]!));
        constructions.push(node.arguments[0] as ts.ObjectLiteralExpression);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source); assert.equal(constructions.length, 1);
    const values = new Map(constructions[0]!.properties.filter(ts.isPropertyAssignment).map(value => [value.name.getText(source), value.initializer.getText(source)]));
    assert.equal(values.get("streamStorage"), storage); assert.equal(values.get("artifactCleanup"), storage);
    assert.equal(values.get("artifactCatalogCleanup"), catalog);
  });
}
