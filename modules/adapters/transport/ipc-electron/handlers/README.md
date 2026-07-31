# IPC Handlers

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

IPC handlers in this adapter must stay transport-thin:

- accept contract request envelopes from IPC
- delegate behavior to application use cases
- map use-case results to contract response envelopes

No business or storage policy should live in handlers.
