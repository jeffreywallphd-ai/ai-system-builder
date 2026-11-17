#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFunctionalityQualification } from "./functionality-qualification-core.mjs";

try {
  if (
    process.argv.slice(2).some((arg) => arg !== "--write") ||
    process.argv.length > 3
  )
    throw new Error("Unsupported argument.");
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const result = readFunctionalityQualification(root);
  if (process.argv[2] === "--write") {
    const directory = path.join(root, "docs/tmp");
    mkdirSync(directory, { recursive: true });
    const relative = path.relative(realpathSync(root), realpathSync(directory));
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unsafe report directory.");
    const temporary = path.join(
      directory,
      `.functionality-qualification.${randomUUID()}.tmp`,
    );
    let descriptor;
    let owned = false;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      owned = true;
      writeFileSync(descriptor, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(
        temporary,
        path.join(directory, "functionality-qualification-assessment.json"),
      );
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (owned) {
        try {
          unlinkSync(temporary);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  }
  process.stdout.write(
    `${JSON.stringify({ operation: "functionality-qualification-assessment", status: "pending", release_readiness: result.release_readiness, source_identity: result.source_identity, controlled_criteria: result.controlled_criteria, pending_criteria: result.pending_criteria, failed_criteria: result.failed_criteria })}\n`,
  );
} catch {
  process.stderr.write(
    "Functionality qualification assessment failed; inputs were preserved and no qualification was granted.\n",
  );
  process.exitCode = 1;
}
