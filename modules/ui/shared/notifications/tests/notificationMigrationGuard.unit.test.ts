import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";

import { NOTIFICATION_MESSAGE_INVENTORY } from "./notificationMigrationInventory";

const productionRoots = [
  "apps/desktop/src/renderer",
  "apps/thin-client/src",
  "modules/ui/shared",
];

const migrated = NOTIFICATION_MESSAGE_INVENTORY.filter((entry) => entry.classification.startsWith("migrated"));
const classifiedPaths = new Set(NOTIFICATION_MESSAGE_INVENTORY.map((entry) => entry.path));
const statusSitePattern = /role\s*=\s*(?:["'](?:alert|status)["']|\{[^}\n]*(?:alert|status)[^}\n]*\})|ui-(?:status|alert|feedback)/;

describe("notification message migration inventory", () => {
  it("classifies every production alert/status source and requires migrated producers to use the shared publisher", () => {
    const unclassified = productionRoots.flatMap(productionFiles).filter((path) => {
      const source = readFileSync(path, "utf8");
      return statusSitePattern.test(source) && !classifiedPaths.has(normalize(path));
    });
    expect(unclassified).toEqual([]);

    for (const entry of migrated) {
      const source = readFileSync(entry.path, "utf8");
      expect(source).toContain("TransientNotificationPublisher");
      expect(source).toContain('source="');
    }
  });

  it("prevents the removed page-level transient rendering patterns from returning", () => {
    const productionSource = productionRoots.flatMap(productionFiles)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const removedPatterns = [
      /\{notice\s*\?\s*\(\s*<p\s+className=["'][^"']*ui-status/s,
      /\{statusMessage\s*\?\s*<p/s,
      /\{mutationDisplay\s*\?\s*\(\s*<div\s+className=["']ui-status/s,
      /\{s\.(?:saveState|downloadState)\.message\s*\?\s*<p/s,
      /\{(?:sourceVerifyState|localizeState|publishState|registerState)\.message\s*\?\s*\(\s*<p/s,
    ];
    for (const pattern of removedPatterns) expect(pattern.test(productionSource)).toBe(false);
  });

  it("prevents automatic draft-change and pre-save reminders from returning", () => {
    const productionSource = productionRoots.flatMap(productionFiles)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const removedCopy = [
      "Save the revision to validate and persist it.",
      "Save the revision to persist it.",
      "updated locally.",
      "removed locally.",
      "moved to the selected canvas region locally.",
      "connection added locally.",
      "connection removed locally.",
      "The Canvas updated automatically.",
      "will be added when the customization is saved.",
      "Unsaved changes must be saved before review or publication.",
      "This preview includes unsaved composition changes.",
    ];
    for (const copy of removedCopy) expect(productionSource).not.toContain(copy);

    const requiredActionableCopy = [
      "Save or discard unsaved changes before switching systems.",
      "Add at least one backing resource before saving.",
      "Unable to verify configured asset properties before saving.",
    ];
    for (const copy of requiredActionableCopy) {
      expect(productionSource).toContain(copy);
    }
  });

  it("prevents approved routine read and duplicate queue messages from returning", () => {
    const productionSource = productionRoots.flatMap(productionSourceFiles)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const removedCopy = [
      "Loaded model inventory.",
      "Loaded artifacts.",
      "Loaded data artifacts.",
      "Loaded model results.",
      "Loaded popular models.",
      "Loaded model details.",
      "Saved draft reopened with its semantic data and backing resources.",
      "Training settings loaded.",
      "Model download queued. Track progress from Notifications.",
      ": download queued.",
      "Loaded ${storageKey}.",
      "Loaded ${files.length} file(s).",
      "Loaded files for ${loadedEntries.length} dataset(s).",
      "Found ${loadedDatasets.length} dataset(s).",
      "Loaded ${res.models.length} models.",
      "Loaded ${options.length} image generation model",
    ];
    for (const copy of removedCopy) expect(productionSource).not.toContain(copy);

    const requiredContextualCopy = [
      "No model records found.",
      "No model results found.",
      "No datasets were found for that user or organization.",
      "No files found for this dataset.",
      "found zero compatible image-generation models.",
      "No system change or runtime action has occurred.",
      "Training settings saved.",
      "Model unloaded from memory.",
    ];
    for (const copy of requiredContextualCopy) {
      expect(productionSource).toContain(copy);
    }
  });
});

function productionFiles(root: string): string[] {
  return walk(root).filter((path) => path.endsWith(".tsx") && !normalize(path).includes("/tests/"));
}

function productionSourceFiles(root: string): string[] {
  return walk(root).filter((path) => /\.tsx?$/.test(path) && !normalize(path).includes("/tests/"));
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function normalize(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}
