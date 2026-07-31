import { describe, expect, it } from "../../../../testing/node-test";

import {
  isPublicEgressAddress,
  SecureEgressBroker,
  SecureEgressError,
  type SecureEgressRequestImplementation,
  type SecureEgressTransportResponse,
} from "../secureEgressBroker";

const PUBLIC_IPV4 = { address: "8.8.8.8", family: 4 as const };

async function* chunks(...values: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield value;
}

function response(input: {
  status?: number;
  headers?: Readonly<Record<string, string>>;
  chunks?: readonly Uint8Array[];
  cancel?: () => void;
} = {}): SecureEgressTransportResponse {
  return {
    status: input.status ?? 200,
    headers: input.headers ?? { "content-type": "text/plain" },
    body: chunks(...(input.chunks ?? [new TextEncoder().encode("ok")])),
    cancel: input.cancel,
  };
}

async function expectSecureEgressCode(
  operation: Promise<unknown>,
  expectedCode: SecureEgressError["code"],
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error instanceof SecureEgressError).toBe(true);
    expect((error as SecureEgressError).code).toBe(expectedCode);
    return;
  }
  throw new Error(`Expected secure egress failure ${expectedCode}.`);
}

function publicBroker(requestImplementation?: SecureEgressRequestImplementation): SecureEgressBroker {
  return new SecureEgressBroker({
    resolveDns: async () => [PUBLIC_IPV4],
    requestImplementation: requestImplementation ?? (async () => response()),
  });
}

