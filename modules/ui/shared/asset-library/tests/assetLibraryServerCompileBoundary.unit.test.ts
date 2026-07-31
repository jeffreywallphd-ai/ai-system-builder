import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";

function exportedModuleSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const exportPattern = /export\s+(?:type\s+)?(?:\*\s+from\s+|{[^}]*}\s+from\s+)(["'])([^"']+)\1/g;
  let match = exportPattern.exec(source);

  while (match) {
    specifiers.push(match[2]);
    match = exportPattern.exec(source);
  }

  return specifiers;
}

function resolvesToTsx(barrelPath: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;

  const basePath = join(dirname(barrelPath), specifier);
  return existsSync(`${basePath}.tsx`) || existsSync(join(basePath, "index.tsx"));
}

describe("asset library server compile boundary", () => {
  it("keeps the server-visible asset library barrel free of TSX re-exports", () => {
    const barrelPath = join(process.cwd(), "modules/ui/shared/asset-library/index.ts");
    const barrelSource = readFileSync(barrelPath, "utf8");
    const tsxSpecifiers = exportedModuleSpecifiers(barrelSource).filter((specifier) => resolvesToTsx(barrelPath, specifier));

    expect(tsxSpecifiers).toEqual([]);
  });
});
