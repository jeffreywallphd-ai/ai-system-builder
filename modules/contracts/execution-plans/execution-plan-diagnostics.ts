export type ExecutionDiagnosticSeverity = 'info'|'warning'|'error';
export interface ExecutionDiagnostic { diagnosticId?: string; code: string; severity: ExecutionDiagnosticSeverity; message: string; targetReferenceKind?: string; targetReferenceId?: string; }
export interface ExecutionBlocker { blockerId?: string; code: string; message: string; targetReferenceKind?: string; targetReferenceId?: string; }
