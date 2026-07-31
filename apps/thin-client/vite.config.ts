import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createThinClientApiProxyConfig } from "./viteDevProxyConfig";
import { resolveThinClientViteHttpsConfig } from "./viteDevHttpsConfig";

export async function createThinClientViteConfig(environment: NodeJS.ProcessEnv = process.env) {
  const thinClientViteHttpsConfig = await resolveThinClientViteHttpsConfig(environment);

  return {
    plugins: [react()],
    server: {
      https: thinClientViteHttpsConfig || undefined,
      host: "0.0.0.0",
      proxy: {
        "/api": createThinClientApiProxyConfig(environment),
      },
      watch: {
        ignored: ["**/server-artifacts/**"],
      },
    },
  };
}

export default defineConfig(() => createThinClientViteConfig());
