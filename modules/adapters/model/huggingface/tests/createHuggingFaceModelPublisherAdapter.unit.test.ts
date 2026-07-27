import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { createHuggingFaceModelPublisherAdapter } from "../createHuggingFaceModelPublisherAdapter";

describe("createHuggingFaceModelPublisherAdapter", () => {
  it("uploads safetensors model directory files", async () => {
    const root = join(tmpdir(), `hf-publish-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "config.json"), "{}", "utf8");
    await writeFile(join(root, "model.safetensors"), "tensor", "utf8");

    const uploadFile = testDouble.fn(async () => undefined);
    const adapter = createHuggingFaceModelPublisherAdapter({ client: { uploadFile }, approvedModelRoots: [root] });

    const result = await adapter.publishModel({ workspaceId: "workspace-a" as never, modelRecordId: "m1", modelPath: root, repository: "owner/repo" });
    expect(result.published).toBe(true);
    expect(uploadFile.mock.calls.length).toBe(2);
  });

  it("rejects partial adapter output", async () => {
    const root = join(tmpdir(), `hf-publish-partial-adapter-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "adapter_model.safetensors"), "tensor", "utf8");

    const adapter = createHuggingFaceModelPublisherAdapter({ client: { uploadFile: testDouble.fn(async () => undefined) }, approvedModelRoots: [root] });
    await expect(adapter.publishModel({ workspaceId: "workspace-a" as never, modelRecordId: "m1", modelPath: root, repository: "owner/repo" })).rejects.toThrow(
      /requires adapter_config\.json and adapter safetensors weights/i,
    );
  });

  it("rejects a model directory outside every approved root", async () => {
    const approvedRoot = join(tmpdir(), `hf-approved-${Date.now()}`);
    const outsideRoot = join(tmpdir(), `hf-outside-${Date.now()}`);
    await mkdir(approvedRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(join(outsideRoot, "config.json"), "{}", "utf8");
    await writeFile(join(outsideRoot, "model.safetensors"), "tensor", "utf8");
    const adapter = createHuggingFaceModelPublisherAdapter({
      client: { uploadFile: testDouble.fn(async () => undefined) },
      approvedModelRoots: [approvedRoot],
    });

    await expect(adapter.publishModel({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
      modelPath: outsideRoot,
      repository: "owner/repo",
    })).rejects.toThrow(/outside every approved filesystem root/i);
  });

  it("rejects linked model subtrees and executable source files", async () => {
    const approvedRoot = join(tmpdir(), `hf-approved-links-${Date.now()}`);
    const modelRoot = join(approvedRoot, "model");
    const outsideRoot = join(tmpdir(), `hf-linked-outside-${Date.now()}`);
    await mkdir(modelRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(join(modelRoot, "config.json"), "{}", "utf8");
    await writeFile(join(modelRoot, "model.safetensors"), "tensor", "utf8");
    await writeFile(join(outsideRoot, "secret.json"), "{}", "utf8");
    await symlink(outsideRoot, join(modelRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
    const adapter = createHuggingFaceModelPublisherAdapter({
      client: { uploadFile: testDouble.fn(async () => undefined) },
      approvedModelRoots: [approvedRoot],
    });
    await expect(adapter.publishModel({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
      modelPath: modelRoot,
      repository: "owner/repo",
    })).rejects.toThrow(/symbolic link or junction/i);

    await import("node:fs/promises").then(({ rm }) => rm(join(modelRoot, "linked"), { force: true }));
    await writeFile(join(modelRoot, "run.py"), "print('unsafe')", "utf8");
    await expect(adapter.publishModel({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
      modelPath: modelRoot,
      repository: "owner/repo",
    })).rejects.toThrow(/not allowlisted: run\.py/i);
  });

  it("rejects missing shard index when shard files are present", async () => {
    const root = join(tmpdir(), `hf-publish-missing-index-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "model-00001-of-00002.safetensors"), "tensor", "utf8");
    await writeFile(join(root, "model-00002-of-00002.safetensors"), "tensor", "utf8");
    await writeFile(join(root, "config.json"), "{}", "utf8");

    const adapter = createHuggingFaceModelPublisherAdapter({ client: { uploadFile: testDouble.fn(async () => undefined) }, approvedModelRoots: [root] });
    await expect(adapter.publishModel({ workspaceId: "workspace-a" as never, modelRecordId: "m1", modelPath: root, repository: "owner/repo" })).rejects.toThrow(
      /requires model\.safetensors\.index\.json/i,
    );
  });

  it("rejects missing shard referenced by index", async () => {
    const root = join(tmpdir(), `hf-publish-missing-shard-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "config.json"), "{}", "utf8");
    await writeFile(
      join(root, "model.safetensors.index.json"),
      JSON.stringify({ weight_map: { "layer.0": "model-00001-of-00002.safetensors", "layer.1": "model-00002-of-00002.safetensors" } }),
      "utf8",
    );
    await writeFile(join(root, "model-00001-of-00002.safetensors"), "tensor", "utf8");

    const adapter = createHuggingFaceModelPublisherAdapter({ client: { uploadFile: testDouble.fn(async () => undefined) }, approvedModelRoots: [root] });
    await expect(adapter.publishModel({ workspaceId: "workspace-a" as never, modelRecordId: "m1", modelPath: root, repository: "owner/repo" })).rejects.toThrow(
      /missing shard file referenced by index/i,
    );
  });

  it("rejects full model without config", async () => {
    const root = join(tmpdir(), `hf-publish-missing-config-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "model.safetensors"), "tensor", "utf8");

    const adapter = createHuggingFaceModelPublisherAdapter({ client: { uploadFile: testDouble.fn(async () => undefined) }, approvedModelRoots: [root] });
    await expect(adapter.publishModel({ workspaceId: "workspace-a" as never, modelRecordId: "m1", modelPath: root, repository: "owner/repo" })).rejects.toThrow(
      /requires config\.json/i,
    );
  });

  it("publishes valid adapter directory files", async () => {
    const root = join(tmpdir(), `hf-publish-valid-adapter-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "adapter_config.json"), "{}", "utf8");
    await writeFile(join(root, "adapter_model.safetensors"), "tensor", "utf8");
    await writeFile(join(root, "tokenizer.json"), "{}", "utf8");

    const uploadFile = testDouble.fn(async () => undefined);
    const adapter = createHuggingFaceModelPublisherAdapter({ client: { uploadFile }, approvedModelRoots: [root] });
    await adapter.publishModel({ workspaceId: "workspace-a" as never, modelRecordId: "m1", modelPath: root, repository: "owner/repo" });

    const uploadedPaths = uploadFile.mock.calls.map((call) => call[0].path).sort();
    expect(uploadedPaths).toEqual(["adapter_config.json", "adapter_model.safetensors", "tokenizer.json"]);
  });

  it("publishes valid diffusion LoRA directory files", async () => {
    const root = join(tmpdir(), `hf-publish-valid-diffusion-lora-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "adapter_config.json"), "{}", "utf8");
    await writeFile(join(root, "pytorch_lora_weights.safetensors"), "tensor", "utf8");

    const uploadFile = testDouble.fn(async () => undefined);
    const adapter = createHuggingFaceModelPublisherAdapter({ client: { uploadFile }, approvedModelRoots: [root] });
    await adapter.publishModel({ workspaceId: "workspace-a" as never, modelRecordId: "m1", modelPath: root, repository: "owner/repo" });

    const uploadedPaths = uploadFile.mock.calls.map((call) => call[0].path).sort();
    expect(uploadedPaths).toEqual(["adapter_config.json", "pytorch_lora_weights.safetensors"]);
  });

  it("creates missing model repository and retries upload on provider 404", async () => {
    const root = join(tmpdir(), `hf-publish-create-repo-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "config.json"), "{}", "utf8");
    await writeFile(join(root, "model.safetensors"), "tensor", "utf8");

    let uploadAttempt = 0;
    const uploadFile = testDouble.fn(async () => {
      uploadAttempt += 1;
      if (uploadAttempt === 1) {
        throw { statusCode: 404, message: "Repository not found" };
      }
    });
    const fetchImplementation = testDouble.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const adapter = createHuggingFaceModelPublisherAdapter({ client: { uploadFile }, fetchImplementation, approvedModelRoots: [root] });

    const result = await adapter.publishModel({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
      modelPath: root,
      repository: "OpenFinAL/ai-system-builder-model",
      token: "hf_test",
    });

    expect(result.published).toBe(true);
    expect(uploadFile).toHaveBeenCalledTimes(3);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://huggingface.co/api/repos/create",
      {
        method: "POST",
        headers: {
          authorization: "Bearer hf_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "ai-system-builder-model",
          organization: "OpenFinAL",
          type: "model",
          private: true,
        }),
      },
    );
  });

  it("preserves an explicit public visibility choice when creating a missing repository", async () => {
    const root = join(tmpdir(), `hf-publish-create-public-repo-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "config.json"), "{}", "utf8");
    await writeFile(join(root, "model.safetensors"), "tensor", "utf8");

    let uploadAttempt = 0;
    const uploadFile = testDouble.fn(async () => {
      uploadAttempt += 1;
      if (uploadAttempt === 1) throw { statusCode: 404 };
    });
    const fetchImplementation = testDouble.fn(async () => new Response(null, { status: 200 }));
    const adapter = createHuggingFaceModelPublisherAdapter({
      client: { uploadFile },
      fetchImplementation,
      approvedModelRoots: [root],
    });

    await adapter.publishModel({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
      modelPath: root,
      repository: "OpenFinAL/public-model",
      token: "hf_test",
      private: false,
    });

    const createRequest = fetchImplementation.mock.calls[0]?.[1] as
      | { body?: string }
      | undefined;
    expect(JSON.parse(createRequest?.body ?? "{}")).toMatchObject({ private: false });
  });
});
