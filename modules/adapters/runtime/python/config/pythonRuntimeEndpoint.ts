const CANONICAL_RUNTIME_HOST = "127.0.0.1" as const;

export interface PythonRuntimeLoopbackEndpoint {
  readonly host: typeof CANONICAL_RUNTIME_HOST;
  readonly port: string;
  readonly baseUrl: string;
}

function normalizePort(value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new TypeError("Python runtime port must be an integer between 1024 and 65535.");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new TypeError("Python runtime port must be an integer between 1024 and 65535.");
  }
  return String(port);
}

function normalizeLoopbackHostname(value: string): typeof CANONICAL_RUNTIME_HOST {
  const hostname = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    throw new TypeError("Python runtime host must be the host-owned loopback interface.");
  }
  return CANONICAL_RUNTIME_HOST;
}

export function normalizePythonRuntimeLoopbackBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError("Python runtime base URL must be a valid absolute loopback URL.");
  }
  if (
    parsed.protocol !== "http:"
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.pathname !== "/"
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    throw new TypeError("Python runtime base URL must be credential-free HTTP with no path, query, or fragment.");
  }
  normalizeLoopbackHostname(parsed.hostname);
  const port = normalizePort(parsed.port || "80");
  return `http://${CANONICAL_RUNTIME_HOST}:${port}`;
}

export function resolvePythonRuntimeLoopbackEndpoint(input: {
  readonly env?: NodeJS.ProcessEnv;
  readonly defaultPort: string;
}): PythonRuntimeLoopbackEndpoint {
  const env = input.env ?? process.env;
  const configuredHost = env.PYTHON_RUNTIME_HOST?.trim();
  if (configuredHost) normalizeLoopbackHostname(configuredHost);

  const configuredBaseUrl = env.PYTHON_RUNTIME_BASE_URL?.trim();
  if (configuredBaseUrl) {
    const baseUrl = normalizePythonRuntimeLoopbackBaseUrl(configuredBaseUrl);
    const configuredPort = env.PYTHON_RUNTIME_PORT?.trim();
    if (configuredPort && normalizePort(configuredPort) !== new URL(baseUrl).port) {
      throw new TypeError("PYTHON_RUNTIME_PORT must match the host-owned Python runtime base URL.");
    }
    return { host: CANONICAL_RUNTIME_HOST, port: new URL(baseUrl).port, baseUrl };
  }

  const port = normalizePort(env.PYTHON_RUNTIME_PORT?.trim() || input.defaultPort);
  return {
    host: CANONICAL_RUNTIME_HOST,
    port,
    baseUrl: `http://${CANONICAL_RUNTIME_HOST}:${port}`,
  };
}
