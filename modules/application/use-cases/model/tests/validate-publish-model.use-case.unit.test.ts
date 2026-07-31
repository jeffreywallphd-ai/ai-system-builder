import {
  TaskType,
  createRuntimeCapabilityStatus,
} from "../../../../contracts/runtime";
import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { RuntimeCapabilityUnavailableError } from "../../../services/runtime";

import { ValidateModelUseCase } from "../validate-model.use-case";
import { PublishModelUseCase } from "../publish-model.use-case";

describe("ValidateModelUseCase", () => {
  it("starts validation via runtime task registry", async () => {
    const startTask = testDouble
      .fn()
      .mockResolvedValue({ requestId: "req-validate-1" });
    const useCase = new ValidateModelUseCase({
      modelRegistry: {
        getModelRecord: testDouble
          .fn()
          .mockResolvedValue({ modelRecordId: "m1", localPath: "/tmp/m1" }),
      } as never,
      runtimeTaskRegistry: {
        startTask,
        getTaskStatus: testDouble.fn(),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      } as never,
    });
    const result = await useCase.execute({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
    });
    expect(result.requestId).toBe("req-validate-1");
    expect(result.modelRecordId).toBe("m1");
    expect(startTask).toHaveBeenCalledWith({
      taskType: TaskType.MODEL_VALIDATION,
      workspaceId: "workspace-a",
      payload: {
        modelRecordId: "m1",
        modelPath: "/tmp/m1",
        expectedLoRA: undefined,
        expectedRecurrentAdditions: undefined,
        validationStrictness: "normal",
      },
    });
  });

  it("reads succeeded validation status and updates model record", async () => {
    const updateModelRecord = testDouble.fn().mockResolvedValue({ model: {} });
    const useCase = new ValidateModelUseCase({
      modelRegistry: {
        getModelRecord: testDouble.fn().mockResolvedValue({
          modelRecordId: "m1",
          localPath: "/tmp/m1",
          lifecycleStatus: "generated",
          metadata: {},
        }),
        updateModelRecord,
      } as never,
      runtimeTaskRegistry: {
        startTask: testDouble.fn().mockResolvedValue({ requestId: "req-1" }),
        getTaskStatus: testDouble.fn().mockResolvedValue({
          requestId: "req-1",
          workspaceId: "workspace-a" as never,
          taskType: TaskType.MODEL_VALIDATION,
          status: "succeeded",
          data: {
            modelRecordId: "m1",
            status: "valid",
            validationReportPath: "validation-report:" + "a".repeat(64),
            validationStrictness: "normal",
          },
        }),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      } as never,
    });
    await useCase.execute({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
    });
    const result = await useCase.read("req-1");
    expect(result.status).toBe("valid");
    expect(updateModelRecord).toHaveBeenCalled();
  });

  it("rejects renderer-selected model and report filesystem paths", async () => {
    const startTask = testDouble.fn();
    const useCase = new ValidateModelUseCase({
      modelRegistry: {
        getModelRecord: testDouble.fn().mockResolvedValue({
          modelRecordId: "m1",
          localPath: "/host/models/m1",
        }),
      } as never,
      runtimeTaskRegistry: {
        startTask,
        getTaskStatus: testDouble.fn(),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      } as never,
    });

    await expect(
      useCase.execute({
        workspaceId: "workspace-a" as never,
        modelRecordId: "m1",
        modelPath: "/renderer/selected",
      }),
    ).rejects.toThrow("resolved by the host");
    await expect(
      useCase.execute({
        workspaceId: "workspace-a" as never,
        modelRecordId: "m1",
        reportOutputDirectory: "/renderer/reports",
      }),
    ).rejects.toThrow("destinations are resolved by the host");
    expect(startTask).not.toHaveBeenCalled();
  });

  it("running/failed reads preserve modelRecordId context and succeeded updates once", async () => {
    const updateModelRecord = testDouble.fn().mockResolvedValue({ model: {} });
    let readCount = 0;
    const getTaskStatus = testDouble.fn(async () => {
      readCount += 1;
      if (readCount === 1)
        return {
          requestId: "req-2",
          taskType: TaskType.MODEL_VALIDATION,
          status: "running",
        };
      if (readCount === 2)
        return {
          requestId: "req-2",
          taskType: TaskType.MODEL_VALIDATION,
          status: "failed",
          error: { message: "bad" },
        };
      return {
        requestId: "req-3",
        workspaceId: "workspace-a" as never,
        taskType: TaskType.MODEL_VALIDATION,
        status: "succeeded",
        data: { modelRecordId: "m1", status: "valid" },
      };
    });
    const startTask = testDouble
      .fn()
      .mockResolvedValueOnce({ requestId: "req-2" })
      .mockResolvedValueOnce({ requestId: "req-3" });
    const useCase = new ValidateModelUseCase({
      modelRegistry: {
        getModelRecord: testDouble.fn().mockResolvedValue({
          modelRecordId: "m1",
          localPath: "/tmp/m1",
          lifecycleStatus: "generated",
          metadata: {},
        }),
        updateModelRecord,
      } as never,
      runtimeTaskRegistry: {
        startTask,
        getTaskStatus,
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      } as never,
    });
    await useCase.execute({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
    });
    expect((await useCase.read("req-2")).modelRecordId).toBe("m1");
    expect((await useCase.read("req-2")).modelRecordId).toBe("m1");
    await useCase.execute({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
    });
    await useCase.read("req-3");
    await useCase.read("req-3");
    expect(updateModelRecord).toHaveBeenCalledTimes(1);
  });
});

