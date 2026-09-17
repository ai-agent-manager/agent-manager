# Desktop application

The M8 Electron shell runs the existing web UI and local API in one desktop
application. It adds a native repository picker, single-instance activation and
installer packaging. Source resolution, authentication, membership checks, jobs,
version validation and mutation leases remain in the CLI's shared core.

## Run from a checkout

Use Node from `.nvmrc`. From the repository root:

```sh
npm ci
npm ci --prefix web-ui
npm run build:web-ui
npm run build
npm ci --prefix desktop
npm start --prefix desktop
```

The desktop application starts its server on an ephemeral `127.0.0.1` port, uses
the user's home as its initial directory and loads saved sources. Use Sources to
select a catalogue. To load a fixture during development, set
`AGENTMAN_DESKTOP_SOURCE` to an absolute directory path or a discovery URL before
starting. Packaged applications ignore this development override.

Repository controls offer Browse in the desktop app; browser tabs retain their
text fields. A selected directory is still validated by the server as an existing
Git root. On the installation screen, choose Repository and load its catalogue
before installing, so the preview respects repository pins.

A second launch focuses the existing window; its command-line URLs/arguments are
not consumed. Closing the window, Quit, and the OS quit command drain accepted
work before exiting, including a quit requested during startup. While draining,
the window title shows that operations are finishing. Startup
failures log their cause and exit non-zero after cleanup. There is no
background tray mode. OAuth opens in the system browser and returns through the
existing fixed callback port 19875. Other agentman login processes can still
occupy that port.

## Trust boundaries

The window explicitly disables Node integration (including subframes/workers),
uses context isolation and a sandbox, retains web security and disables webviews.
Its session is in memory, all permission requests/checks are denied, and downloads
are denied. Production disables developer tools. API access still uses the
per-launch token and exact Host/Origin checks from [the web UI](web-ui.md).

Navigation and redirects are restricted to the exact local origin; child-frame
navigation is denied. Chromium can commit `about:blank` without a cancellable
navigation event; a post-navigation check restores the app automatically. The
preload grants no capabilities to that temporary blank document. Every popup is
denied as an Electron window. Only two classes of
validated destinations may instead reach `shell.openExternal`:

- The exact authorization URL of a currently running, non-cancelled auth job,
  obtained from the server's in-process `isActiveAuthorizationUrl` check. Changing
  a query parameter or using a completed job's URL removes authorization.
- An individually listed HTTPS documentation URL in `desktop/src/security.ts`.
  There are no host wildcards or arbitrary renderer-provided URL-opening IPCs.

Credentials in URLs, fragments and non-HTTPS schemes are rejected. The sole HTTP
exception requires both an unpackaged app and
`AGENTMAN_DESKTOP_ALLOW_LOOPBACK_AUTH=1`; it permits an active prompt on localhost,
127.0.0.1 or ::1 for mock-provider development. Packaged apps always require HTTPS.
File, data, JavaScript and custom-protocol destinations never reach the OS handler.

The sandbox-compatible CommonJS preload exposes only
`window.agentmanDesktop = {pickDirectory(), version}` on the expected main-frame
origin. It exposes no generic IPC or filesystem API. The main-process picker
handler checks the sender WebContents, exact main frame, origin and zero-argument
shape before displaying a dialog, then rechecks the sender before returning its
result. Concurrent picker requests are rejected. The server, not the dialog,
remains responsible for validating the selected repository.

