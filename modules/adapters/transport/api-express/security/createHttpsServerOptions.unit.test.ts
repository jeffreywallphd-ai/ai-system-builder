import { describe, expect, it } from "../../../../testing/node-test";
import { createHttpsServerOptions } from "./createHttpsServerOptions";

describe("createHttpsServerOptions", () => {
  it("fails clearly when certificate material is unavailable", () => {
    expect(() => createHttpsServerOptions(undefined)).toThrow(/TLS certificate material is unavailable/);
  });

  it("fails clearly when certificate PEM is missing", () => {
    expect(() => createHttpsServerOptions({ certPem: "", keyPem: "key", source: "manual" })).toThrow(/TLS certificate material is unavailable/);
  });

  it("fails clearly when key PEM is missing", () => {
    expect(() => createHttpsServerOptions({ certPem: "cert", keyPem: "", source: "manual" })).toThrow(/TLS certificate material is unavailable/);
  });

  it("returns cert/key server options for resolved material", () => {
    const result = createHttpsServerOptions({ certPem: "cert", keyPem: "key", source: "manual" });
    expect(result.cert).toBe("cert");
    expect(result.key).toBe("key");
  });
});
