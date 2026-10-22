import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

/** Current source snapshot, including dirty/new files, without exposing file contents. */
export async function readAssetSystemSourceIdentity(root) {
  // Visual styles, templates, images/fonts and native/worker sources affect the
  // tested product too. Bind every nonignored input in these source roots,
  // rather than allowing an extension list to silently omit runtime behavior.
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "modules", "apps", "dev-tools", "package.json", "package-lock.json"], {cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024}).split("\0").filter(Boolean);
  const selected = [...new Set(files)].sort();
  if (selected.length > 20_000) throw new Error("Qualification source exceeds the file bound.");
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const file of selected) {
    const sourcePath = path.join(root, file);
    // Git also enumerates tracked files removed in an unstaged migration. Bind
    // the present working tree, independent of whether that removal is staged.
    // Other I/O failures and symlinks still deny; the end-of-probe snapshot
    // detects files restored or changed during execution.
    const stat = await lstat(sourcePath).catch(error => {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    });
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024 || totalBytes + stat.size > 512 * 1024 * 1024)
      throw new Error("Qualification source must contain bounded regular files.");
    const bytes = await readFile(sourcePath);
    totalBytes += bytes.length;
    if (bytes.length > 64 * 1024 * 1024 || totalBytes > 512 * 1024 * 1024)
      throw new Error("Qualification source exceeds the byte bound.");
    hash.update(file); hash.update("\0"); hash.update(bytes); hash.update("\0");
  }
  return `source.${hash.digest("hex")}`;
}

export async function assertAssetSystemSourceIdentity(root, expected) {
  if (await readAssetSystemSourceIdentity(root) !== expected)
    throw new Error("Source changed during probe loading or measurement; discard these results and rerun.");
}
