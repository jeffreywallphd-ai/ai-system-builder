const SECRET_PATTERN = /(authorization|bearer\s+[a-z0-9\-_.~+/]+=*)/gi;

export function redactSecurityDiagnostics(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SECRET_PATTERN, "[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => redactSecurityDiagnostics(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => {
      if (key.toLowerCase().includes("authorization") || key.toLowerCase().includes("token")) return [key, "[REDACTED]"];
      return [key, redactSecurityDiagnostics(val)];
    }));
  }
  return value;
}
