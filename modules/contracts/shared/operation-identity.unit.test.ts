import { describe, expect, it } from "../../testing/node-test";

import {
  createOperationIdentity,
  isOperationIdentity,
  normalizeOperationIdentity,
} from "./operation-identity";

describe("operation identity helpers", () => {
  it("normalizes operation identities to lowercase dotted form", () => {
    expect(normalizeOperationIdentity(" Workspace.Create ")).toBe(
      "workspace.create",
    );
    expect(normalizeOperationIdentity("Runtime.Tool.Run")).toBe("runtime.tool.run");
  });

  it("creates operation identities from segments", () => {
    expect(createOperationIdentity("workspace", "create")).toBe("workspace.create");
    expect(createOperationIdentity("runtime", "tool", "run")).toBe(
      "runtime.tool.run",
    );
  });

  it("rejects values that do not match the operation identity format", () => {
    expect(() => normalizeOperationIdentity("workspace")).toThrow(
      "Operation identity must use lowercase dot-separated segments",
    );
    expect(() => normalizeOperationIdentity("workspace._create")).toThrow(
      "Operation identity must use lowercase dot-separated segments",
    );
    expect(() => normalizeOperationIdentity("workspace..create")).toThrow(
      "Operation identity must use lowercase dot-separated segments",
    );
  });

  it("checks operation identity values without mutating input", () => {
    expect(isOperationIdentity("workspace.create")).toBe(true);
    expect(isOperationIdentity("Workspace.Create")).toBe(false);
    expect(isOperationIdentity("workspace_create")).toBe(false);
  });
});
