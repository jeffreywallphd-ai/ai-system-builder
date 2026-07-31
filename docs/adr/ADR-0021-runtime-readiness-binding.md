# ADR-0021: Runtime Readiness Binding

- Status: accepted
- Date: 2026-05-21
- Deciders: Core architecture maintainers
- Related: docs/architecture/runtime-readiness-binding.md, docs/architecture/asset-composition-planning.md, docs/architecture/effective-asset-projections.md, docs/adr/ADR-0020-asset-composition-planning.md, docs/adr/ADR-0019-effective-asset-projections.md

## Context

asset composition planning introduced validated workspace-scoped asset composition plans that remain planning-only and non-executing. The next architecture layer must determine whether required runtime capabilities are available before execution-oriented phases begin.

The repository needs a conservative readiness layer that:

- depends on validated composition plans;
- maps required capabilities to safe provider/capability inventory summaries;
- reports blockers and diagnostics clearly;
- avoids execution/provider invocation/installation concerns.

## Decision

runtime readiness binding introduces workspace-scoped runtime readiness bindings that map validated asset composition planning composition plans to safe runtime capability/provider inventory. These bindings identify available candidates, missing requirements, and blockers, but do not execute workflows, invoke providers, install dependencies, download models, or generate executable payloads.

## Accepted runtime readiness binding boundaries

runtime readiness binding accepts only readiness responsibilities:

- capability requirement extraction from validated plans;
- safe inventory discovery and capability matching;
- binding candidate and confirmed-binding metadata;
- readiness statuses, blockers, diagnostics, and provenance;
- readiness output metadata for execution plan preparation.

## Runtime readiness ownership and workspace scope

Runtime readiness records are workspace-scoped planning metadata. Ownership is application/readiness-layer governed, while inventory sources come from host/runtime adapter seams. No direct UI/runtime host execution is owned by runtime readiness binding.

## Depend on validated asset composition planning composition plans

runtime readiness binding consumes validated plan status/data as the sole normal source of readiness requirements. If plan state is missing/invalid/blocked/conflicted/stale/unsupported/archived/unvalidated, readiness returns blockers instead of bypassing planning.

## Keep runtime readiness non-executing

Readiness checks remain non-executing and must not:

- run workflows or runtime nodes;
- invoke provider/model execution APIs;
- generate execution payloads;
- mutate runtime/provider installation state.

## Use safe runtime inventory abstractions

Inventory is represented by safe capability/provider summaries only. No secrets, raw env values, raw filesystem paths, command lines, tokens, stack traces, provider payloads, bytes/blobs/base64, or signed URLs are exposed from readiness records.

## Defer provider invocation and execution

Provider invocation, model execution, workflow execution, installation, and model download belong to explicit execution-oriented boundaries, not runtime readiness binding.

## Relationship to asset composition planning

runtime readiness binding is downstream of asset composition planning. `valid` in asset composition planning means planning-valid only, not executable. runtime readiness binding preserves that constraint and only evaluates readiness-to-prepare.

## Relationship To Execution Plan Preparation

runtime readiness binding outputs a constrained readiness object (`RuntimeReadyCompositionBinding` conceptual shape) for execution plan preparation/materialization planning. execution plan preparation remains non-executing unless a later accepted execution boundary explicitly changes that.

## Consequences

Positive:

- clear separation between planning/readiness/execution concerns;
- explicit blocker surfaces before execution-oriented work;
- safer host/runtime inventory abstractions;
- predictable workspace-scoped readiness ownership.

Tradeoffs:

- readiness cannot guarantee successful execution;
- execution-specific failures remain outside runtime readiness binding;
- requires strict anti-drift rules to prevent accidental execution creep.

## Explicit non-goals

runtime readiness binding does not implement:

- workflow/runtime/model/ComfyUI execution;
- provider invocation;
- dependency installation/model download;
- credential creation/secret storage;
- shell command execution/environment mutation;
- workflow JSON/materialized executable payload generation;
- visual canvas authoring/arbitrary graph editing;
- pack import/export/marketplace behavior;
- collaboration permissions/live workspace synchronization;
- source mutation or `system.foundation` mutation/copying.