These choices follow Electron's [security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
and [sandboxed preload requirements](https://www.electronjs.org/docs/latest/tutorial/esm#sandboxed-preload-scripts-cant-use-esm-imports).
The telemetry decision is to retain the shared core's existing behavior. Normal
GUI launches have undefined TTY flags, which do not disable telemetry: it is on
when a discovery document/environment supplies an endpoint and site ID, unless
disabled in Settings, through environment flags or by CI detection. See
[telemetry](telemetry.md) for event coverage and opt-out controls. The shell adds
no new events or automatic update client. Auto-update is deferred.

## Build installers

After building the root CLI and web assets:

```sh
npm run dist --prefix desktop
```

Run this on macOS for a DMG and Windows for an NSIS installer. The Windows
installer offers an installation directory and creates desktop/Start Menu
shortcuts. Builds target the runner's architecture unless a builder architecture
flag is supplied. For an unpacked application on the current platform:

```sh
npm run dist --prefix desktop -- --dir
```

Outputs are in `desktop/release/`; generated icons and staging files are in
`desktop/build/`. Both are gitignored. The source icon is
`desktop/assets/icon.svg`, matching the UI's letter mark; the build renders a
1024px PNG because the old `assets/icon.png` is only 128px.

Development links `@ai-agent-manager/cli` with `file:..`. Packaging creates an
isolated production dependency tree from a staged CLI tarball; it never runs the
root pack hooks in the checkout or bundles the linked checkout's dev dependencies.
Production assets and schemas come from the built CLI. The stage uses private
npm cache/config files and uses the public npm registry; ambient npm configuration
and corporate mirrors are deliberately not inherited. The packaged desktop
version is taken from the installed CLI; a root-only `npm version` bump is enough.
Release CI pins the exact CLI version already published for the tag, waiting up
to three minutes for registry propagation before installing it.

The production dependency tree resolves the CLI's dependency ranges at package
time, as a global npm installation does; it has no production lockfile. The desktop
lockfile pins development/build tools. Updating the release CLI pin preserves that
lockfile's resolutions for unchanged tooling. Root `npm ci` is also required for
tests, which resolve Playwright and tsx from the root development environment.

`electron-builder.yml` enables ASAR and unpacks `@napi-rs/keyring*` native bindings.
The bindings use Node-API, so no Electron ABI rebuild is requested. Playwright and
its browser tooling are excluded from the desktop payload; Rovo browser automation
is not a desktop feature. `node_modules` contains only the production application
dependencies in the staged app.

The [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) disable
run-as-Node, Node environment options, Node inspector arguments and extra file
protocol privileges. They require loading the app from ASAR and enable embedded
ASAR integrity validation on supported platforms (macOS/Windows). The test does
not require leaving the main-process inspector enabled. Disabling Node environment
options also disables `NODE_EXTRA_CA_CERTS`; packaged desktop deployments cannot
use that variable to add custom certificate authorities.

## Signing and CI

[desktop.yml](../.github/workflows/desktop.yml) builds on macOS and Windows. The
main CI calls it after the stable GitHub Release job completes; this avoids
relying on a release event created with `GITHUB_TOKEN` to trigger another workflow.
It can also be dispatched manually. The build always uses `--publish never`;
a separate job attaches installers, blockmaps and generated `latest*.yml` metadata
to an existing stable release. Manual branch builds produce CI artifacts only.
The metadata does not enable runtime auto-update.

| Credentials | Use |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS signing identity |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization when the macOS signing identity is also supplied |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows signing identity, mapped to the builder's signing environment on Windows |

Without signing credentials the workflow still builds installers and disables
certificate auto-discovery. macOS enables hardened runtime; notarization is enabled
only when its required credentials are present. The reusable workflow receives
only the seven listed signing/notarization secrets. The macOS runner currently
produces arm64 installers; Intel macOS and Linux installers are not provided.
Recent macOS versions may label unsigned downloads as damaged and require an
explicit override in System Settings. Platform signing and installer behavior require
native macOS/Windows verification; an unpacked Linux build cannot establish them.

## Tests

```sh
npm run typecheck:tests --prefix desktop
npm test --prefix desktop
npm run test:web-ui
npm run test:smoke --prefix desktop
```

Build the root and desktop packages and web assets first. On headless Linux use
`xvfb-run --auto-servernum npm run test:smoke --prefix desktop`. The normal display
backend is required; Electron's headless Ozone backend is not used. Tests keep
Chromium's sandbox enabled. Linux needs working unprivileged user namespaces or
a correctly owned SUID sandbox helper; CI sets the helper's owner to root and mode
4755 in each isolated runner. Do not work around startup failures with
`--no-sandbox`. On a desktop,
the smoke displays test windows. Run it separately from other OAuth suites because
callback port 19875 is fixed.

The smoke owns a temporary HOME, Git repo and Electron user-data directory. It
intercepts native dialog results and OS browser launches and disables the keychain
in a test-only entry point. The production app has no test IPC or keychain bypass.
It drives the real renderer, API and filesystem, verifies native picker IPC and
repository pins, rejects forged/stale authorization links, completes local OAuth
PKCE, checks second-launch reuse, and quits while a cross-process mutation lease
is held. The pending installation must finish before Electron exits.

Unit tests cover protocol/host/query restrictions, IPC sender/frame/argument
validation and shutdown during initialization. Component tests cover browser
fallback, picker cancellation/failure and avoiding form submission. Root job tests
cover prompt cancellation, successful completion and server stop. Failure screenshots are retained in
`desktop/test-results/`. The normal verify matrix runs these checks; the desktop
release matrix also builds native installers.

Linux verification additionally builds and launches the real unpacked ASAR
application, loads a saved directory source and installs a skill. Run it after
`npm run dist --prefix desktop -- --linux --dir` with
`xvfb-run --auto-servernum npm run test:packaged --prefix desktop`.
This check uses temporary HOME, XDG config and Electron user-data directories;
it does not exercise authentication or access the keychain. It launches the
production executable directly and attaches through a temporary Chromium debug
transport; Node inspector support stays disabled. It reads the binary's fuse
settings and checks Linux renderer seccomp, no-new-privileges and capabilities.
The development smoke also checks the renderer's Linux sandbox state and waits
for the main-process navigation cancellation event before asserting confinement.
