const DEFAULT_API_BASE_URL = "/api";

export function resolveApiBaseUrl(environment: ImportMetaEnv = import.meta.env): string {
  const configuredBaseUrl = environment.VITE_API_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return DEFAULT_API_BASE_URL;
  }

  return configuredBaseUrl;
}
