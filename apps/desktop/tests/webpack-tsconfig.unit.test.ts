import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../modules/testing/node-test";

type DesktopWebpackTsConfig = {
  compilerOptions?: {
    noEmit?: boolean;
  };
  include?: string[];
  exclude?: string[];
};

function loadDesktopWebpackTsConfig(): DesktopWebpackTsConfig {
  const configPath = resolve("apps/desktop/tsconfig.webpack.json");
  const source = readFileSync(configPath, "utf8");
  return JSON.parse(source) as DesktopWebpackTsConfig;
}

describe("desktop webpack TypeScript config", () => {
  it("includes shared modules source files required by desktop host composition", () => {
    const config = loadDesktopWebpackTsConfig();
    const include = config.include ?? [];

    expect(include).toContain("../../modules/**/*.ts");
    expect(include).toContain("../../modules/**/*.tsx");
    expect(include).toContain("../../modules/**/*.d.ts");
  });

  it("excludes module test files from webpack compilation to keep desktop runtime builds emit-safe", () => {
    const config = loadDesktopWebpackTsConfig();
    const exclude = config.exclude ?? [];

    expect(exclude).toContain("../../modules/**/*.test.ts");
    expect(exclude).toContain("../../modules/**/*.test.tsx");
    expect(exclude).toContain("../../modules/**/tests/**");
  });

  it("does not disable emit for webpack main TypeScript compilation", () => {
    const config = loadDesktopWebpackTsConfig();
    expect(config.compilerOptions?.noEmit).not.toBe(true);
  });
});
