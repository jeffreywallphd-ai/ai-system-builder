import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(desktopRoot, "../..");

export function createDesktopRendererConfig(name, source, port) {
  return {
    root: path.join(desktopRoot, "src", source),
    base: "./",
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
