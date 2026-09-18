# Experimental web UI

The browser interface runs locally alongside the CLI's TUI and headless entry
points. It supports catalogue browsing, skill installation/update/removal, sources,
settings, version selection and sign-in/out. Browser integration tests cover both
development and packaged production serving. The [M8 desktop shell](desktop.md) adds native repository selection and
macOS/Windows installer packaging.

Use this guide for the current implementation and the [API reference](web-ui-api.md)
for request/response fields. The M1b/M2 notes record the earlier extraction and
server milestones.

## Launch and development

```bash
npm ci
npm ci --prefix web-ui
npm run build:web-ui
npm run preview:ui -- tests/fixtures/valid-bundle --port 0
```

These commands run this checkout without assuming the feature has been released
on npm. `preview:ui` runs the TypeScript CLI with browser auto-open disabled and
serves the generated production assets. It does not rebuild them.

After compiling the CLI with `npm run build`, the equivalent command is
`node dist/index.js ui tests/fixtures/valid-bundle --no-open --port 0`. Releases
containing the web UI can be started with:

```bash
npx -y @ai-agent-manager/cli@latest ui https://skills.example.com
```

Open the printed `Web UI:` URL. The installed command is
`agentman ui [source] [--port 19877] [--no-open] [--update]` once the CLI and assets
have been built. Omit the source to use saved-source resolution. `--update`
forces reacquisition, and `ui --help` / `ui --version` exit without starting a server.
Port 0 chooses an available port. If the default port is occupied,
the launcher selects an available port and reports it. An explicitly selected
occupied port fails with instructions. `ui` and `--config` cannot be combined.

For live development, run `npm run dev:ui -- [source] [--no-open] [--port 0]`.
One launcher serves Vite, API requests, event streams, and guarded HMR upgrades
on the same loopback port. It loads `web-ui/vite.config.ts`; production modules
do not import Vite. Ctrl-C drains work and closes the server. In the production CLI, a second
Ctrl-C releases owned locks and forces exit with code 130. The Quit button
uses the same shutdown contract. Closing the browser tab leaves the server and
its jobs running. Neither mode has an idle shutdown timer.

| Service | Port |
| --- | --- |
| OAuth callback | 19875, fixed by the redirect URI |
| Chrome extension bridge | 19876, separate service |
| Browser UI | 19877 by default, or an explicit/ephemeral port |

Production publishing builds `assets/web-ui/` in `prepublishOnly` and both registry
publish jobs. `npm pack` alone does not compile the CLI or build browser assets;
build both first. The pack hook replaces the repository README with
`scripts/README.npm.md`, so keep its user-facing launch instructions synchronized.

## Browser behavior

- The Appearance selector above Quit offers System (the default), Light, and Dark.
  System follows OS appearance changes. The choice is saved in application settings
  and restored in both the browser and desktop app on subsequent launches.
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
- `desktop/`: Electron main/preload, external-link and IPC policy, installers and
  isolated desktop tests. See [the desktop guide](desktop.md).
- `scripts/dev-ui.ts`: development-only middleware and HMR transport. Upgrade
  requests reach Vite only after exact Host and Origin validation.

The TUI now uses `loadSession`, `loadBundleVersion` and `runStartupChecks` from
`src/operations/session.ts`. Its adapter renders progress/authentication prompts
and maps the returned state into existing screens. To preserve responsive menus,
it requests `deferMembership` and then calls `loadSessionMembership` in the
background. Restricted catalogues remain empty until membership succeeds, and
completion does not change the user's current screen. HTTP callers retain the
default behavior of waiting for membership before publishing a ready session.
Unmounting the TUI aborts pending startup authentication and suppresses late state
updates. Per-skill version selection/alignment also uses shared operations;
terminal menus and result messages stay in the components.
One visible improvement is that scanner warnings, such as malformed Rovo agent
files, now appear in the TUI warning panel instead of writing to stderr and
disrupting the Ink display.

## Security and source scope

The HTTP server listens only on `127.0.0.1`. Host must match the actual bound
address exactly, and an Origin header must match when supplied. No CORS permission
is emitted. Every API route requires a fresh per-launch bearer token, including
reads and SSE; only static assets and `/health` are public on that local origin.
The launch URL grants access to local installation operations: keep it private.
The browser strips the query token immediately, stores it in `sessionStorage`
(and memory), and never stores it in `localStorage`. A new server has a new token;
an old tab must open the newly printed URL.

Production assets are confined to their canonical asset directory, including
symlink checks. Responses disable caching, MIME sniffing and referrer forwarding;
the production CSP restricts scripts to the same origin via `default-src 'self'`
and connections via `connect-src 'self'`, permits inline styles with
`style-src 'self' 'unsafe-inline'`, and prohibits embedding. README content is rendered as text. The development launcher adds
Vite/HMR support on the same server, with exact Host/Origin checks on upgrades;
production server modules do not import Vite or use development CSP allowances.

