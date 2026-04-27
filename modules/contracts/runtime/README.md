# Runtime Contracts

Shared runtime execution contracts live in this module.

The contract family is intentionally thin and adapter-oriented:

- runtime target identity (`runtime-kind`, `runtime-target`)
- execution request contract (`runtime-execution-request`)
- execution result + failure contracts (`runtime-execution-result`, `runtime-execution-error`)
- optional progress/output event stream shape (`runtime-execution-event`)
- runtime diagnostics aligned to logging vocabulary (`runtime-execution-diagnostic`)

These contracts support the TypeScript-first model while leaving runtime protocol details evolvable for adapter implementations.
