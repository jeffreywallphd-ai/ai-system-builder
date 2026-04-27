# Server App

`apps/server` is the Node/Express server host entry point.

## Toolchain

- Runtime: Node.js + TypeScript
- Transport adapter: Express (`modules/adapters/transport/api-express`)
- Composition root: `modules/hosts/server`
- Build output: `dist/apps/server/src/index.js`

## Commands

From the repository root:

- `npm run dev:server` - start server in watch mode (`tsx watch`) for local development.
- `npm run build:server` - compile server host and shared modules with `tsc`.
- `npm run start:server` - build then run compiled output.

From this workspace directly:

- `npm run dev`
- `npm run build`
- `npm run start`

## Hugging Face token configuration

- Server-host artifact-repo composition reads Hugging Face token from:
  1. `artifactRepo.huggingFaceAccessToken` composition option, then
  2. `HF_TOKEN`, then
  3. `HUGGING_FACE_TOKEN`.
- Thin-client Hugging Face register/localize/publish/verify flows depend on this server-side configuration for private/gated repositories.
