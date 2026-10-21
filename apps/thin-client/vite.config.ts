import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createThinClientApiProxyConfig, isLoopbackDevelopmentHost, validateThinClientApiProxyTarget } from "./viteDevProxyConfig";
import { resolveThinClientViteHttpsConfig } from "./viteDevHttpsConfig";

export function createDevelopmentExposureGuard(environment: NodeJS.ProcessEnv): Plugin {
  const lan = environment.AI_SYSTEM_BUILDER_SECURITY_MODE?.trim() === "lan-https-token";
  return {
    name: "thin-client-development-exposure-guard",
    configResolved(config) {
      if (config.command !== "serve") return;
      for (const listener of [config.server, config.preview]) {
        if ((!isLoopbackDevelopmentHost(listener.host) && !lan) || (lan && !listener.https)) {
          throw new Error("Nonloopback development requires lan-https-token with frontend HTTPS.");
        }
        const proxy = listener.proxy?.["/api"];
        if (!proxy && !lan) continue;
        const target = validateThinClientApiProxyTarget(typeof proxy === "string" ? proxy : proxy?.target, lan);
        if (target.protocol === "https:" && !isLoopbackDevelopmentHost(target.hostname) &&
            typeof proxy !== "string" && proxy?.secure === false) {
          throw new Error("Remote HTTPS API proxies require certificate verification.");
        }
      }
    },
  };
}

export async function createThinClientViteConfig(environment: NodeJS.ProcessEnv = process.env, command: "serve" | "build" = "serve") {
  // Production compilation has no development listener or need for private key material.
  const thinClientViteHttpsConfig = command === "serve" && await resolveThinClientViteHttpsConfig(environment);

  return {
    plugins: [react(), createDevelopmentExposureGuard(environment)],
    server: {
      https: thinClientViteHttpsConfig || undefined,
      host: environment.AI_SYSTEM_BUILDER_SECURITY_MODE?.trim() === "lan-https-token" ? "0.0.0.0" : "127.0.0.1",
      proxy: command === "serve" ? {
        "/api": createThinClientApiProxyConfig(environment),
      } : undefined,
      watch: {
        ignored: ["**/server-artifacts/**"],
      },
    },
  };
}

export default defineConfig(({ command }) => createThinClientViteConfig(process.env, command));
