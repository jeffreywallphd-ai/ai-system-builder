export function extractBearerToken(headerValue: string | string[] | undefined): string | undefined {
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!value?.startsWith("Bearer ")) return undefined;
  return value.slice("Bearer ".length).trim();
}
