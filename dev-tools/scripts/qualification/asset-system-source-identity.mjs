import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** Current source snapshot, including dirty/new files, without exposing file contents. */
export async function readAssetSystemSourceIdentity(root) {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "modules", "apps", "dev-tools", "package.json", "package-lock.json"], {cwd: root, encoding: "utf8"}).split("\0").filter(file => /\.(?:[cm]?[jt]sx?|json)$/.test(file));
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    hash.update(file); hash.update("\0"); hash.update(await readFile(path.join(root, file))); hash.update("\0");
  }
  return `source.${hash.digest("hex")}`;
}

export async function assertAssetSystemSourceIdentity(root, expected) {
  if (await readAssetSystemSourceIdentity(root) !== expected)
    throw new Error("Source changed during probe loading or measurement; discard these results and rerun.");
}
