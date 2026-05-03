import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL,
  DESKTOP_MODEL_LIST_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL,
  DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL,
  createDesktopModelListRequest,
  createDesktopModelReferenceSaveSuccessResponse,
} from "..";

describe("desktop model management ipc contract", () => {
  it("defines request channels", () => {
    expect(DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL.value).toBe("ipc.model.browse.request");
    expect(DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL.value).toBe("ipc.model.details-read.request");
    expect(DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value).toBe("ipc.model.list.request");
    expect(DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL.value).toBe("ipc.model.reference-save.request");
    expect(DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL.value).toBe("ipc.model.download.request");
    expect(DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL.value).toBe("ipc.model.record-update.request");
    expect(DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value).toBe("ipc.model.record-delete.request");
    expect(DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL.value).toBe("ipc.model.train.request");
    expect(DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value).toBe("ipc.model.train-status.request");
    expect(DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL.value).toBe("ipc.model.validate.request");
    expect(DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL.value).toBe("ipc.model.publish.request");
  });

  it("creates list request and save response envelopes", () => {
    const request = createDesktopModelListRequest({ source: "generated", limit: 25 });
    expect(request.payload.source).toBe("generated");
    expect(request.payload.limit).toBe(25);

    const response = createDesktopModelReferenceSaveSuccessResponse({
      model: {
        modelRecordId: "m-1",
        displayName: "Demo",
        source: "huggingface",
        lifecycleStatus: "saved-reference",
        artifactForm: "full-model",
        provider: "huggingface",
        modelId: "openai/demo",
        createdAt: "2026-04-27T00:00:00.000Z",
      },
    });

    expect(response.ok).toBe(true);
    expect(response.value.model.lifecycleStatus).toBe("saved-reference");
  });
});
