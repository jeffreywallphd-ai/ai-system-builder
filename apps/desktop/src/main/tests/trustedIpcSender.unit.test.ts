import { describe, expect, it } from "../../../../../modules/testing/node-test";

import { isTrustedIpcSender } from "../trustedIpcSender";

describe("isTrustedIpcSender", () => {
  it("accepts only the live main frame of an owned window", () => {
    const mainFrame = {};
    const webContents = { mainFrame, isDestroyed: () => false };
    const windows = [{ webContents, isDestroyed: () => false }];

    expect(
      isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, windows),
    ).toBe(true);
    expect(
      isTrustedIpcSender({ sender: webContents, senderFrame: {} }, windows),
    ).toBe(false);
    expect(
      isTrustedIpcSender(
        { sender: { mainFrame }, senderFrame: mainFrame },
        windows,
      ),
    ).toBe(false);
    expect(
      isTrustedIpcSender(
        { sender: webContents, senderFrame: mainFrame },
        [{ webContents, isDestroyed: () => true }],
      ),
    ).toBe(false);
  });
});
