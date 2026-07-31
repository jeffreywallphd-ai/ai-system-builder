# Ingestion Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Use this family for transport-neutral staged artifact intake semantics.

What belongs here:
- staged artifact semantic identity and intake metadata (`id`, `sourceKind`, `originalName`, `createdAt`, `metadata`)
- staged artifact storage reference attachment as a backing concern (`descriptor.storage`)
- registration request/result shapes for staged artifact intake flows

How this differs from storage contracts:
- ingestion contracts define staged artifact meaning for inbound content
- storage contracts define artifact capability semantics (store/retrieve/has/delete bytes by key)
- ingestion is above storage mechanics and may be satisfied by storage adapters

Image upload note:
- artifact upload is one specialized intake path that registers staged artifact semantics
- it is not the canonical definition of the ingestion model

Resumable acquisition note:
- acquisition task contracts bound files, aggregate bytes, chunk size and count,
  progress messages, retries, and terminal cleanup state
- progress is derived from accepted host checkpoints rather than renderer claims
- source snapshots are immutable; refresh records append `unchanged`, `changed`,
  `unavailable`, or `removed` outcomes without rewriting prior snapshots
- structured records contain opaque checkpoint ids and storage keys only, never
  checkpoint bytes, credentials, or local filesystem paths
- the canonical command union covers file, exact-revision provider, and bounded
  website create/run/read/list/cancel/resume/refresh/cleanup flows for both IPC
  and HTTP without exposing adapter-specific payloads