Startup source resolution uses `resolveSource()` in `src/bundle/source.ts`,
which delegates HTTP discovery to `src/discovery/`. HTTP inputs require a
discovery document; the TUI and web UI have no legacy index fallback. Local
directories are supported. Direct Git inputs return
`DIRECT_SOURCE_UNSUPPORTED` in the browser; put Git/artefact sources inside a
discovery document to browse them. A direct ZIP URL is treated as a discovery
base URL and fails when the required document is absent; it does not return the
Git-specific conflict. See [discovery requirements](discovery.md).
The direct-source preview/install screen,
Rovo provisioning and CLI self-update controls are outside the current browser UI.

Project-exclusive membership filtering runs on the server. A membership lookup
failure produces an empty permitted catalogue, and a forged install request is
rejected. For repository scope, the server validates an explicit absolute Git
root (or the detected launch root), loads its pinned catalogue and validates the
candidate again before writing. There is no global `process.chdir`, and no
browser-supplied skill path or source pin is trusted. Repository selection can
target another existing Git root on the same machine; the launch directory is
not a filesystem sandbox.

The launch token is distinct from upstream OAuth access/refresh tokens. Upstream
credentials stay in the OS keychain or the private filesystem token store, never
in browser DTOs or event frames. Authorization URLs must be HTTPS, except HTTP
on localhost, 127.0.0.1 or ::1 for local providers, and may not contain embedded
credentials. The browser shows an explicit sign-in link instead of opening a
popup automatically. `AGENTMAN_ACCESS_TOKEN` is the headless bearer-token
override; it is not a replacement for the web session's interactive sign-in.

## Versions and cache provenance

Version labels alone do not establish source identity. Cache metadata records
HTTP content roots or local directory origins; opaque bundle IDs refer to a
cache location and its provenance, not a hash of all content bytes. Every mutation
resolves the ID again and checks current provenance. Remote download choices are
issued for a particular session revision and source, then checked again before
cache publication. Downloads do not select a global version.

| Source/cache | Browser version behavior |
| --- | --- |
| Verified flat directory bundle | Global catalogue selection with optional install synchronization; per-installation selection where compatible |
| HTTP discovery bundle, including named caches | Remote listing/download and per-installed-skill selection; global catalogue selection is unavailable |
| Git or artefact installation | Use the installed skill's Update action; bundle-version switching is unsupported |
| Legacy cache without verified origin | Selection requires adoption by comparison with freshly acquired content; unused entries can be removed via their removal IDs |

A moved directory can be adopted as an alias when its content matches the cached
version. Different content requires a distinct version or removal of an unused
cache. Cache deletion checks the current flat bundle, this server's live
catalogue, system installations and registered repository records. Missing
repositories/config files do not block deletion; unreadable or corrupt records
do. Equal version labels from known different sources remain distinct. References
from unregistered legacy repositories or manually created links cannot be found
globally; see [the provenance/reference details](web-ui-m1b.md).

Installed identity is `(installKey, toolId, scope, repoRoot?)`. Version changes
update `sourcePin` as well as compatibility fields and record the actual
symlink/copy method. Readers use `getRecordVersion()`; `.agentman.json` is local
machine state and must not be committed.

## Coordination, cancellation and shutdown

Filesystem/config changes share the cross-process mutation lease with TUI and
headless callers. Acquisition/authentication happen before the critical section;
read-only catalogue/version facades do not acquire it. The lock order is mutation
lease before config lock. When both the mutation lease and short session gate
are needed, take the lease first. Never wait for the lease, network or a whole
installation loop while holding the session gate. Await nested work rather than
detaching it from its owner.

The session gate serializes revision acceptance and publication. Accepted loads
invalidate previous selections immediately; only a current revision can publish
its catalogue or persist the selected source. Install candidates are captured
from permitted server-owned data and revalidated under the mutation lease.
Updates prepared outside the lease recheck their installed record before commit.
A bundle switch can finish filesystem work after a newer load was accepted;
its result reports `superseded: true` and cannot overwrite the newer catalogue.
Completed writes are not rolled back merely because the revision changed.

Leases have unique owner claims and heartbeats. Dead owners are reaped; expired
claims allow recovery after a crash or inaccessible/reused PID. TUI/headless signal
handlers release owned claims. The UI CLI drains work on its first signal so operations release their leases normally; the second signal
explicitly releases owned claims before forcing exit. SIGKILL recovery uses
reaping. This coordination is not a crash-recovery journal, and older CLI binaries do not participate. See
[the mutation implementation notes](web-ui-m1b.md) for renewal/expiry bounds and
reference checks. Synchronous HTTP mutations add a five-second acquisition bound
and discard disconnected waiters; acquired commits finish before closing their
response socket.

Jobs allow cancellation while queued or in authentication. A successful cancel
response waits for callback/token-exchange cleanup, including freeing callback
port 19875. Resolving, download and commit phases do not promise cancellation or
rollback. The UI uses `canCancel` to decide whether to show the action. The
process-wide auth coordinator serializes token work; it does not solve another
process holding the fixed callback port. Such contention returns an actionable
conflict without terminating the other login.

