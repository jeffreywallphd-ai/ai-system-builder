import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { ImageGenerationStatus } from "../components/ImageGenerationStatus";

describe("ImageGenerationStatus", () => {
  it("renders detailed runtime error messages", async () => {
    const c = document.createElement("div");
    const root = createRoot(c);
    const message = "ComfyUI failed during DirectML execution: Cannot access storage of OpaqueTensorImpl. Try CPU mode.";

    await act(async () => {
      root.render(
        <ImageGenerationStatus
          status="failed"
          requestId="r1"
          error={message}
        />,
      );
    });

    expect(c.textContent).toContain(message);
    await act(async () => { root.unmount(); });
  });
});
