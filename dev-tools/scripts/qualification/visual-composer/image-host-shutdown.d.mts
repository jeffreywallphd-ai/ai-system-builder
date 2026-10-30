import type {ChildProcess} from "node:child_process";
import type {Readable,Writable} from "node:stream";
export const IMAGE_STOP_COMMAND: string;
export const IMAGE_STOP_PREFIX: string;
export const IMAGE_STOP_TIMEOUT_MS: number;
export interface ImageShutdownAck {readonly schemaVersion:"image-host-shutdown-v1";readonly runId:string;readonly sourceRevision:string;readonly pid:number;readonly status:"stopped";readonly backgroundTasksStopped:true;readonly persistenceClosed:true;readonly fullJobQualified:false;}
export function readImageShutdownAck(line:unknown,runId:string,sourceRevision:string,pid:number): Readonly<ImageShutdownAck>;
export function observeImageHostShutdown(child:ChildProcess,runId:string,sourceRevision:string): {stop():Promise<Readonly<ImageShutdownAck>>};
export function installImageHostShutdown(options:{input:Readable;output:Writable;runId:string;sourceRevision:string;shutdown():Promise<void>;onSettled(passed:boolean):void}): {stop():Promise<void>};
