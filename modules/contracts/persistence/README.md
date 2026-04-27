# Persistence Contracts

Shared persistence contracts for structured durable application data.

This family defines persistence-boundary vocabulary without choosing an ORM,
query library, or repository implementation strategy.

Current contract scope:

- record identity references (`persistence-record-reference`)
- persistence failure shape (`persistence-error`)
- persistence operation result envelope (`persistence-result`)
- operation helpers with record-alignment checks (`persistence-operation`)

Family invariants:

- persistence operations must use shared operation identity formatting
  (`lowercase.dot.segments`)
- persistence record references normalize `recordType` and `id`
- when a `record` is supplied, the operation must target that record type
  (`<recordType>.<action>[.<qualifier>...]`)

These contracts are intentionally distinct from:

- transport response contracts under `modules/contracts/transport`
- artifact/key storage contracts under `modules/contracts/storage`

Adapters can map this vocabulary to Postgres behavior while keeping
implementation details out of the shared contract layer.

