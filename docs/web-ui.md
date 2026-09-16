# Experimental web UI

The browser interface is implemented through M5 on the experimental branch.
TUI and headless entry points remain available. Version management and login/logout
are available; broader browser coverage and Electron remain later milestones. Publish jobs and prepublishOnly build the browser assets.

## Run locally

```bash
npm ci
npm ci --prefix web-ui
npm run build:web-ui
npm run preview:ui -- tests/fixtures/valid-bundle --port 0
```

Open the printed `Web UI:` URL. The production command is
`agentman ui [source] [--port 19877] [--no-open] [--update]` once the CLI and assets
have been built. Port 0 chooses an available port. If the default port is occupied,
the launcher selects an available port and reports it. An explicitly selected
occupied port fails with instructions. `ui` and `--config` cannot be combined.

For live development, run `npm run dev:ui -- [source] [--no-open] [--port 0]`.
One launcher serves Vite, API requests, event streams, and guarded HMR upgrades
on the same loopback port. It loads `web-ui/vite.config.ts`; production modules
do not import Vite. Ctrl-C drains work and closes the server. In the production CLI, a second
Ctrl-C releases owned locks and forces exit with code 130. The Quit button
uses the same shutdown contract. Neither mode has an idle shutdown timer.

## Browser behavior

- The launch token is read into memory and session storage, then removed from
  the URL before application requests. API calls and the fetch-based SSE stream
  send it in an Authorization header. Reloading the tab preserves the session.
- Catalogue details display README content as text. Source candidates, scope,
  repository, and tools are selected before an install. Repository scope fetches
  a preview using that repository's pinned bundle, so displayed and installed
  versions agree. Editing the repository requires loading its catalogue first.
- An install captures the current session revision. Server validation and the
  shared mutation lock reject stale, ambiguous, or excluded candidates. Changes
  to a session reset the browser's old selection.
- Installed records include exact tool/scope/repository identities. Updates run
  as jobs. Removals require a UI confirmation, and errors remain visible.
- Versions lists verified cached bundles and source identities. Download remote
  versions without activating them, select a directory-source global bundle with
  optional install synchronization, and remove unused caches (including unattested
  legacy caches). A live catalogue or installed reference prevents deletion. HTTP
  inputs resolve to discovery catalogues; their versions are selected
  through Skill versions for an exact tool/scope/repository instance. Unsupported
  sources and partial sync failures are shown explicitly. Unlike the TUI global
  cache picker, HTTP catalogues use only per-installation selection. If a reload
  supersedes a switch during sync, Activity reports it; completed install changes
  remain applied. Leaving the optional sync repository blank includes only personal
  installations.
- Sign in starts a cancellable job and presents an explicit sign-in link. A
  cancelled initial login returns to idle and can be retried before the source has
  been persisted. Login and reload both advance the session revision, invalidating
  previous browser selections.
  Sign out invalidates the catalogue and drains token-producing work before
  deleting credentials. Read-only auth status checks expiry without logging in.
- Synchronous changes wait at most five seconds for the mutation lock, then return
  a retryable conflict. Disconnected waiters are discarded; acquired commits finish
  before their response socket closes.
- Sources and settings read fresh persisted state. Failed setting writes restore
  the displayed value; environment-enforced options cannot be enabled in the UI.
- Activity shows phase and cancellation availability. Sign-in opens only when
  the user follows the authorization link. HTTPS is required except for HTTP on
  localhost, 127.0.0.1, or ::1, which supports the local Imposter mock. Downloads/commits cannot claim
  cancellation. Reconnecting starts with an authoritative snapshot, including
  jobs which finished while disconnected. An evicted result prompts a refresh.

The server never accepts browser-supplied source pins or skill paths. Project
membership restrictions are enforced on the server, including on install. A
membership failure exposes an empty permitted catalogue.

## Code boundaries

- `src/operations/`: shared operations, without renderer dependencies.
- `src/ui-server/`: loopback HTTP API, jobs, session generations, SSE, DTOs,
  validation and production static assets. See [the M2 contract](web-ui-m2.md).
- `src/ui-command.ts`: CLI port fallback, browser launch, and signal handling.
- `web-ui/`: React 18/Vite browser package with its own lockfile and DOM tests.
- `src/ui-server/api-types.ts`: type-only browser contract. The import check in
  `scripts/check-ui-imports.mjs` rejects runtime imports across this boundary.
- `assets/web-ui/`: generated production assets. Build through
  `npm run build:web-ui`; do not edit or commit them.
- `scripts/dev-ui.ts`: development-only middleware and HMR transport. Upgrade
  requests reach Vite only after exact Host and Origin validation.

Cross-process mutations still use the leases described in
[the M1b notes](web-ui-m1b.md). Auth token resolution uses a separate in-process
coordinator shared with TUI callers. The fixed OAuth callback port is 19875;
Chrome extension bridge is 19876; the default UI port is 19877.

## Validation

```bash
npm ci --prefix web-ui
npm run build:web-ui
npm run typecheck
npm run lint
npm test
npm run typecheck --prefix web-ui
npm run test:web-ui
npm run build:web-ui
npx playwright install chromium --only-shell
npm run test:browser:smoke
npm run test:browser:smoke -- --dev
```

Root tests cover real HTTP requests, source/repository identity, job/SSE races,
auth coordination, CLI startup and shutdown, and development-origin guards. The
browser-package suite checks bootstrap, stream decoding/reconnection, and each
implemented screen. The smoke script drives real Chromium against the real API
with a temporary home and repository: install, inspect, reload, remove, settings,
source navigation, and mobile layout. It checks filesystem/config outcomes and
writes desktop/mobile screenshots to the system temporary directory. It does
not authenticate a real account or modify the user's installed skills.

The browser smoke exercises global/per-skill version switching too. To test the
repository's real Imposter OAuth provider (with the synthetic account configured
in `mocks/oidc-server-config.yaml`):

```bash
imposter up mocks
# In another terminal, after building the web UI and installing Chromium:
npm run test:browser:auth
```

This checks cancellation, retry, the explicit login popup, catalogue loading,
named-source version browsing/download, and logout. It forces filesystem token
storage into a temporary HOME and never uses the real keychain. The callback
port 19875 must be free. M6 will expand browser coverage and run it across platforms
in CI, including a self-contained fake provider and packaged-consumer tests.

## Review follow-up

- The CLI checks for built assets before listening or opening a browser; `ui --help`
  always exits after help. Both registries build and include `assets/web-ui`.
- Shutdown cancels authentication even when a draining job reaches it later.
  Filesystem commits drain normally; a second CLI signal explicitly forces exit.
- Session acceptance never waits for an installation loop. Installation validates
  its revision under the mutation lease before committing its captured selection.
  Local lease waiters queue without consuming the external-process timeout.
- Moved directory bundles are compared against cached content before their new
  path is recorded as an alias. Existing pins and cache identities remain valid.
  Different content needs a distinct version or removal of the unused cache.
- Confirmation dialogs manage keyboard focus. Missing credentials show one
  actionable message, and failed loads settle membership status.
