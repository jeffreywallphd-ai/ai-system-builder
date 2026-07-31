import type { ExecutionResourceEstimateId } from './execution-plan-identity';
const compute=['none','low','medium','high','unknown'] as const; const storage=['none','small','medium','large','unknown'] as const; const duration=['instant','short','medium','long','unknown'] as const;
export type ExecutionComputeEstimateCategory=typeof compute[number]; export type ExecutionStorageEstimateCategory=typeof storage[number]; export type ExecutionDurationEstimateCategory=typeof duration[number];
export interface ExecutionResourceEstimate { id: ExecutionResourceEstimateId; compute: ExecutionComputeEstimateCategory; storage: ExecutionStorageEstimateCategory; duration: ExecutionDurationEstimateCategory; summary?: string; }
const norm=<T extends readonly string[]>(v:string,a:T,l:string)=>{const n=v.trim().toLowerCase(); if((a as readonly string[]).includes(n)) return n as T[number]; throw new Error(`${l} invalid.`)};
export const normalizeExecutionComputeEstimateCategory=(v:string)=>norm(v,compute,'ExecutionComputeEstimateCategory');
export const normalizeExecutionStorageEstimateCategory=(v:string)=>norm(v,storage,'ExecutionStorageEstimateCategory');
export const normalizeExecutionDurationEstimateCategory=(v:string)=>norm(v,duration,'ExecutionDurationEstimateCategory');
