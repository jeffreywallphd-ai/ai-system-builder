import { promises as fs } from "node:fs";
import path from "node:path";
import type { TlsCertificateStorePort } from "../../../application/ports/security";

export function createFilesystemTlsCertificateStore(): TlsCertificateStorePort {
  return {
    async fileExists(target) { try { await fs.access(target); return true; } catch { return false; } },
    readText(target) { return fs.readFile(target, "utf8"); },
    async ensureDirectory(target) { await fs.mkdir(target, { recursive: true }); },
    async writeTextAtomic(target, text, mode) {
      const dir = path.dirname(target);
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, text, { encoding: "utf8", mode });
      await fs.rename(tmp, target);
    },
  };
}
