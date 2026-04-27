# Ingestion Contracts

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
