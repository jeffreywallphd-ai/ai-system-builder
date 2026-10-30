import type {ChildProcess} from "node:child_process";
import type {Readable,Writable} from "node:stream";
export type OwnedHostPurpose="image"|"settings";
export const OWNED_HOST_STOP_TIMEOUT_MS:number;
export function ownedHostShutdownProtocol(purpose:OwnedHostPurpose):Readonly<{command:string;prefix:string;schemaVersion:"image-host-shutdown-v1"|"settings-host-shutdown-v1"}>;
export interface OwnedHostShutdownAck {readonly schemaVersion:"image-host-shutdown-v1"|"settings-host-shutdown-v1";readonly runId:string;readonly sourceRevision:string;readonly pid:number;readonly status:"stopped";readonly backgroundTasksStopped:true;readonly persistenceClosed:true;readonly fullJobQualified:false;}
export function readOwnedHostShutdownAck(purpose:OwnedHostPurpose,line:unknown,runId:string,sourceRevision:string,pid:number):Readonly<OwnedHostShutdownAck>;
export function observeOwnedHostShutdown(purpose:OwnedHostPurpose,child:ChildProcess,runId:string,sourceRevision:string):{stop():Promise<Readonly<OwnedHostShutdownAck>>};
export function installOwnedHostShutdown(purpose:OwnedHostPurpose,options:{input:Readable;output:Writable;runId:string;sourceRevision:string;shutdown():Promise<void>;onSettled(passed:boolean):void}):{stop():Promise<void>};
