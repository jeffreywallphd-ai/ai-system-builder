# Host Context Port

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Application orchestration reads host metadata through `HostContextPort`.

- returns `HostContext` from shared host contracts
- can accept boundary context (`requestId`, `correlationId`) for propagation

This keeps host metadata explicit without leaking host framework objects inward.