describe("PublishModelUseCase", () => {
  it("finalizes succeeded publish results with request-context workspace id", async () => {
    const updateModelRecord = testDouble.fn().mockResolvedValue({ model: {} });
    const getModelRecord = testDouble.fn(
      async (workspaceId: string, modelRecordId: string) => {
        if (workspaceId === "workspace-a" && modelRecordId === "m1") {
          return { modelRecordId: "m1", localPath: "/tmp/m1", metadata: {} };
        }
        return undefined;
      },
    );
    const useCase = new PublishModelUseCase({
      modelRegistry: { getModelRecord, updateModelRecord } as never,
      runtimeTaskRegistry: {
        startTask: testDouble
          .fn()
          .mockResolvedValue({ requestId: "req-publish-1" }),
        getTaskStatus: testDouble.fn().mockResolvedValue({
          requestId: "req-publish-1",
          workspaceId: "workspace-b" as never,
          taskType: TaskType.MODEL_PUBLISHING,
          status: "succeeded",
          data: {
            modelRecordId: "m1",
            published: true,
            provider: "huggingface",
            repository: "owner/repo",
            revision: "main",
          },
        }),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      } as never,
    });

    await useCase.execute({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
      repository: "owner/repo",
    });
    const result = await useCase.read("req-publish-1");

    expect(result.published).toBe(true);
    expect(getModelRecord.mock.calls.map((call) => call[0])).toEqual([
      "workspace-a",
      "workspace-a",
    ]);
    expect(updateModelRecord.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "workspace-a",
      modelRecordId: "m1",
    });
  });

  it("rejects publish finalization without workspace context", async () => {
    const useCase = new PublishModelUseCase({
      modelRegistry: {
        getModelRecord: testDouble.fn(),
        updateModelRecord: testDouble.fn(),
      } as never,
      runtimeTaskRegistry: {
        startTask: testDouble.fn(),
        getTaskStatus: testDouble.fn().mockResolvedValue({
          requestId: "req-orphan",
          taskType: TaskType.MODEL_PUBLISHING,
          status: "succeeded",
          data: {
            modelRecordId: "m1",
            published: true,
            provider: "huggingface",
            repository: "owner/repo",
          },
        }),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      } as never,
    });

    await expect(useCase.read("req-orphan")).rejects.toThrow(
      "Workspace id is required for model publishing result finalization.",
    );
  });

  it("does not let workspace A publish finalization update workspace B records", async () => {
    const updateModelRecord = testDouble.fn();
    const useCase = new PublishModelUseCase({
      modelRegistry: {
        getModelRecord: (() => {
          let callCount = 0;
          return testDouble.fn(async (workspaceId: string) => {
            callCount += 1;
            if (callCount === 1 && workspaceId === "workspace-a")
              return {
                modelRecordId: "m1",
                localPath: "/tmp/m1",
                metadata: {},
              };
            return undefined;
          });
        })(),
        updateModelRecord,
      } as never,
      runtimeTaskRegistry: {
        startTask: testDouble
          .fn()
          .mockResolvedValue({ requestId: "req-publish-cross" }),
        getTaskStatus: testDouble.fn().mockResolvedValue({
          requestId: "req-publish-cross",
          workspaceId: "workspace-b" as never,
          taskType: TaskType.MODEL_PUBLISHING,
          status: "succeeded",
          data: {
            modelRecordId: "m1",
            published: true,
            provider: "huggingface",
            repository: "owner/repo",
          },
        }),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      } as never,
    });

    await useCase.execute({
      workspaceId: "workspace-a" as never,
      modelRecordId: "m1",
      repository: "owner/repo",
    });
    await expect(useCase.read("req-publish-cross")).rejects.toThrow(
      "Model record 'm1' was not found.",
    );
    expect(updateModelRecord).not.toHaveBeenCalled();
  });

  it("rejects before task creation when model publishing readiness is unavailable", async () => {
    const startTask = testDouble.fn();
    const unavailable = new RuntimeCapabilityUnavailableError(
      createRuntimeCapabilityStatus({
        capabilityId: "model-publishing",
        status: "unavailable",
        summary:
          "Model publishing runtime execution is not implemented on this host.",
        reason: {
          code: "runtime.model-publishing.not-implemented",
          message:
            "Model publishing runtime execution is unavailable until implemented.",
          category: "unavailable",
          retryable: false,
        },
        recommendedActions: ["configure"],
      }),
    );
    const useCase = new PublishModelUseCase({
      modelRegistry: {
        getModelRecord: testDouble
          .fn()
          .mockResolvedValue({ modelRecordId: "m1", localPath: "/tmp/m1" }),
      } as never,
      runtimeTaskRegistry: {
        startTask,
        getTaskStatus: testDouble.fn(),
        cancelTask: testDouble.fn(),
        listTasks: testDouble.fn(),
      } as never,
      runtimeCapabilityGuard: {
        requireCapabilityReady: testDouble.fn(async () => {
          throw unavailable;
        }),
      },
    });

    await useCase
      .execute({
        workspaceId: "workspace-a" as never,
        modelRecordId: "m1",
        repository: "owner/repo",
      })
      .catch((error) =>
        expect(error).toMatchObject({
          code: "unavailable",
          details: {
            capabilityId: "model-publishing",
            status: "unavailable",
            reason: {
              code: "runtime.model-publishing.not-implemented",
              category: "unavailable",
            },
          },
        }),
      );
    expect(startTask).not.toHaveBeenCalled();
  });
});

