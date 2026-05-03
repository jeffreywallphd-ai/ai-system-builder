import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "../../../testing/node-test";
import { DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL, DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL, DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL, DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL, DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL, DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL, createDesktopPrepareTrainingDatasetStartRequest, createDesktopPrepareTrainingDatasetStartSuccessResponse, createDesktopPrepareTrainingDatasetTaskReadRequest, createDesktopPrepareTrainingDatasetTaskReadSuccessResponse, createDesktopPrepareTrainingDatasetTaskCancelRequest, createDesktopPrepareTrainingDatasetTaskCancelSuccessResponse, getDesktopPrepareTrainingDatasetChannel } from "..";

describe("desktop dataset preparation ipc contract",()=>{
 it("defines async operation channels",()=>{
  expect(DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL.value).toContain("prepare-training-dataset.start");
  expect(DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL.value).toContain("prepare-training-dataset.start");
  expect(DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL.value).toContain("prepare-training-dataset.read-task");
  expect(DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL.value).toContain("prepare-training-dataset.read-task");
  expect(DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL.value).toContain("prepare-training-dataset.cancel-task");
  expect(DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL.value).toContain("prepare-training-dataset.cancel-task");
 });
 it("returns concrete operation-bound channel constants from the channel lookup helper",()=>{
  expect(getDesktopPrepareTrainingDatasetChannel("start-request")).toBe(DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL);
  expect(getDesktopPrepareTrainingDatasetChannel("start-response")).toBe(DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL);
  expect(getDesktopPrepareTrainingDatasetChannel("task-read-request")).toBe(DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL);
  expect(getDesktopPrepareTrainingDatasetChannel("task-read-response")).toBe(DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL);
  expect(getDesktopPrepareTrainingDatasetChannel("task-cancel-request")).toBe(DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL);
  expect(getDesktopPrepareTrainingDatasetChannel("task-cancel-response")).toBe(DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL);
 });
 it("keeps ipc channel contract types operation-bound instead of widened to raw string",()=>{
  const ipcContractsDirectory = resolve("modules/contracts/ipc");
  const violations = readdirSync(ipcContractsDirectory, { withFileTypes: true })
   .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
   .flatMap((entry) => {
    const filePath = resolve(ipcContractsDirectory, entry.name);
    const source = readFileSync(filePath, "utf8");
    return /\bIpcChannel\s*<\s*string\b/.test(source) ? [entry.name] : [];
   });

  expect(violations).toEqual([]);
 });
 it("creates start/read envelopes",()=>{
  const start=createDesktopPrepareTrainingDatasetStartRequest({command:{sourceArtifactIds:["a1"],recipe:{normalization:{targetFormat:"markdown"},chunking:{strategy:"character",chunkSize:1,chunkOverlap:0},generation:{mode:"qa",model:{provider:"transformers",modelId:"m"}}},split:{trainRatio:0.8,testRatio:0.2},output:{format:"jsonl"}},boundary:{host:"desktop",source:" test "}});
  expect(start.payload.boundary.source).toBe("test");
  const started=createDesktopPrepareTrainingDatasetStartSuccessResponse({requestId:"r1",taskType:"prepare-training-dataset",accepted:true,status:"queued"});
  expect(started.ok).toBe(true);
  const read=createDesktopPrepareTrainingDatasetTaskReadRequest({requestId:" r1 ",boundary:{host:"desktop",source:"x"}});
  expect(read.payload.requestId).toBe("r1");
  const status=createDesktopPrepareTrainingDatasetTaskReadSuccessResponse({requestId:"r1",taskType:"prepare-training-dataset",status:"running"});
  expect(status.ok).toBe(true);
  const cancel=createDesktopPrepareTrainingDatasetTaskCancelRequest({requestId:" r1 ",boundary:{host:"desktop",source:"x"}});
  expect(cancel.payload.requestId).toBe("r1");
  const cancelled=createDesktopPrepareTrainingDatasetTaskCancelSuccessResponse({requestId:"r1",cancelled:true,status:"cancelled"});
  expect(cancelled.ok).toBe(true);
 });
});
