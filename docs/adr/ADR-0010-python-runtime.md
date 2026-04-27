# ADR-0010: Python Runtime Sidecar Architecture for AI Workloads

## Status
Proposed

## Context

`ai-system-builder` is currently Node/Electron-based, and the platform needs advanced AI/data processing capabilities that are not practical to keep exclusively inside the Node runtime.

Python is required for:

- dataset templating
- preprocessing
- fine-tuning pipelines
- heavy data transformations

To preserve architectural consistency, the system must not:

- embed Python logic in the renderer
- scatter subprocess execution calls across the codebase
- create a second, parallel application architecture

## Decision

Python will be integrated as a **managed sidecar runtime**.

Node remains the **control plane** and owns orchestration and lifecycle governance.

Python performs **task-oriented execution only**, invoked through explicit application boundaries.

Communication between Node and Python will use local **HTTP** for now (instead of JSON-RPC), with protocol details isolated in adapter space.

The Python runtime will be accessed through clean architecture seams:

- application ports define the runtime boundary
- adapters implement runtime communication and translation

### Responsibilities

Node is responsible for:

- orchestration
- validation
- artifact integration
- runtime lifecycle management

Python is responsible for:

- heavy processing
- dataset transformation
- compute-intensive logic

## Architecture Overview

The architecture is layered as follows:

- **Domain**: dataset and transformation concepts only; no runtime/process concepts
- **Application**: use cases orchestrate runtime tasks through ports
- **Ports**: define the Python runtime boundary and task contracts
- **Adapters**: implement communication with the Python worker over the chosen protocol

## Runtime Model

The runtime model is a long-lived Python process managed by Node.

Lifecycle behavior includes:

- start
- health check
- restart

The model explicitly rejects per-request subprocess spawning.

## Storage + Artifacts

Python returns processed outputs to Node.

Node registers and manages resulting artifacts.

Python never writes directly to the artifact catalog.

## Consequences

### Positive

- strong separation of concerns
- reusable runtime boundary and adapter model
- consistent execution model across runtime-backed capabilities

### Negative

- additional runtime management complexity
- IPC/HTTP boundary overhead

## Future Considerations

- GPU support
- distributed execution
- batching
- streaming outputs