it("rejects validation start when runtime capability is not ready", async () => {
  const startTask = testDouble.fn();
  const unavailable = new Error(
    "Runtime capability 'model-validation' is starting.",
  ) as Error & { code: "unavailable"; details: Record<string, unknown> };
  unavailable.name = "RuntimeCapabilityUnavailableError";
  unavailable.code = "unavailable";
  unavailable.details = {
    capabilityId: "model-validation",
    status: "starting",
    recommendedActions: ["wait"],
  };
  const useCase = new ValidateModelUseCase({
    modelRegistry: {
      getModelRecord: testDouble
        .fn()
        .mockResolvedValue({ modelRecordId: "m1", localPath: "/tmp/m1" }),
    } as never,
    runtimeTaskRegistry: {
      startTask,
      getTaskStatus: testDouble.fn(),
      cancelTask: testDouble.fn(),
      listTasks: testDouble.fn(),
    } as never,
    runtimeCapabilityGuard: {
      requireCapabilityReady: testDouble.fn(async () => {
        throw unavailable;
      }),
    },
  });

  await useCase
    .execute({ workspaceId: "workspace-a" as never, modelRecordId: "m1" })
    .catch((error) =>
      expect(error).toMatchObject({
        code: "unavailable",
        details: { capabilityId: "model-validation", status: "starting" },
      }),
    );
  expect(startTask).not.toHaveBeenCalled();
});
