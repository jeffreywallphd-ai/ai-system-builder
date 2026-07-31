import { createBearerTokenRequestSigner } from "./createBearerTokenRequestSigner";

export function createSecureFetch(deps: { getToken: () => string | undefined; fetchImplementation: (input: string, init?: { headers?: Record<string, string> } & Record<string, unknown>) => Promise<unknown>; clientSource?: string; }) {
  const signer = createBearerTokenRequestSigner(deps.getToken);
  return (input: string, init: { headers?: Record<string, string> } & Record<string, unknown> = {}) => {
    const headers = signer(init.headers);
    if (deps.clientSource) headers["x-client-source"] = deps.clientSource;
    return deps.fetchImplementation(input, { ...init, headers });
  };
}
