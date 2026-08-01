import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "../../../../testing/node-test";
import { SafeMarkdownPreview } from "../SafeMarkdownPreview";

describe("SafeMarkdownPreview", () => {
  it("renders common Markdown as inert HTML elements", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdownPreview markdown={"# Heading\n\nA **strong** value with `code`.\n\n- First\n- Second"} />,
    );
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul>");
  });

  it("escapes raw HTML and refuses active links and remote images", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdownPreview
        markdown={'<script>alert("unsafe")</script>\n\n<img src=x onerror="alert(1)">\n\n[Unsafe](javascript:alert(1))\n\n![Remote](https://example.invalid/tracker.png)\n\n[Safe](https://example.com/docs)'}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).toContain("Image preview omitted: Remote");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
