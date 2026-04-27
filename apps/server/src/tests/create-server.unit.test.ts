import path from "node:path";

import { describe, expect, it } from "../../../../modules/testing/node-test";

import {
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME,
  resolveDefaultServerStorageRootDirectory,
  resolveServerRuntimeConfig,
} from "../createServer";

describe("resolveServerRuntimeConfig", () => {
  it("uses stable server-owned defaults when environment overrides are absent in CJS runtime", () => {
    if (typeof __dirname === "undefined") {
      expect(() => resolveServerRuntimeConfig({})).toThrow("__dirname is not defined");
      return;
    }

    const config = resolveServerRuntimeConfig({});
    expect(config.port).toBe(DEFAULT_SERVER_PORT);
    expect(config.storageRootDirectory).toBe(
      path.resolve(__dirname, "..", "..", DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME),
    );
  });

  it("honors SERVER_STORAGE_ROOT override when provided", () => {
    const config = resolveServerRuntimeConfig({
      SERVER_STORAGE_ROOT: " ./tmp/server-root ",
    });

    expect(config.storageRootDirectory).toBe(path.resolve("./tmp/server-root"));
  });

  it("exposes the same default storage root through resolveDefaultServerStorageRootDirectory in CJS runtime", () => {
    if (typeof __dirname === "undefined") {
      expect(() => resolveDefaultServerStorageRootDirectory()).toThrow("__dirname is not defined");
      return;
    }

    expect(resolveDefaultServerStorageRootDirectory()).toBe(
      path.resolve(__dirname, "..", "..", DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME),
    );
  });
});
