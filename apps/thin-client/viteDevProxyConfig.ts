import type { ProxyOptions } from "vite";

const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_SERVER_PORT = "3010";
export const THIN_CLIENT_API_PROXY_TIMEOUT_MS = 30 * 60 * 1000;
const HTTPS_CERT_MODES_WITH_DEV_TRUST = new Set(["auto-self-signed", "auto-local-ca"]);

type ThinClientDevProxyEnvironment = Partial<Record<
  | "AI_SYSTEM_BUILDER_HTTPS_ENABLED"
  | "AI_SYSTEM_BUILDER_SECURITY_MODE"
  | "AI_SYSTEM_BUILDER_TLS_CERT_MODE"
  | "AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET"
  | "PORT"
  | "SERVER_PORT",
  string
>>;

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function isHttpsServerEnvironment(environment: ThinClientDevProxyEnvironment): boolean {
  return (
    environment.AI_SYSTEM_BUILDER_SECURITY_MODE?.trim() === "lan-https-token" ||
    isEnabled(environment.AI_SYSTEM_BUILDER_HTTPS_ENABLED)
  );
}

function resolveServerPort(environment: ThinClientDevProxyEnvironment): string {
  return environment.SERVER_PORT?.trim() || environment.PORT?.trim() || DEFAULT_SERVER_PORT;
}

export function isLoopbackDevelopmentHost(host: string | boolean | undefined): boolean {
  return host === undefined || host === false ||
    (typeof host === "string" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host));
}

export function validateThinClientApiProxyTarget(target: unknown, requireHttps: boolean): URL {
  let parsed: URL;
  try {
    if (typeof target !== "string") throw new Error();
    parsed = new URL(target);
  } catch {
    throw new Error("Thin-client API proxy requires a valid HTTP(S) target.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Thin-client API proxy requires HTTP(S) without embedded credentials.");
  }
  if (requireHttps && parsed.protocol !== "https:") {
    throw new Error("LAN development requires an HTTPS API proxy target.");
  }
  return parsed;
}

export function resolveThinClientApiProxyTarget(
  environment: ThinClientDevProxyEnvironment = process.env,
): string {
  const explicitTarget = environment.AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET?.trim();
  const protocol = isHttpsServerEnvironment(environment) ? "https" : "http";
  const target = explicitTarget || `${protocol}://${DEFAULT_SERVER_HOST}:${resolveServerPort(environment)}`;
  validateThinClientApiProxyTarget(target, environment.AI_SYSTEM_BUILDER_SECURITY_MODE?.trim() === "lan-https-token");
  return target;
}

export function shouldVerifyThinClientApiProxyTls(
  environment: ThinClientDevProxyEnvironment = process.env,
): boolean {
  const target = new URL(resolveThinClientApiProxyTarget(environment));
  if (target.protocol !== "https:") {
    return true;
  }

  const certMode = environment.AI_SYSTEM_BUILDER_TLS_CERT_MODE?.trim();
  return !isLoopbackDevelopmentHost(target.hostname) || !HTTPS_CERT_MODES_WITH_DEV_TRUST.has(certMode ?? "");
}

export function createThinClientApiProxyConfig(
  environment: ThinClientDevProxyEnvironment = process.env,
): ProxyOptions {
  return {
    target: resolveThinClientApiProxyTarget(environment),
    changeOrigin: true,
    secure: shouldVerifyThinClientApiProxyTls(environment),
    timeout: THIN_CLIENT_API_PROXY_TIMEOUT_MS,
    proxyTimeout: THIN_CLIENT_API_PROXY_TIMEOUT_MS,
  };
}
