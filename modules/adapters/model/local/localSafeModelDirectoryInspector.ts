import {lstat, realpath} from "node:fs/promises";
import path from "node:path";
import {createLocalModelFileListerAdapter} from "./createLocalModelFileListerAdapter";

/** Shared cooperative presence checks. Neither profile owns or locks files. */
export function createLocalSafeModelDirectoryInspector(options: {
  readonly allowedRootDirectories: readonly string[];
}, profile: "embedding" | "causal-training") {
  const roots = Object.freeze([...options.allowedRootDirectories]);
  const lister = createLocalModelFileListerAdapter({allowedRootDirectories: roots});
  const isInside = (root: string, candidate: string) => {
    const relative = path.relative(root, candidate);
    return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
  };
  return {async inspectExistingDirectory(localPath: string) {
    try {
      if (profile !== "embedding" && profile !== "causal-training") return;
      if (typeof localPath !== "string" || !path.isAbsolute(localPath) || localPath.length > 4096 ||
          /^[\\/]{2}/u.test(localPath) || /[\u0000-\u001f\u007f]/u.test(localPath)) return;
      if (roots.length < 1 || roots.length > 8 || roots.some(root => typeof root !== "string" || !path.isAbsolute(root) ||
          root.length > 4096 || /^[\\/]{2}/u.test(root) || /[\u0000-\u001f\u007f]/u.test(root))) return;
      const resolvedRoots = await Promise.all(roots.map(async root => {
        try {return {configured: path.resolve(root), canonical: await realpath(root)};} catch {return undefined;}
      }));
      const allowed = resolvedRoots.filter((root): root is {configured: string; canonical: string} => root !== undefined);
      const candidate = path.resolve(localPath);
      if (!allowed.some(root => isInside(root.configured, candidate) || isInside(root.canonical, candidate))) return;
      const canonical = await realpath(localPath);
      if (/^[\\/]{2}/u.test(canonical) || !allowed.some(root => isInside(root.canonical, canonical))) return;
      const inventory = await lister.listFiles(canonical);
      if (inventory.truncated || await realpath(localPath) !== canonical) return;
      const files = new Map(inventory.files.map(file => [file.relativePath, file.sizeBytes]));
      if (!((files.get("config.json") ?? 0) > 0) || !((files.get("model.safetensors") ?? 0) > 0)) return;
      if (profile === "causal-training") {
        if (!((files.get("tokenizer.json") ?? 0) > 0) || files.has("adapter_config.json") || files.has("model.safetensors.index.json")) return;
        // The inventory lists files. Reserved names must also deny empty
        // directories, dangling links and any other occupied entry.
        for (const marker of ["adapter_config.json", "model.safetensors.index.json"]) {
          try {await lstat(path.join(canonical, marker)); return;}
          catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;}
        }
        if (await realpath(localPath) !== canonical) return;
      } else if (!["tokenizer.json", "vocab.txt", "vocab.json", "spiece.model", "sentencepiece.bpe.model"].some(file => (files.get(file) ?? 0) > 0)) return;
      return Object.freeze({localModelReference: canonical});
    } catch {return;}
  }};
}
