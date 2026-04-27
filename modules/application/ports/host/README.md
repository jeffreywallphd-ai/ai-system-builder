# Host Context Port

Application orchestration reads host metadata through `HostContextPort`.

- returns `HostContext` from shared host contracts
- can accept boundary context (`requestId`, `correlationId`) for propagation

This keeps host metadata explicit without leaking host framework objects inward.
