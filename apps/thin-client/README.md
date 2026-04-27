# Thin Client App

`apps/thin-client` is the server-backed thin-client host UI surface.

Current scope:

- minimal React bootstrap (`src/main.tsx`, `src/App.tsx`)
- page-first composition (`src/pages/HomePage.tsx`)
- feature-local artifact upload workflow under `src/features/artifact-upload/`
- feature-local artifact browser workflow under `src/features/artifact-browser/`
- fetch-based HTTP artifact-upload client that calls the server API route (`/api/artifact/upload`)
- artifact publish flow that calls `POST /api/artifact/publish` and surfaces published backing details
- artifact publish verification/re-check flow that calls `POST /api/artifact/publish/verify`
- imported-source verification/re-check flow that calls `POST /api/artifact/source/verify`
- artifact detail panel can render persisted published backing metadata from server-side binding records
- artifact register/import flow that calls `POST /api/artifact/register-from-repo` and refreshes artifact-browser selection on success
- imported artifact localize/download flow that calls `POST /api/artifact/localize-from-repo` when remote-source artifacts do not yet have local bytes
- artifact browser list/detail now surfaces minimal artifact-first backing-state cues (`Remote only`, `Localized`, `Published`) and local object availability/localization state
- artifact-browser publish/re-check state orchestration now uses a shared cross-host hook from `modules/ui/shared`
- token-first style baseline under `src/styles/`

## Hugging Face auth behavior

- Thin-client Hugging Face register/localize/publish/verify requests are server-backed.
- Configure `HF_TOKEN` or `HUGGING_FACE_TOKEN` (or server host `huggingFaceAccessToken`) in the **server** environment for private/gated Hugging Face repositories.
- Public repositories may work without a token depending on repository visibility/provider policy.
- Missing/invalid token and access-denied responses are surfaced as explicit auth-required/access-denied errors in UI messaging.

The thin-client artifact-upload path intentionally reuses the server transport + shared application use
case path rather than desktop preload wiring.

## Development wiring

- Default API base URL in thin-client code is `/api`.
- In local development, Vite proxies `/api` to `http://127.0.0.1:3000`, which allows running thin-client
  and server on separate ports while keeping feature clients same-origin by default.
- To use a different server origin directly, set `VITE_API_BASE_URL` (for example
  `http://127.0.0.1:3100/api`).

## Upload transport

- Thin-client artifact upload submits browser-native `multipart/form-data`.
- The upload form payload uses:
  - `file`: binary file body
  - `source`: upload source identifier

## Commands

From the repository root:

- `npm run dev:thin-client`
- `npm run build:thin-client`
- `npm run preview:thin-client`

From this workspace directly:

- `npm run dev`
- `npm run build`
- `npm run preview`


## Hugging Face token configuration UI

- Artifact Browser now includes a **Hugging Face token** section that shows configured/not-configured status and masked token state.
- Use **Save token** to configure/update token and **Clear token** to remove it.
- Token source of truth is server-side config (`/api/config/huggingface-token`), not browser-local state.
- Auth-required artifact errors now direct users to this in-product token settings path.
