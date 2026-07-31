#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const normalizeToPosixPath = (value) => value.split(path.sep).join("/");
const readmeReminder = "> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.";
const ignoredDirectories = new Set([
  ".git",
  ".local",
  ".turbo",
  ".vite",
  ".webpack",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "tmp",
]);

const bannedTimelineRules = [
  { label: "phase-number label", pattern: /\bPhase\s+\d+\b/i },
  { label: "prompt-number label", pattern: /\bPrompt\s+\d+\b/i },
  { label: "later-prompt reference", pattern: /\blater prompts?\b/i },
  { label: "implementation work-item history", pattern: /\bimplementation work items?\b/i },
  { label: "implementation sequence history", pattern: /\bimplementation sequence\b/i },
  { label: "implementation step history", pattern: /\bimplementation step\b/i },
  { label: "review cleanup history", pattern: /\breview cleanup\b/i },
  { label: "current update diary note", pattern: /\bcurrent update\b/i },
  { label: "scheduled follow-up diary note", pattern: /\bscheduled for\b/i },
];
const allowedTimelineRuleLinePatterns = [
  /\bdo not\b.*\bphase\b/i,
  /\bmust not\b.*\bphase\b/i,
  /\bnot .*phase history\b/i,
  /\bphase\/prompt\/review history\b/i,
];

const isDirectoryPath = (targetPath) => {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
};

const isFilePath = (targetPath) => {
  try {
    return statSync(targetPath).isFile();
  } catch {
    return false;
  }
};

const pathExists = (targetPath) => isFilePath(targetPath) || isDirectoryPath(targetPath);
const readTextFile = (absolutePath) => readFileSync(absolutePath, "utf8");

const walkMarkdownFiles = (repoRoot, rootRelativePath = ".") => {
  const rootPath = path.resolve(repoRoot, rootRelativePath);
  if (!isDirectoryPath(rootPath)) {
    return [];
  }

  const files = [];
  const visit = (currentPath) => {
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(absolutePath);
      }
    }
  };
  visit(rootPath);
  return files.sort((left, right) => left.localeCompare(right));
};

const reportFailure = (failures, repoRoot, absoluteOrRelativePath, message) => {
  const relativePath = path.isAbsolute(absoluteOrRelativePath)
    ? normalizeToPosixPath(path.relative(repoRoot, absoluteOrRelativePath))
    : normalizeToPosixPath(absoluteOrRelativePath);
  failures.push(`${relativePath}: ${message}`);
};

const stripFencedCodeBlocks = (text) => text.replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)\s*$/gm, "");

