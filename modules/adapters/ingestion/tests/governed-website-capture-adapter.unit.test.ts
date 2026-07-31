import { describe, expect, it } from "../../../testing/node-test";
import { GovernedWebsiteCaptureAdapter } from "../governed-website/GovernedWebsiteCaptureAdapter";

function broker(responses: (url: string) => { url?: string; status: number; headers?: Record<string, string>; body?: string }) {
  return {
    createSession: () => ({
      fetch: async (url: string) => {
        const response = responses(url);
        return {
          url: response.url ?? url,
          status: response.status,
          headers: response.headers ?? { "content-type": "text/plain" },
          bytes: new TextEncoder().encode(response.body ?? ""),
        };
      },
    }),
  } as never;
}

describe("GovernedWebsiteCaptureAdapter", () => {
  it("resolves a bounded same-origin sitemap and captures raw and derived content with robots evidence", async () => {
    const adapter = new GovernedWebsiteCaptureAdapter({
      now: () => "2026-07-30T12:00:00.000Z",
      egressBroker: broker((url): { url?: string; status: number; headers?: Record<string, string>; body?: string } => {
        if (url.endsWith("/sitemap.xml")) return { status: 200, headers: { "content-type": "application/xml" }, body: "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>" };
        if (url.endsWith("/robots.txt")) return { status: 200, body: "User-agent: *\nDisallow: /private\nAllow: /" };
        return { status: 200, headers: { "content-type": "text/html", etag: "v1" }, body: "<html><script>secret()</script><main>Hello <b>world</b></main></html>" };
      }),
    });

    const urls = await adapter.resolveScope({ kind: "sitemap", urls: ["https://example.com/sitemap.xml"], maximumPages: 2 });
    const capture = await adapter.capturePage(urls[0]!);

    expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(capture).toMatchObject({ outcome: "captured", canonicalUrl: "https://example.com/a", robots: { decision: "allowed" }, etag: "v1" });
    if (capture.outcome === "captured") {
      expect(new TextDecoder().decode(capture.derivedTextBytes)).toBe("Hello world");
      expect(capture.contentDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it("fails closed when robots disallows the selected page", async () => {
    const adapter = new GovernedWebsiteCaptureAdapter({
      egressBroker: broker((url) => url.endsWith("/robots.txt")
        ? { status: 200, body: "User-agent: *\nDisallow: /private" }
        : { status: 200, headers: { "content-type": "text/html" }, body: "<p>private</p>" }),
    });
    await expect(adapter.capturePage("https://example.com/private/data")).rejects.toThrow(/not allowed/i);
  });

  it("rejects cross-origin sitemap entries and reports removed pages without storing a body", async () => {
    const sitemapAdapter = new GovernedWebsiteCaptureAdapter({
      egressBroker: broker(() => ({ status: 200, headers: { "content-type": "application/xml" }, body: "<urlset><url><loc>https://other.example/a</loc></url></urlset>" })),
    });
    await expect(sitemapAdapter.resolveScope({ kind: "sitemap", urls: ["https://example.com/sitemap.xml"] })).rejects.toThrow(/same|selected website/i);

    const removedAdapter = new GovernedWebsiteCaptureAdapter({
      now: () => "2026-07-30T12:00:00.000Z",
      egressBroker: broker((url) => url.endsWith("/robots.txt") ? { status: 404 } : { status: 410, headers: { "content-type": "text/html" } }),
    });
    await expect(removedAdapter.capturePage("https://example.com/gone")).resolves.toMatchObject({ outcome: "removed", httpStatus: 410 });
  });

  it("sends bounded HTTP validators and reports a 304 as unchanged", async () => {
    let pageHeaders: Record<string, string> | undefined;
    const adapter = new GovernedWebsiteCaptureAdapter({
      now: () => "2026-07-30T12:00:00.000Z",
      egressBroker: {
        createSession: () => ({ fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
          if (url.endsWith("/robots.txt")) return { url, status: 404, headers: { "content-type": "text/plain" }, bytes: new Uint8Array() };
          pageHeaders = init?.headers;
          return { url, status: 304, headers: {}, bytes: new Uint8Array() };
        } }),
      } as never,
    });
    await expect(adapter.capturePage("https://example.com/a", undefined, { etag: "v1", lastModified: "Wed, 30 Jul 2026 12:00:00 GMT" })).resolves.toMatchObject({ outcome: "unchanged", httpStatus: 304 });
    expect(pageHeaders).toMatchObject({ "if-none-match": "v1", "if-modified-since": "Wed, 30 Jul 2026 12:00:00 GMT" });
  });
});
