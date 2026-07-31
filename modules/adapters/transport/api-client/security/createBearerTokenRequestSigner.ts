export function createBearerTokenRequestSigner(getToken: () => string | undefined) {
  return (headers?: Record<string, string>): Record<string, string> => {
    const next: Record<string, string> = { ...(headers ?? {}) };
    const token = getToken();
    if (token) next.Authorization = `Bearer ${token}`;
    return next;
  };
}
