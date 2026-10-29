/** Types describe the existing observer; they add no runtime authority. */
export interface OwnedNativeProcessExitResult {
  readonly pid: number;
  readonly phase: "exited";
  readonly exitCode: number;
  readonly rootPid?: number;
  readonly retired?: readonly {readonly pid: number; readonly exitCode: number}[];
}

export interface OwnedNativeProcessAdmission {
  readonly pid: number;
  readonly rootPid?: number;
  readonly parentPid?: number;
  readonly chain?: readonly number[];
}

export interface OwnedNativeProcessExitObserver {
  readonly admission: OwnedNativeProcessAdmission;
  readonly outcome: Promise<OwnedNativeProcessExitResult>;
  close(): Promise<void>;
}

export function observeOwnedNativeProcessExit(pid: number, options?: {readonly rootPid: number}): Promise<OwnedNativeProcessExitObserver>;
export function createOwnedNativeExitProtocol(pid: number, options?: {readonly rootPid: number}): {
  readonly admission: OwnedNativeProcessAdmission | undefined;
  accept(line: string): "ready" | "exited";
  finish(): OwnedNativeProcessExitResult;
};
