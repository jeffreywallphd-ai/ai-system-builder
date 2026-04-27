import { describe, expect, it } from "../../../../testing/node-test";

import { createInMemorySecretsAdapter } from "../createInMemorySecretsAdapter";

describe("createInMemorySecretsAdapter", () => {
  it("supports set/get/clear/has", async () => {
    const adapter = createInMemorySecretsAdapter();

    expect(await adapter.hasSecret("huggingface.token")).toBe(false);
    await adapter.setSecret("huggingface.token", "hf_token");
    expect(await adapter.hasSecret("huggingface.token")).toBe(true);
    expect(await adapter.getSecret("huggingface.token")).toBe("hf_token");

    await adapter.clearSecret("huggingface.token");
    expect(await adapter.hasSecret("huggingface.token")).toBe(false);
    expect(await adapter.getSecret("huggingface.token")).toBeUndefined();
  });
});