describe("SecureEgressBroker", () => {
  it("rejects unsupported schemes, embedded credentials, local names, and private literals", async () => {
    const broker = publicBroker();
    const denied = [
      "file:///etc/passwd",
      "ftp://example.com/a",
      "https://user:secret@example.com/a",
      "http://localhost/a",
      "http://service.local/a",
      "http://127.0.0.1/a",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/a",
      "http://[fc00::1]/a",
    ];
    for (const target of denied) {
      await expect(broker.assertAllowedUrl(target)).rejects.toThrow();
    }
  });

  it("accepts public addresses and rejects reserved IPv4 and IPv6 ranges", () => {
    expect(isPublicEgressAddress("8.8.8.8")).toBe(true);
    expect(isPublicEgressAddress("2606:4700:4700::1111")).toBe(true);
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "192.168.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "2001:db8::1",
      "2001::1",
      "2002::1",
      "3fff::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicEgressAddress(address)).toBe(false);
    }
  });

  it("requires every DNS result to be public and consistent with its family", async () => {
    const mixed = new SecureEgressBroker({
      resolveDns: async () => [PUBLIC_IPV4, { address: "127.0.0.1", family: 4 }],
    });
    const mismatched = new SecureEgressBroker({
      resolveDns: async () => [{ address: "8.8.8.8", family: 6 }],
    });
    await expectSecureEgressCode(mixed.assertAllowedUrl("https://example.com"), "dns-denied");
    await expectSecureEgressCode(mismatched.assertAllowedUrl("https://example.com"), "dns-denied");
    await expect(publicBroker().assertAllowedUrl("https://example.com")).resolves.toBeUndefined();
  });

  it("re-resolves and rejects a redirect whose destination resolves privately", async () => {
    let requests = 0;
    const broker = new SecureEgressBroker({
      resolveDns: async (hostname) => hostname === "public.example"
        ? [PUBLIC_IPV4]
        : [{ address: "127.0.0.1", family: 4 }],
      requestImplementation: async () => {
        requests += 1;
        return response({ status: 302, headers: { location: "http://internal.example/secret" } });
      },
    });
    await expectSecureEgressCode(
      broker.createSession().fetch("https://public.example/start"),
      "dns-denied",
    );
    expect(requests).toBe(1);
  });

  it("strips credentials when following a cross-origin redirect", async () => {
    const observedHeaders: Readonly<Record<string, string>>[] = [];
    const broker = publicBroker(async ({ url, headers }) => {
      observedHeaders.push(headers);
      return url.hostname === "one.example"
        ? response({ status: 302, headers: { location: "https://two.example/final" } })
        : response();
    });
    await broker.createSession().fetch("https://one.example/start", {
      headers: { authorization: "Bearer secret", cookie: "session=secret", accept: "text/plain" },
    });
    expect(observedHeaders[0]?.authorization).toBe("Bearer secret");
    expect(observedHeaders[1]?.authorization).toBeUndefined();
    expect(observedHeaders[1]?.cookie).toBeUndefined();
    expect(observedHeaders[1]?.accept).toBe("text/plain");
  });

  it("enforces redirect, media-type, declared-size, streamed-size, and session byte limits", async () => {
    const redirectBroker = publicBroker(async () => response({
      status: 302,
      headers: { location: "https://example.com/again" },
    }));
    await expectSecureEgressCode(
      redirectBroker.createSession().fetch("https://example.com/start"),
      "redirect-denied",
    );

    const wrongType = publicBroker(async () => response({ headers: { "content-type": "application/x-executable" } }));
    await expectSecureEgressCode(
      wrongType.createSession({ allowedMediaTypes: ["text/*"] }).fetch("https://example.com"),
      "media-type-denied",
    );

    const declaredOversize = publicBroker(async () => response({
      headers: { "content-type": "text/plain", "content-length": "11" },
    }));
    await expectSecureEgressCode(
      declaredOversize.createSession({ maximumResponseBytes: 10 }).fetch("https://example.com"),
      "size-exceeded",
    );

    const streamedOversize = publicBroker(async () => response({
      chunks: [new Uint8Array(6), new Uint8Array(5)],
    }));
    await expectSecureEgressCode(
      streamedOversize.createSession({ maximumResponseBytes: 10 }).fetch("https://example.com"),
      "size-exceeded",
    );

    const session = publicBroker(async () => response({ chunks: [new Uint8Array(3)] }))
      .createSession({ maximumResponseBytes: 4, maximumTotalBytes: 5 });
    await session.fetch("https://example.com/one");
    await expectSecureEgressCode(session.fetch("https://example.com/two"), "size-exceeded");
  });

  it("accepts an empty 304 response without a content type for conditional refreshes", async () => {
    const result = await publicBroker(async () => response({
      status: 304,
      headers: { etag: '\"current\"' },
      chunks: [],
    }))
      .createSession({ allowedMediaTypes: ["text/html"] })
      .fetch("https://example.com/page");

    expect(result.status).toBe(304);
    expect(result.headers.etag).toBe('\"current\"');
    expect(result.bytes.byteLength).toBe(0);
  });

  it("keeps the deadline active while streaming the response body", async () => {
    const broker = publicBroker(async ({ signal }) => ({
      status: 200,
      headers: { "content-type": "text/plain" },
      body: (async function* () {
        yield new Uint8Array([1]);
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      })(),
    }));
    await expectSecureEgressCode(
      broker.createSession({ timeoutMs: 20 }).fetch("https://example.com/slow"),
      "timeout",
    );
  });

  it("limits concurrent transfers while preserving valid public responses", async () => {
    let active = 0;
    let maximumActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const broker = new SecureEgressBroker({
      policy: { maximumConcurrentRequests: 2 },
      resolveDns: async () => [PUBLIC_IPV4],
      requestImplementation: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gate;
        active -= 1;
        return response({ chunks: [new TextEncoder().encode("bounded")] });
      },
    });
    const session = broker.createSession();
    const pending = ["one", "two", "three"].map((name) =>
      session.fetch(`https://${name}.example/content`),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(maximumActive).toBe(2);
    release?.();
    const results = await Promise.all(pending);
    expect(results.map((result) => new TextDecoder().decode(result.bytes))).toEqual([
      "bounded",
      "bounded",
      "bounded",
    ]);
  });
});
