# Persistence Port

Application orchestration depends on `PersistenceRecordPort` for structured,
durable record operations.

- load records through `LoadPersistenceRecordRequest`
- save records through `SavePersistenceRecordRequest`
- delete records through `DeletePersistenceRecordRequest`

Each request carries both:

- `operation: PersistenceOperation`
- `record: PersistenceRecordReference`

This keeps the application seam operation-aware and record-oriented, aligned
to the persistence contracts family (`<recordType>.<action>[.<qualifier>...]`).

This seam stays contract-driven and adapter-neutral; Postgres or other
persistence details belong in adapter implementations.
