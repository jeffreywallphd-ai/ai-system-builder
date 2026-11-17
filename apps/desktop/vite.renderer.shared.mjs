import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(desktopRoot, "../..");

export function createDesktopRendererConfig(name, source, port) {
  return {
    root: path.join(desktopRoot, "src", source),
    base: "./",
    // Both servers share the repository package root. Vite's default cache
    // would let their different plugin/entry graphs overwrite one another,
    // leaving the other window with 504 Outdated Optimize Dep responses.
    cacheDir: path.join(repositoryRoot, "node_modules/.vite/desktop", name),
    // The runtime CSP forbids inline scripts. React Refresh injects an inline
    // preamble in development, so keep the runtime on Vite's ordinary reload.
    plugins: name === "main_window" ? [react()] : [],
    esbuild: { jsx: "automatic" },
    build: {
      outDir: path.join(repositoryRoot, ".vite/renderer", name),
      sourcemap: false,
      target: "chrome146",
    },
    resolve: { preserveSymlinks: true },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      cors: false,
      fs: {
        strict: true,
        allow: [
          path.join(desktopRoot, "src"),
          path.join(repositoryRoot, "modules"),
          path.join(repositoryRoot, "node_modules"),
        ],
      },
    },
  };
}
