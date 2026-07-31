import { describe, expect, it, vi } from "vitest";
import { createSecureFetch } from "../../../../../modules/adapters/transport/api-client/security/createSecureFetch";

describe("createSecureFetch", () => {
  it("adds Authorization header when token exists", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const secureFetch = createSecureFetch({ getToken: () => "abc123", fetchImplementation: fetchImpl as any });
    await secureFetch("http://localhost/test");
    const headers = (fetchImpl.mock.calls[0][1] as any).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer abc123");
  });
});
