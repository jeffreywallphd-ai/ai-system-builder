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

export function resolveThinClientApiProxyTarget(
  environment: ThinClientDevProxyEnvironment = process.env,
): string {
  const explicitTarget = environment.AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET?.trim();
  if (explicitTarget) {
    return explicitTarget;
  }

  const protocol = isHttpsServerEnvironment(environment) ? "https" : "http";
  return `${protocol}://${DEFAULT_SERVER_HOST}:${resolveServerPort(environment)}`;
}

export function shouldVerifyThinClientApiProxyTls(
  environment: ThinClientDevProxyEnvironment = process.env,
): boolean {
  if (!resolveThinClientApiProxyTarget(environment).startsWith("https://")) {
    return true;
  }

  const certMode = environment.AI_SYSTEM_BUILDER_TLS_CERT_MODE?.trim();
  return !HTTPS_CERT_MODES_WITH_DEV_TRUST.has(certMode ?? "");
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
