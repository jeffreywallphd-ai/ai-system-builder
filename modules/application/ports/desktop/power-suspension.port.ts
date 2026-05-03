export interface PowerSuspensionBlockerContext {
  requestId?: string;
  taskType?: string;
}

export interface PowerSuspensionBlockerState {
  blockerId: string;
  active: boolean;
}

export interface PowerSuspensionBlockerRecord extends PowerSuspensionBlockerState {
  reason: string;
  requestId?: string;
  taskType?: string;
}

export interface PowerSuspensionBlockerPort {
  startBlocker(
    reason: string,
    context?: PowerSuspensionBlockerContext,
  ): Promise<PowerSuspensionBlockerState>;
  stopBlocker(blockerId: string): Promise<PowerSuspensionBlockerState>;
  listBlockers(): Promise<PowerSuspensionBlockerRecord[]>;
}