Sign-out advances the revision and blocks new auth, cancels or drains in-flight
load/login/update/download jobs, then deletes credentials for every auth identity
loaded by this server. Late token work cannot restore the signed-out session.
A cancelled initial login returns to idle so the user can retry.

Graceful shutdown rejects new API work, cancels queued/auth jobs (including jobs
that enter auth after shutdown starts), drains accepted non-abortable work, emits
final job states, closes SSE and then closes HTTP. The embeddable server's `stop()`
is asynchronous and idempotent; it never calls `process.exit`. The CLI owns signal
handling. A second CLI signal forces exit and may leave an interrupted operation;
it is not successful cancellation.

SSE connections begin with an authoritative session/job snapshot, without a gap
between registration and snapshot emission. The client reconciles from that
snapshot on every reconnect, including jobs completed while disconnected. There
is no event replay or persistent job history. Slow clients are disconnected and
can reconnect; evicted results require a resource refresh. See the
[API jobs/events reference](web-ui-api.md#jobs-and-events) for bounds and payloads.

## Adding a route or DTO

1. Put renderer-independent behavior in `src/operations/` (or an existing shared
   core module). UI routes must not call Ink components. Keep source resolution
   in `src/bundle/source.ts` and its discovery helpers in `src/discovery/`;
   extend the underlying bundle source model as needed.
2. Add browser-safe interfaces/types to `src/ui-server/api-types.ts` and explicitly
   map internal data in a DTO serializer. That module contains types only; its
   allowed imports are type-only imports from the pure scope/discovery types.
   The browser imports with `import type { ... } from '@api-types'`, never server
   runtime modules or Node APIs. `npm run typecheck` checks this boundary.
3. Register the handler in `src/ui-server/routes/` and wire it in `index.ts`.
   Validate unknown JSON at runtime with `readJsonBody`, `v.object` and field
   validators; whitelist query fields with `v.query`. A TypeScript cast is not
   validation. Resolve IDs, roots and permitted candidates from server-owned
   state; never turn a client path or version label directly into a cache path.
4. For short synchronous filesystem changes, use `requestMutation` so lock
   contention/disconnection cannot cause a delayed write. For long work, return
   a job ID with HTTP 202, report truthful phases, forward auth prompts/signals
   through `ctx.auth`, and revalidate revisions/identities at commit. Do not hold
   the mutation lease during network acquisition or start interactive auth from
   a GET handler. Guard token-producing jobs against sign-out.
5. Return selected DTO fields with `sendJson`; throw known validation/conflict
   errors for `serialiseError` to sanitize. Do not send stacks, credentials,
   internal auth objects or raw upstream error bodies. Keep the
   [route table](web-ui-api.md#routes) and job-result contract current.
6. Use the shared browser API/job/SSE helpers and show errors, partial failures
   and superseded results. Add focused server tests for authorization, malformed
   input, stale revisions and the affected mutation invariant. Add browser tests
   when behavior crosses controls, HTTP and persisted state. Use isolated test
   homes and owned listeners; see the [test guide](../tests/e2e/README.md).

## Validation

```bash
npm ci
npm ci --prefix web-ui
npm run build:web-ui
npm run build
npm run typecheck
npm run typecheck:integration
npm run lint
npm test
npm run test:web-ui
npx --no-install playwright install --with-deps chromium
npm run test:e2e
```

Root tests cover real HTTP requests, source/repository identity, job/SSE races,
auth coordination, CLI startup/shutdown, and development-origin guards. The
component suite checks bootstrap, stream decoding/reconnection and screen behavior.
The Playwright suite drives real production and development UIs, verifies
filesystem/config outcomes, and tests delayed event attachment and reconnection.
A self-contained local provider exercises OAuth PKCE, cancellation/retry, membership
failure/recovery and logout without a real account or keychain. A packaged-consumer
test runs the npm pack lifecycle, installs the tarball outside the checkout with
optional dependencies omitted and private npm cache/config paths, and repeats the
browser install/remove workflow. CLI children intercept OS browser-launch commands
and fail if `--no-open` is ignored. Browser actions/navigation have 15-second
limits; fixture teardown is bounded, restores HOME and retries busy-file removal.
The auth fixture probes the fixed callback port before starting a flow.

The Ubuntu/Windows CI matrix runs these suites and retains failure screenshots,
traces and HTML reports. See [the test guide](../tests/e2e/README.md) for test
boundaries, browser setup, temporary-state isolation and focused commands. Root
auth tests and browser OAuth tests run sequentially because callback port 19875 is
fixed. Browser binaries stay in the development/CI cache.

The repository's Imposter provider remains additional coverage:

From `mocks/`, run `imposter up`. In a separate terminal at the repository root,
after building the UI and installing Chromium, run:

```bash
npm run test:browser:auth
```

This smoke uses the synthetic account configured in `mocks/oidc-server-config.yaml`
and temporary filesystem token storage. The integration workflow also starts the
built CLI against Imposter on an ephemeral port and allows 30 seconds for a
ready, non-empty catalogue before shutdown.
