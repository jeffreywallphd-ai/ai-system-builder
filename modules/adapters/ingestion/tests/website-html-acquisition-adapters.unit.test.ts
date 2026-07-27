import { describe, expect, it, testDouble } from "../../../testing/node-test";

import { DefaultWebsiteHtmlAcquisitionPipeline } from "../../../application/services/ingestion/default-website-html-acquisition.pipeline";
import { createWebsiteHtmlAcquisitionPort } from "../createWebsiteHtmlAcquisitionPort";
import { PlaywrightWebsiteHtmlAcquisitionAdapter } from "../playwright/PlaywrightWebsiteHtmlAcquisitionAdapter";
import { SimpleHttpWebsiteHtmlAcquisitionAdapter } from "../simple-http/SimpleHttpWebsiteHtmlAcquisitionAdapter";

describe("website html acquisition adapters and pipeline", () => {
  it("simple adapter reports simple-http mechanism", async () => {
    const adapter = new SimpleHttpWebsiteHtmlAcquisitionAdapter({
      egressBroker: {
        createSession: () => ({ fetch: async () => ({
        url: "https://example.com/simple",
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
        bytes: new TextEncoder().encode("<html><body><main><p>Simple</p></main></body></html>"),
      }) }),
      } as never,
    });

    const result = await adapter.acquireWebsiteHtml({
      target: { url: "https://example.com/simple" },
      mode: "automatic",
    });

    expect(result.acquisitionMechanismUsed).toBe("simple-http");
    expect(result.html).toContain("Simple");
  });

  it("playwright adapter reports rendered-browser mechanism", async () => {
    const close = testDouble.fn<() => Promise<void>>().mockResolvedValue(undefined);
    let routeHandler: ((route: any) => Promise<void>) | undefined;

    const adapter = new PlaywrightWebsiteHtmlAcquisitionAdapter({
      egressBroker: {
        createSession: () => ({ fetch: async (url: string) => ({
          url,
          status: 200,
          headers: { "content-type": "text/html" },
          bytes: new TextEncoder().encode("<html><body><main><p>Rendered</p></main></body></html>"),
        }) }),
      } as never,
      browserFactory: async () => ({
        newPage: async () => ({
          routeWebSocket: async () => undefined,
          route: async (_pattern, handler) => { routeHandler = handler; },
          goto: async (url) => {
            await routeHandler?.({
              request: () => ({
                url: () => url,
                method: () => "GET",
                headers: () => ({}),
                isNavigationRequest: () => true,
              }),
              fulfill: async () => undefined,
              abort: async () => undefined,
            });
            return { status: () => 200 };
          },
          content: async () => "<html><body><main><p>Rendered</p></main></body></html>",
        }),
        close,
      }),
    });

    const result = await adapter.acquireWebsiteHtml({
      target: { url: "https://example.com/rendered" },
      mode: "rendered",
    });

    expect(result.acquisitionMechanismUsed).toBe("rendered-browser");
    expect(result.html).toContain("Rendered");
    expect(close).toHaveBeenCalledOnce();
  });

  it("routes every browser request through secure egress, blocks WebSockets, and preserves the document URL", async () => {
    const close = testDouble.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const fulfill = testDouble.fn(async () => undefined);
    const abort = testDouble.fn(async () => undefined);
    const closeWebSocket = testDouble.fn(() => undefined);
    const fetchedUrls: string[] = [];
    let routeHandler: ((route: any) => Promise<void>) | undefined;
    let webSocketHandler: ((route: any) => Promise<void> | void) | undefined;
    const adapter = new PlaywrightWebsiteHtmlAcquisitionAdapter({
      egressBroker: {
        createSession: () => ({
          fetch: async (url: string) => {
            fetchedUrls.push(url);
            if (url.includes("127.0.0.1")) throw new Error("denied");
            return {
              url: url.includes("document") ? "https://public.example/final" : url,
              status: 200,
              headers: { "content-type": url.endsWith(".css") ? "text/css" : "text/html" },
              bytes: new TextEncoder().encode("bounded"),
            };
          },
        }),
      } as never,
      browserFactory: async () => ({
        newPage: async (options) => {
          expect(options).toEqual({ serviceWorkers: "block" });
          return {
            routeWebSocket: async (_pattern, handler) => { webSocketHandler = handler; },
            route: async (_pattern, handler) => { routeHandler = handler; },
            goto: async (url) => {
              await routeHandler?.({
                request: () => ({
                  url: () => url,
                  method: () => "GET",
                  headers: () => ({ authorization: "renderer-secret" }),
                  isNavigationRequest: () => true,
                }),
                fulfill,
                abort,
              });
              await routeHandler?.({
                request: () => ({
                  url: () => "https://public.example/site.css",
                  method: () => "GET",
                  headers: () => ({}),
                  isNavigationRequest: () => false,
                }),
                fulfill,
                abort,
              });
              await routeHandler?.({
                request: () => ({
                  url: () => "http://127.0.0.1/private",
                  method: () => "GET",
                  headers: () => ({}),
                  isNavigationRequest: () => false,
                }),
                fulfill,
                abort,
              });
              await webSocketHandler?.({ close: closeWebSocket });
              return { status: () => 200 };
            },
            content: async () => "<html><body><main>Bounded rendered page</main></body></html>",
          };
        },
        close,
      }),
    });

    const result = await adapter.acquireWebsiteHtml({
      target: { url: "https://public.example/document" },
      mode: "rendered",
    });

    expect(fetchedUrls).toEqual([
      "https://public.example/document",
      "https://public.example/site.css",
      "http://127.0.0.1/private",
    ]);
    expect(fulfill).toHaveBeenCalledTimes(2);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(closeWebSocket).toHaveBeenCalledWith({
      code: 1008,
      reason: "Network access is restricted by secure egress policy.",
    });
    expect(result.resolvedUrl).toBe("https://public.example/final");
  });

  it("pipeline falls back to advanced adapter when simple content is insufficient", async () => {
    const simple = {
      acquireWebsiteHtml: testDouble.fn().mockResolvedValue({
        resolvedUrl: "https://example.com/fallback",
        html: "<html><body></body></html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "simple-http",
      }),
    };

    const advanced = {
      acquireWebsiteHtml: testDouble.fn().mockResolvedValue({
        resolvedUrl: "https://example.com/fallback",
        html: "<html><body><main><p>Rendered fallback</p></main></body></html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "rendered-browser",
      }),
    };

    const pipeline = new DefaultWebsiteHtmlAcquisitionPipeline({ simple, advanced });

    const result = await pipeline.acquireWebsiteHtml({
      target: { url: "https://example.com/fallback" },
      mode: "automatic",
    });

    expect(simple.acquireWebsiteHtml).toHaveBeenCalledOnce();
    expect(advanced.acquireWebsiteHtml).toHaveBeenCalledOnce();
    expect(result.acquisitionMechanismUsed).toBe("rendered-browser");
  });

  it("pipeline does not fall back when simple content is sufficient", async () => {
    const simple = {
      acquireWebsiteHtml: testDouble.fn().mockResolvedValue({
        resolvedUrl: "https://example.com/sufficient",
        html: "<html><body><main><p>Enough content</p></main></body></html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "simple-http",
      }),
    };

    const advanced = {
      acquireWebsiteHtml: testDouble.fn().mockResolvedValue({
        resolvedUrl: "https://example.com/sufficient",
        html: "<html><body><main><p>Rendered</p></main></body></html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "rendered-browser",
      }),
    };

    const pipeline = new DefaultWebsiteHtmlAcquisitionPipeline({ simple, advanced });
    const result = await pipeline.acquireWebsiteHtml({
      target: { url: "https://example.com/sufficient" },
      mode: "automatic",
    });

    expect(simple.acquireWebsiteHtml).toHaveBeenCalledOnce();
    expect(advanced.acquireWebsiteHtml).not.toHaveBeenCalled();
    expect(result.acquisitionMechanismUsed).toBe("simple-http");
  });

  it("factory supports explicit strategy injection", async () => {
    const simple = {
      acquireWebsiteHtml: testDouble.fn().mockResolvedValue({
        sourceKind: "scrape",
        resolvedUrl: "https://example.com/a",
        html: "<html><body><main><p>a</p></main></body></html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "simple-http",
      }),
    };

    const advanced = {
      acquireWebsiteHtml: testDouble.fn().mockResolvedValue({
        sourceKind: "scrape",
        resolvedUrl: "https://example.com/a",
        html: "<html><body><main>advanced</main></body></html>",
        mediaType: "text/html",
        acquisitionMechanismUsed: "rendered-browser",
      }),
    };

    const port = createWebsiteHtmlAcquisitionPort({
      simpleStrategy: simple,
      advancedStrategy: advanced,
    });

    const result = await port.acquireWebsiteHtml({
      target: { url: "https://example.com/a" },
      mode: "automatic",
    });

    expect(simple.acquireWebsiteHtml).toHaveBeenCalledOnce();
    expect(result.acquisitionMechanismUsed).toBe("simple-http");
  });
});
