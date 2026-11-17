> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Desktop prerequisite setup

Run `npm run dev:desktop` with Node 24 and npm. The launcher verifies the lockfile
versions of required npm packages throughout the installed tree and of the
Electron distribution before starting Forge. It approves optional packages for
reuse when the installed versions match the lockfile. It loads the Vite and
esbuild toolchain to check that this host has its native bindings. The approved
installers are `npm ci` with lifecycle scripts disabled and the locked Electron
package's installer with bundled checksums.

Desktop reuses a verified Python installation. If a compatible interpreter is
present but its worker dependencies are incomplete, setup creates a checkout
virtual environment and installs the repository's fixed worker requirements.
Initial package installation can take several minutes on a fresh Windows
checkout. The development launcher gives those package commands a separate
installation time limit from the app's local startup check.
If no compatible interpreter is installed on Windows x64, setup downloads the
portable Python Software Foundation package pinned in
[`desktop-python-artifact.json`](desktop-python-artifact.json). It verifies the
byte count and SHA-512 from the official NuGet catalog before extraction and
checks the installed interpreter binaries. The extraction and virtual
environment live under `.local-codex/desktop-prerequisites`.
Other platforms need a compatible Python with `venv` and `pip` already installed.

The setup lock serializes writes across launchers. A normal failure releases the
lock. After a forced stop, confirm the setup processes have exited, then remove
only the empty `setup.lock` directory in that checkout and retry. Setup publishes
a worker only after its installed dependencies pass the check.

The Desktop host checks the selected worker script and its Python environment
before opening the application shell.
Its failure screen identifies the required Python component and gives recovery
instructions without exposing child output or file locations. Optional runtimes
use their existing feature setup workflows.

Run `python dev-tools/helpers/run_focused_checks.py --profile desktop-prerequisite-bootstrap`
for the setup policy, runtime probe, and failure fixtures.
