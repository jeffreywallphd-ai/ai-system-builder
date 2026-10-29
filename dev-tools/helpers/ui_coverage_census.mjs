#!/usr/bin/env node
/** Bounded, read-only definition inventory. Never executes inspected source. */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import ts from "typescript";

export const CENSUS_LIMITS = Object.freeze({documentBytes: 512 * 1024, sourceBytes: 512 * 1024, files: 192, totalBytes: 32 * 1024 * 1024});
export const REQUIRED_CENSUS_INVENTORIES = Object.freeze([
  ["apps/desktop/src/renderer/routes/desktopPages.ts", "DesktopPageKey", null, "desktopRouteKeys"],
  ["apps/thin-client/src/routes/thinClientPages.ts", "ThinClientPageKey", null, "thinClientRouteKeys"],
  ["apps/desktop/src/renderer/routes/desktopPages.ts", "desktopPageDefinitions", "key", null],
  ["apps/thin-client/src/routes/thinClientPages.ts", "thinClientPageDefinitions", "key", null],
  ["apps/desktop/src/renderer/pages/ArtifactsPage.tsx", "__labels__", "label", "dataTabs"],
  ["apps/thin-client/src/pages/ArtifactsPage.tsx", "__labels__", "label", "dataTabs"],
  ["modules/ui/shared/context-management/ContextStudio.tsx", "__labels__", "label", "contextTabs"],
  ["apps/desktop/src/renderer/pages/AssetLibraryPage.tsx", "__labels__", "label", "assetTabs"],
  ["apps/thin-client/src/pages/AssetLibraryPage.tsx", "__labels__", "label", "assetTabs"],
  ["apps/desktop/src/renderer/pages/SystemBuilderPage.tsx", "__labels__", "label", "systemsTabs"],
  ["apps/thin-client/src/pages/SystemBuilderPage.tsx", "__labels__", "label", "systemsTabs"],
  ["apps/desktop/src/renderer/features/models/components/ModelsFeature.tsx", "__labels__", "label", "desktopModelTabs"],
  ["modules/contracts/runtime/dataset-preparation-capabilities.ts", "DATASET_PREPARATION_SOURCE_FORMATS", null, null],
  ["modules/contracts/runtime/dataset-preparation-capabilities.ts", "LLM_TASK_TYPES", null, null],
  ["modules/contracts/runtime/dataset-preparation-capabilities.ts", "IMAGE_TASK_TYPES", null, null],
  ["modules/contracts/runtime/dataset-preparation-capabilities.ts", "DATASET_PREPARATION_SOURCE_CAPABILITIES", "format", null],
].map(item => Object.freeze(item)));
const INVALID = "UI coverage census input is invalid or incomplete.";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = () => {throw new Error(INVALID);};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !same(Object.keys(value).sort(), [...keys].sort())) fail();
}
function strings(value, limit = 192) {
  if (!Array.isArray(value) || !value.length || value.length > limit || value.some(x => typeof x !== "string" || !x || x.length > 300) || new Set(value).size !== value.length) fail();
}
export function censusPath(name) {
  if (typeof name !== "string" || name.length > 240 || !/^(?:apps|modules|dev-tools|docs)\/[A-Za-z0-9_./-]+$/.test(name) || name.split("/").some(x => !x || x === "." || x === "..")) fail();
  return name;
}
function text(bytes, maximum) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maximum) fail();
  try {return new TextDecoder("utf-8", {fatal: true}).decode(bytes).replace(/\r\n/g, "\n");} catch {fail();}
}
function document(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > CENSUS_LIMITS.documentBytes) fail();
  try {return JSON.parse(value);} catch {fail();}
}
export function sourceFacts(name, bytes) {
  censusPath(name);
  if (!/\.(?:tsx?|m?js)$/.test(name)) fail();
  const value = text(bytes, CENSUS_LIMITS.sourceBytes), tree = ts.createSourceFile(name, value, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length) fail();
  const cases = [], functions = [], assertions = [], modifiers = [];
  let nodes = 0, dynamicCases = 0;
  const line = node => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
  function walk(node) {
    if (++nodes > 100000) fail();
    if (ts.isFunctionDeclaration(node) && node.name && node.body) functions.push({name: node.name.text, line: line(node)});
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(tree);
      const called = /^(?:test|it)(?:\.(?:skip|only|todo|fixme))?$/.test(expression)
        || ts.isCallExpression(node.expression) && /^(?:test|it)\.each$/.test(node.expression.expression.getText(tree));
      if (called) {
        const title = node.arguments[0];
        if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
          if (title.text.length > 1000) fail();
          cases.push({name: title.text, line: line(node)});
        } else dynamicCases++;
        if (/\.(?:skip|only|todo|fixme)$/.test(expression)) modifiers.push({line: line(node), kind: expression.split(".").pop()});
      }
      if (/^assert(?:\.[A-Za-z]+)?$/.test(expression) || /^expect\([\s\S]*\)(?:\.[A-Za-z]+)+$/.test(expression)) {
        assertions.push({line: line(node), kind: expression.startsWith("assert") ? "assert" : "expect", sha256: sha(node.getText(tree))});
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return {sha256: sha(value), bytes: Buffer.byteLength(value), cases, dynamicCases, functions,
    assertionCount: assertions.length, assertionDigest: sha(JSON.stringify(assertions)), assertionExamples: assertions.slice(0, 4), modifiers};
}
export function literalInventory(name, bytes, declaration, property) {
  censusPath(name); const value = text(bytes, CENSUS_LIMITS.sourceBytes), tree = ts.createSourceFile(name, value, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length || typeof declaration !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(declaration)) fail();
  let found, nodes = 0; const labels = [];
  const unwrap = node => ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  function walk(node) {
    if (++nodes > 100000) fail();
    if (declaration === "__labels__" && ts.isPropertyAssignment(node) && node.name.getText(tree).replace(/["']/g, "") === property && ts.isStringLiteral(node.initializer)) labels.push(node.initializer.text);
    if (ts.isTypeAliasDeclaration(node) && node.name.text === declaration) {
      if (found || !ts.isUnionTypeNode(node.type)) fail();
      found = node.type.types.map(member => {if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) fail(); return member.literal.text;});
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === declaration) {
      if (found || !node.initializer) fail(); const array = unwrap(node.initializer); if (!ts.isArrayLiteralExpression(array)) fail();
      found = array.elements.map(item => {
        let literal = item;
        if (property) {
          if (!ts.isObjectLiteralExpression(item)) fail();
          const values = item.properties.filter(p => ts.isPropertyAssignment(p) && p.name.getText(tree).replace(/["']/g, "") === property);
          if (values.length !== 1) fail(); literal = values[0].initializer;
        }
        if (!ts.isStringLiteral(literal)) fail(); return literal.text;
      });
    }
    ts.forEachChild(node, walk);
  }
  walk(tree); if (declaration === "__labels__") found = [...new Set(labels)]; strings(found); return found;
}
export function validateCensus({mapText, ledgerText, discoveryText, readSource, hostSpecPaths}) {
  const map = document(mapText), ledger = document(ledgerText), discovery = document(discoveryText);
  exact(map, ["schema_version", "roadmap_id", "scope", "source_baseline", "full_testing_status", "sources", "scenarios", "surfaces", "inventories", "host_spec_files"]);
  if (map.schema_version !== "current-ui-definition-census-v1" || map.roadmap_id !== "comprehensive-ui-automation"
      || map.scope !== "definitions-only-no-execution-pass" || !/^[a-f0-9]{40}$/.test(map.source_baseline)
      || map.full_testing_status !== "deferred-by-user" || ledger.full_testing_status !== map.full_testing_status
      || ledger.schema_version !== "comprehensive-ui-coverage-v1" || !Array.isArray(map.scenarios) || map.scenarios.length !== 39
      || !Array.isArray(ledger.scenarios) || ledger.scenarios.length !== 39 || !Array.isArray(discovery.scenarioMatrix) || discovery.scenarioMatrix.length !== 39) fail();
  if (!Array.isArray(map.sources) || !map.sources.length || map.sources.length > CENSUS_LIMITS.files) fail();
  strings(hostSpecPaths, 128); strings(map.host_spec_files, 128);
  if (!same(map.host_spec_files, hostSpecPaths)) fail();
  const hostSpecs = new Set(hostSpecPaths);
  const sources = new Map(), gaps = [], cache = new Map(); let totalBytes = 0;
  function loadSource(name) {
    censusPath(name);
    if (!cache.has(name)) {
      if (cache.size >= CENSUS_LIMITS.files) fail();
      const bytes = readSource(name);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > CENSUS_LIMITS.sourceBytes) fail();
      totalBytes += bytes.byteLength; if (totalBytes > CENSUS_LIMITS.totalBytes) fail();
      cache.set(name, bytes);
    }
    return cache.get(name);
  }
  for (const source of map.sources) {
    exact(source, ["path", "facts", "committed_sha256"]); censusPath(source.path);
    if (sources.has(source.path) || !/^[a-f0-9]{64}$/.test(source.committed_sha256)) fail();
    const actual = sourceFacts(source.path, loadSource(source.path));
    if (!same(actual, source.facts)) fail();
    if (actual.sha256 !== source.committed_sha256) gaps.push({kind: "unreviewed-source-drift", source: source.path});
    if (actual.modifiers.length) gaps.push({kind: "declared-test-modifier", source: source.path});
    sources.set(source.path, actual);
  }
  const ids = new Set();
  for (let index = 0; index < map.scenarios.length; index++) {
    const row = map.scenarios[index], approved = discovery.scenarioMatrix[index], legacy = ledger.scenarios[index];
    exact(row, ["id", "hosts", "behavior_links", "host_definitions", "execution_status", "pending_feature_checks"]);
    if (!/^[a-z0-9-]{1,100}$/.test(row.id) || ids.has(row.id) || row.id !== approved.id || row.id !== legacy.id
        || !same(legacy.required_behavior, approved.expectedBehavior) || !same(row.hosts, approved.hosts) || !same(row.hosts, legacy.hosts)
        || row.execution_status !== "not-asserted-by-census" || legacy.actual_host_qualification !== "pending") fail();
    ids.add(row.id); strings(row.hosts, 3);
    if (!Array.isArray(row.behavior_links) || row.behavior_links.length !== approved.expectedBehavior.length) fail();
    row.behavior_links.forEach((link, behavior) => {
      exact(link, ["behavior_index", "assertion_sources"]); strings(link.assertion_sources, 16);
      if (link.behavior_index !== behavior || !link.assertion_sources.some(p => sources.get(p)?.assertionCount > 0)) fail();
      if (link.assertion_sources.some(p => !sources.has(p))) fail();
    });
    if (!Array.isArray(row.host_definitions)) fail();
    if (row.host_definitions.length) strings(row.host_definitions, 16);
    else gaps.push({kind: "host-definition-not-mapped", scenario: row.id});
    for (const name of row.host_definitions) if (!sources.has(name) || !hostSpecs.has(name)) fail();
    if (!Array.isArray(row.pending_feature_checks) || row.pending_feature_checks.length > 16) fail();
    if (row.pending_feature_checks.length) {
      strings(row.pending_feature_checks, 16);
      gaps.push(...row.pending_feature_checks.map((_, check_index) => ({kind: "pending-feature-check", scenario: row.id, check_index})));
    }
    gaps.push({kind: "actual-host-not-run-by-census", scenario: row.id});
  }
  if (!same(map.surfaces, ledger.surface_census)) fail();
  if (!same(map.host_spec_files, hostSpecPaths) || hostSpecPaths.some(name => !sources.has(name) || !name.startsWith("dev-tools/scripts/qualification/visual-composer/e2e/") || !name.endsWith(".e2e.spec.ts"))) fail();
  if (!Array.isArray(map.inventories) || map.inventories.length !== REQUIRED_CENSUS_INVENTORIES.length) fail();
  const requiredInventories = new Set(REQUIRED_CENSUS_INVENTORIES.map(item => JSON.stringify(item))), seenInventories = new Set();
  for (const item of map.inventories) {
    exact(item, ["source", "declaration", "property", "values", "sha256", "surface_key"]); censusPath(item.source); strings(item.values);
    if (item.property !== null && (typeof item.property !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.property))) fail();
    const identity = JSON.stringify([item.source, item.declaration, item.property, item.surface_key]);
    if (!requiredInventories.has(identity) || seenInventories.has(identity)) fail(); seenInventories.add(identity);
    const bytes = loadSource(item.source);
    if (sha(text(bytes, CENSUS_LIMITS.sourceBytes)) !== item.sha256 || !same(literalInventory(item.source, bytes, item.declaration, item.property), item.values)) fail();
    if (item.surface_key !== null && (typeof item.surface_key !== "string" || !Array.isArray(map.surfaces[item.surface_key]) || !same(map.surfaces[item.surface_key], item.values))) fail();
  }
  return {schema_version: "ui-definition-census-result-v1", scenario_count: ids.size, behavior_links: map.scenarios.reduce((n, s) => n + s.behavior_links.length, 0),
    source_files: sources.size, unique_source_inputs: cache.size, source_bytes: totalBytes, inventory_groups: map.inventories.length, current_host_spec_files: hostSpecPaths.length, gaps,
    definition_map_valid: true, executed_tests: 0, actual_host_pass: false, parent_qualification_granted: false, full_testing_status: map.full_testing_status};
}
export function repositoryReader(root) {
  const base = fs.realpathSync(root), comparison = name => process.platform === "win32" ? name.toLowerCase() : name;
  return name => {
    censusPath(name); const file = path.resolve(base, name);
    if (!file.startsWith(base + path.sep) || comparison(fs.realpathSync(file)) !== comparison(file)) fail();
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > CENSUS_LIMITS.sourceBytes) fail();
    const fd = fs.openSync(file, "r");
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) fail();
      const buffer = Buffer.alloc(stat.size + 1); let length = 0, count;
      while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null)) !== 0) length += count;
      const after = fs.fstatSync(fd), named = fs.lstatSync(file);
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
          || named.dev !== opened.dev || named.ino !== opened.ino || named.isSymbolicLink()
          || comparison(fs.realpathSync(file)) !== comparison(file)) fail();
      return buffer.subarray(0, length);
    } finally {fs.closeSync(fd);}
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    if (process.argv.length !== 2) fail();
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), read = repositoryReader(root);
    const folder = "dev-tools/scripts/qualification/visual-composer/e2e/";
    const hostSpecPaths = fs.readdirSync(path.join(root, folder)).filter(n => n.endsWith(".e2e.spec.ts")).map(n => folder + n).sort();
    const result = validateCensus({mapText: text(read("docs/operations/comprehensive-ui-automation-current-census.json"), CENSUS_LIMITS.documentBytes),
      ledgerText: text(read("docs/operations/comprehensive-ui-automation-coverage.json"), CENSUS_LIMITS.documentBytes),
      discoveryText: text(read("docs/operations/comprehensive-ui-automation-discovery.json"), CENSUS_LIMITS.documentBytes), readSource: read, hostSpecPaths});
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {process.stderr.write(INVALID + "\n"); process.exitCode = 1;}
}
