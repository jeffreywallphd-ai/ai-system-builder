// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASSET_PACKAGE_MEDIA_TYPE,
  ASSET_PACKAGE_STARTER_FILENAME,
} from "../../../../contracts/asset-package";
import { downloadAssetPackageStarter } from "../AssetPackageManager";

describe("asset package starter download", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads the canonical starter and releases its object URL", () => {
    let clickedAnchor: HTMLAnchorElement | undefined;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function capture(this: HTMLAnchorElement) {
        clickedAnchor = this;
      });
    const createObjectURL = vi.fn(() => "blob:asset-package-starter");
    const revokeObjectURL = vi.fn();
    const scheduleCleanup = vi.fn((cleanup: () => void) => cleanup());

    downloadAssetPackageStarter({
      document,
      url: { createObjectURL, revokeObjectURL },
      scheduleCleanup,
    });

    expect(click).toHaveBeenCalledOnce();
    expect(clickedAnchor?.download).toBe(ASSET_PACKAGE_STARTER_FILENAME);
    expect(clickedAnchor?.href).toBe("blob:asset-package-starter");
    expect(clickedAnchor?.isConnected).toBe(false);
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe(ASSET_PACKAGE_MEDIA_TYPE);
    expect(blob?.size).toBeGreaterThan(0);
    expect(scheduleCleanup).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:asset-package-starter");
  });
});
