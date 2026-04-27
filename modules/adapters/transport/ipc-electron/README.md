# IPC Electron Transport Adapter

This adapter registers thin Electron IPC handlers that translate IPC transport
requests into application use-case calls and return structured IPC contract
responses.

Current implemented flow:

- `artifact.upload` request channel registration
- request payload/context delegation into `StoreArtifactUploadUseCase`
- structured IPC success/failure response mapping on the response channel

Current test coverage for this slice:

- unit mapping tests for request/context delegation and response translation
- integration test for real handler execution through use case + filesystem storage adapter
