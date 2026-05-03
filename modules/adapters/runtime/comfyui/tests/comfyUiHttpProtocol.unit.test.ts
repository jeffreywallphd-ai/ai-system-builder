import { describe, expect, it } from "../../../../testing/node-test";

import {
  mapComfyUiHistoryResponse,
  mapComfyUiPromptResponse,
  mapComfyUiQueueResponse,
} from "../comfyUiHttpProtocol";

describe("comfyUiHttpProtocol", () => {
  it("maps queue payload correctly", () => {
    const queue = mapComfyUiQueueResponse({ queue_running: [], queue_pending: [1] });
    expect(queue.queue_running).toEqual([]);
    expect(queue.queue_pending).toEqual([1]);
  });

  it("maps history payload correctly", () => {
    const history = mapComfyUiHistoryResponse({ a: { outputs: {} } });
    expect(history.a).toBeDefined();
  });

  it("maps prompt payload without undefined required fields", () => {
    const prompt = mapComfyUiPromptResponse({ prompt_id: "p-1", number: 9 });
    expect(prompt.prompt_id).toBe("p-1");
    expect(prompt.number).toBe(9);
  });

  it("rejects malformed payloads", () => {
    expect(() => mapComfyUiQueueResponse({ queue_running: 1, queue_pending: [] })).toThrow("queue_running");
    expect(() => mapComfyUiPromptResponse({ prompt_id: "" })).toThrow("prompt_id");
  });
});
