/** Types describe the existing observer; they add no runtime authority. */
export interface OwnedNativeProcessExitResult {
  readonly pid: number;
  readonly phase: "exited";
  readonly exitCode: number;
}

export interface OwnedNativeProcessExitObserver {
  readonly outcome: Promise<OwnedNativeProcessExitResult>;
  close(): Promise<void>;
}

export function observeOwnedNativeProcessExit(pid: number): Promise<OwnedNativeProcessExitObserver>;
