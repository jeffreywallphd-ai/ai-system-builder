export type ExecutionDiagnosticSeverity='info'|'warning'|'error';
export type ExecutionDiagnostic={code:string;message:string;severity:ExecutionDiagnosticSeverity;targetReferenceId?:string;targetReferenceKind?:string};
export type ExecutionBlocker={code:string;message:string;targetReferenceId?:string;targetReferenceKind?:string};
