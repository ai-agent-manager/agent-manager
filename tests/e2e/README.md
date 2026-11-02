# UI integration and browser tests

The suites have separate discovery rules:

| Command | Runner and scope |
| --- | --- |
| `npm test` | All root Vitest tests: `tests/**/*.test.ts` and `.test.tsx` |
| `npm run test:unit` | Existing `tests/unit/` suite, including legacy HTTP/core integration cases |
| `npm run test:integration` | `tests/integration/**/*.test.ts`: real HTTP, SSE, files and install records |
| `npm run test:e2e` | Playwright `tests/browser/**/*.spec.ts`, including installed-tarball testing |
| `npm run test:e2e:pack` | Only the installed-tarball browser test |
| `npm run test:web-ui` | Browser component tests with jsdom in `web-ui/` |

`npm test` retains the original coverage and includes new HTTP integration tests.
Playwright specs never enter Vitest discovery. There is no TUI-driving end-to-end
suite in this directory; the existing Ink component tests remain in `tests/unit/`.

## Local setup

Use Node from `.nvmrc`, then:

```sh
npm ci
npm ci --prefix web-ui
npx --no-install playwright install --with-deps chromium
npm run build:web-ui
npm run build
npm run typecheck:integration
npm run test:integration
npm run test:e2e
```

Run the commands sequentially. The OAuth callback uses fixed port 19875, so do not
run root auth tests or another agentman login alongside the browser suite. The
auth fixture probes that port first and reports a collision with a retry remedy. The
browser runner uses one worker and no retries. Its application/provider servers
use ephemeral loopback ports. The development test occupies its own configured
default port and verifies fallback, API/SSE origin and a visible HMR edit in a
copied UI source tree, leaving the checkout unchanged.

The browser suite uses built production assets and real APIs. It installs,
inspects, switches and removes skills through controls, verifying files and
persisted pins. Reconnection tests delay or disconnect real event streams and
finish real mutations before allowing the browser to reconnect. A self-contained
fake provider validates the authorization-code/PKCE exchange; the tests exercise
cancel/retry, callback-port cleanup, membership failure/recovery and sign-out.
They require neither Imposter nor a real account/keychain. Each test owns a
temporary HOME/USERPROFILE and repository; ambient auth/provider overrides are
removed and restored. Telemetry and startup checks are disabled.

The packaged test copies build outputs into a staging directory, runs the real
`npm pack` lifecycle there, and installs the tarball into a separate temporary
consumer with optional dependencies omitted. It launches that installed CLI from
the consumer directory and repeats the browser install/remove workflow. Registry
access is needed for this install. Both npm commands receive private cache,
user-config and global-config paths; inherited `npm_config_*` values are removed. The fixture and
consumer directories are distinct from the source checkout. Browser binaries are
provided by the test runner (Chromium may write font/shader caches inside the
temporary HOME); the consumer has no Playwright installed. The CLI's
normal installation includes the optional Playwright dependency for Rovo
provisioning; this `--omit=optional` consumer deliberately does not.
Every CLI child preloads a guard for the current `execFile` browser-launch
commands on Linux, macOS and Windows. A matching launch attempt fails teardown
without opening a tab or recording the bootstrap URL. If launch code changes to
`spawn` or another library, extend the guard to cover that boundary too.
The Vitest integration harness includes a negative control that removes
`--no-open` before real CLI parsing; it proves guard detection, not flag handling.
The packaged browser spec and Imposter CLI smoke detect a real regression that
ignores `--no-open`.

CI's Ubuntu/Windows verify matrix runs the root, component and browser suites,
including tarball installation. Cross-process mutation tests remain required as
part of `npm test`. Publishing continues to depend on this verify job.

## Diagnostics and focused runs

```sh
npm run test:e2e -- auth.spec.ts
npm run test:e2e -- reconnect.spec.ts
npx --no-install playwright show-report
npx --no-install playwright show-trace test-results/browser/<failed-test>/trace.zip
```

Browser actions and navigation have 15-second timeouts. Fixture setup/teardown
has its own 15-second budget; server shutdown forces owned sockets/listeners
closed after five seconds, while CLI cleanup also bounds the forced-exit wait.
Sandbox cleanup restores HOME before deleting files and retries transient busy
files five times at 200-millisecond intervals. Register resource release with the
`cleanup` fixture immediately after acquiring it. It releases resources in reverse
order, attempts all releases and reports cleanup failures separately from the
primary assertion. Do not stop fixture-owned servers in a spec-level `finally`;
a thrown shutdown error there can replace the original assertion.

Use `npm run test:e2e` or `npx --no-install playwright test --config playwright.config.ts`
so npm supplies `npm_execpath` for the packaged spec. Invoking Playwright directly
without that environment fails the packaged spec with a setup diagnostic.

Failures retain screenshots and traces under `test-results/`; HTML reports are
in `playwright-report/`. CI uploads both on failure for seven days. Traces contain
only temporary local sessions and synthetic provider credentials; cleanup stops
those servers. Follow the [Playwright CI guide](https://playwright.dev/docs/ci-intro)
for installing browsers and inspecting reports.

The older `npm run test:browser:smoke` (optionally `-- --dev`) remains a quick
standalone check. `npm run test:browser:auth` is the additional OAuth smoke against
an already running repository Imposter mock on port 8080. Neither replaces
`test:e2e` in CI. `tests/integration/mock-ui-smoke.ts` separately launches the
built CLI against Imposter on an ephemeral UI port, allows 30 seconds for a ready
non-empty catalogue and shuts down;
`integration.yml` exports the synthetic CI token; the smoke script writes it to
its temporary filesystem token cache. A test-only Node preload disables the keychain in the built
CLI process; no interactive login or real credentials are needed.
