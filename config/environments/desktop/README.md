> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Desktop Environment

The desktop environment represents the `local` deployment shape. Its structured
persistence target is SQLite under the desktop application-data persistence root;
artifact storage and runtime roots remain separate. Desktop host composition
opens and migrates SQLite before IPC registration. Allowlisted legacy structured
JSON/NDJSON is imported with a rollback copy and hash reconciliation. After the
activation marker is written, repositories use SQLite only; changed legacy data
fails startup instead of triggering fallback or dual writes.