const markdownHeadingAnchors = (text) => {
  const anchors = new Set();
  const counts = new Map();
  const withoutCode = stripFencedCodeBlocks(text);
  for (const line of withoutCode.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const base = match[2]
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-");
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
};

const parseMarkdownDestination = (rawDestination) => {
  const trimmed = rawDestination.trim();
  if (trimmed.startsWith("<")) {
    const closeIndex = trimmed.indexOf(">");
    return closeIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, closeIndex);
  }
  return trimmed.split(/\s+(?=["'(])/)[0];
};

export const findMarkdownLinkFailures = (
  repoRoot = defaultRepoRoot,
  markdownFiles = walkMarkdownFiles(repoRoot),
) => {
  const failures = [];
  const anchorCache = new Map();

  for (const absolutePath of markdownFiles) {
    const text = stripFencedCodeBlocks(readTextFile(absolutePath));
    const linkPattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
    for (const match of text.matchAll(linkPattern)) {
      const destination = parseMarkdownDestination(match[1]);
      if (
        !destination ||
        /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(destination) ||
        destination.startsWith("/")
      ) {
        continue;
      }

      const hashIndex = destination.indexOf("#");
      const rawLinkPath = hashIndex === -1 ? destination : destination.slice(0, hashIndex);
      const rawAnchor = hashIndex === -1 ? "" : destination.slice(hashIndex + 1);
      const withoutQuery = rawLinkPath.split("?")[0];
      let decodedPath;
      let decodedAnchor;
      try {
        decodedPath = decodeURIComponent(withoutQuery);
        decodedAnchor = decodeURIComponent(rawAnchor).toLowerCase();
      } catch {
        reportFailure(failures, repoRoot, absolutePath, `contains an invalid encoded link '${destination}'.`);
        continue;
      }

      const targetPath = decodedPath
        ? path.resolve(path.dirname(absolutePath), decodedPath)
        : absolutePath;
      const relativeTarget = path.relative(repoRoot, targetPath);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget) || !pathExists(targetPath)) {
        reportFailure(failures, repoRoot, absolutePath, `links to missing repository path '${destination}'.`);
        continue;
      }

      if (decodedAnchor && isFilePath(targetPath) && targetPath.toLowerCase().endsWith(".md")) {
        if (!anchorCache.has(targetPath)) {
          anchorCache.set(targetPath, markdownHeadingAnchors(readTextFile(targetPath)));
        }
        if (!anchorCache.get(targetPath).has(decodedAnchor)) {
          reportFailure(failures, repoRoot, absolutePath, `links to missing Markdown anchor '${destination}'.`);
        }
      }
    }
  }

  return failures;
};

const metadataValue = (text, field) => {
  const match = new RegExp(`^- ${field}:\\s*(.+)$`, "mi").exec(text);
  return match?.[1].trim();
};

export const findCanonicalMetadataFailures = (repoRoot = defaultRepoRoot) => {
  const failures = [];
  const definitions = [
    {
      directory: "docs/architecture",
      allowedStatuses: new Set(["current", "proposed", "superseded", "deprecated"]),
      requiredFields: ["Status", "Related decisions", "Verification"],
    },
    {
      directory: "docs/standards",
      allowedStatuses: new Set(["accepted", "proposed", "superseded", "deprecated"]),
      requiredFields: ["Status", "Verification"],
    },
  ];

  for (const definition of definitions) {
    for (const absolutePath of walkMarkdownFiles(repoRoot, definition.directory)) {
      if (path.basename(absolutePath) === "README.md" || absolutePath.includes(".template.")) {
        continue;
      }
      const text = readTextFile(absolutePath);
      for (const field of definition.requiredFields) {
        if (!metadataValue(text, field)) {
          reportFailure(failures, repoRoot, absolutePath, `must define '- ${field}:' metadata near the title.`);
        }
      }
      const status = metadataValue(text, "Status");
      if (status && !definition.allowedStatuses.has(status)) {
        reportFailure(
          failures,
          repoRoot,
          absolutePath,
          `uses unsupported or non-lowercase status '${status}'.`,
        );
      }
    }
  }

  const adrDirectory = path.resolve(repoRoot, "docs/adr");
  if (isDirectoryPath(adrDirectory)) {
    for (const absolutePath of walkMarkdownFiles(repoRoot, "docs/adr")) {
      if (!/^ADR-\d{4}-.+\.md$/i.test(path.basename(absolutePath))) {
        continue;
      }
      const text = readTextFile(absolutePath);
      const matches = [...text.matchAll(/^- Status:\s*(\S+)\s*$/gmi)];
      if (matches.length !== 1) {
        reportFailure(failures, repoRoot, absolutePath, "must contain exactly one '- Status:' metadata field.");
        continue;
      }
      const status = matches[0][1];
      if (!["proposed", "accepted", "superseded", "deprecated"].includes(status)) {
        reportFailure(failures, repoRoot, absolutePath, `uses unsupported or non-lowercase ADR status '${status}'.`);
      }
    }
  }

  return failures;
};

const canonicalSectionText = (text) => {
  const heading = /^## .*Canonical .*(?:Docs?|Sources?|References?|Files?).*$/im.exec(text);
  if (!heading || heading.index === undefined) {
    return "";
  }
  const remainder = text.slice(heading.index + heading[0].length);
  const nextHeading = /^## /m.exec(remainder);
  return nextHeading?.index === undefined ? remainder : remainder.slice(0, nextHeading.index);
};

export const findContextRoutingFailures = (repoRoot = defaultRepoRoot) => {
  const failures = [];
  const packsDirectory = path.resolve(repoRoot, "docs/context/packs");
  const routingPath = path.resolve(repoRoot, "docs/context/prompt-routing.md");
  if (!isDirectoryPath(packsDirectory) || !isFilePath(routingPath)) {
    return failures;
  }

  const routingText = readTextFile(routingPath);
  for (const absolutePath of walkMarkdownFiles(repoRoot, "docs/context/packs")) {
    const fileName = path.basename(absolutePath);
    if (fileName === "pack.template.md") {
      continue;
    }
    const text = readTextFile(absolutePath);
    const section = canonicalSectionText(text);
    for (const match of section.matchAll(/`(docs\/[^`]+)`/g)) {
      const referencedPath = match[1].replace(/\/$/, "");
      if (!pathExists(path.resolve(repoRoot, referencedPath))) {
        reportFailure(failures, repoRoot, absolutePath, `references missing canonical source '${match[1]}'.`);
      }
    }

    if (fileName !== "index.pack.md") {
      const routingReference = `docs/context/packs/${fileName}`;
      if (!routingText.includes(routingReference)) {
        reportFailure(failures, repoRoot, absolutePath, "is not routed by docs/context/prompt-routing.md.");
      }
    }
  }
  return failures;
};

export const findDocumentationDrift = ({ rootDirectory = defaultRepoRoot } = {}) => {
  const failures = [];
  const monitoredMarkdownFiles = [
    ...walkMarkdownFiles(rootDirectory, "docs/architecture"),
    ...walkMarkdownFiles(rootDirectory, "docs/adr"),
    ...walkMarkdownFiles(rootDirectory, "docs/context/packs"),
  ];
  const contextPackFiles = walkMarkdownFiles(rootDirectory, "docs/context/packs");
  const allMarkdownFiles = walkMarkdownFiles(rootDirectory);

  for (const absolutePath of allMarkdownFiles) {
    if (readTextFile(absolutePath).trim().length === 0) {
      reportFailure(failures, rootDirectory, absolutePath, "is an empty Markdown file; remove it or add purposeful content.");
    }
  }

  for (const absolutePath of monitoredMarkdownFiles) {
    const lines = readTextFile(absolutePath).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of bannedTimelineRules) {
        const allowed = allowedTimelineRuleLinePatterns.some((pattern) => pattern.test(line));
        if (rule.pattern.test(line) && !allowed) {
          reportFailure(
            failures,
            rootDirectory,
            absolutePath,
            `line ${index + 1} uses ${rule.label}; use current domain/boundary language instead.`,
          );
        }
      }
    });
  }

  for (const absolutePath of contextPackFiles) {
    const text = readTextFile(absolutePath);
    const lineCount = text.split(/\r?\n/).length;
    if (lineCount > 200) {
      reportFailure(failures, rootDirectory, absolutePath, `has ${lineCount} lines; context packs must stay at or below 200 physical lines.`);
    }
    const hasCanonicalSourceSection =
      /^## .*Canonical .*(Docs?|Sources?|References?|Files?).*$/im.test(text) ||
      /^## Required Docs To Inspect$/im.test(text);
    if (!hasCanonicalSourceSection) {
      reportFailure(failures, rootDirectory, absolutePath, "must include a canonical source/reference section so support docs stay downstream.");
    }
  }

  for (const absolutePath of allMarkdownFiles.filter((file) => path.basename(file) === "README.md")) {
    if (!readTextFile(absolutePath).includes(readmeReminder)) {
      reportFailure(failures, rootDirectory, absolutePath, "must include the AI documentation reminder near the top.");
    }
  }

  const adrReadmePath = path.resolve(rootDirectory, "docs/adr/README.md");
  if (isFilePath(adrReadmePath) && /^## Current ADRs\b/im.test(readTextFile(adrReadmePath))) {
    reportFailure(failures, rootDirectory, adrReadmePath, "must not maintain a partial hand-written 'Current ADRs' inventory; use files or a generated index.");
  }

  const workflowPath = path.resolve(rootDirectory, ".github/workflows/ci.yml");
  if (isFilePath(workflowPath)) {
    const workflowText = readTextFile(workflowPath);
    for (const command of [
      "npm run docs:check",
      "npm run architecture:check",
      "npm run agent-support:check",
    ]) {
      if (!workflowText.includes(command)) {
        reportFailure(failures, rootDirectory, workflowPath, `must enforce '${command}'.`);
      }
    }
  }

  failures.push(...findMarkdownLinkFailures(rootDirectory, allMarkdownFiles));
  failures.push(...findCanonicalMetadataFailures(rootDirectory));
  failures.push(...findContextRoutingFailures(rootDirectory));
  return [...new Set(failures)].sort();
};

export const buildDocumentationDriftMessage = (failures) => [
  "Documentation drift guardrails failed.",
  "Fix the following issues or update the guard only when the durable repository rule changes:",
  "",
  ...failures.map((failure) => `- ${failure}`),
].join("\n");

const isDirectExecution = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const failures = findDocumentationDrift();
  if (failures.length > 0) {
    console.error(buildDocumentationDriftMessage(failures));
    process.exitCode = 1;
  }
}
