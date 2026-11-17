import { describe, expect, it } from "vitest";
import { normalizeSecurityError, toSecurityGuidance, STATUS_FAILURE, FORBIDDEN_GUIDANCE, UNPAIRED_GUIDANCE } from "../securityErrors";

describe("fixed Security error presentation", () => {
  it.each([undefined, null, false, "synthetic-private-error", new Error("synthetic-private-error"), { message: { value: "synthetic-private-error" } }])("normalizes unknown error %j", error => {
    expect(normalizeSecurityError(error, STATUS_FAILURE)).toEqual({ message: STATUS_FAILURE });
  });
  it.each([401, 403])("preserves safe HTTP %s and canonical code without payload/endpoint", status => {
    const code = status === 401 ? "security.invalid-token" : "security.forbidden";
    const error = normalizeSecurityError({ status, code, message: "synthetic-private-error", details: { value: "synthetic-private-detail" }, endpoint: "synthetic-private-endpoint" }, STATUS_FAILURE);
    expect(error).toEqual({ status, code, message: STATUS_FAILURE });
    expect(toSecurityGuidance(error)).toBe(status === 401 ? UNPAIRED_GUIDANCE : FORBIDDEN_GUIDANCE);
    expect(JSON.stringify(error)).not.toContain("synthetic-private");
  });
  it("rejects an unknown diagnostic code and a throwing property without copying it", () => {
    expect(normalizeSecurityError({ status: 999, code: "synthetic-private-code" }, STATUS_FAILURE)).toEqual({ message: STATUS_FAILURE });
    expect(normalizeSecurityError({ get status() { throw new Error("synthetic-private-error"); } }, STATUS_FAILURE)).toEqual({ message: STATUS_FAILURE });
    expect(toSecurityGuidance({ message: undefined as unknown as string })).toBeUndefined();
  });
});
