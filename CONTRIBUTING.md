# Contributing

Contributions are welcome. This document covers the practical bits.

## Prerequisites

- Node.js 22.12 or higher (use [nvm](https://github.com/nvm-sh/nvm): `nvm use`)
- npm (bundled with Node)

## Setup

```bash
git clone https://github.com/ai-agent-manager/agent-manager.git
cd agent-manager
npm ci
```

## Development workflow

```bash
npm run dev -- https://your-bundle-server.com  # run locally
npm run typecheck                               # type check
npm test                                        # run tests once
npm run test:watch                              # watch mode
npm run build                                   # compile to dist/
```

## Browser UI development and boundaries

```bash
npm ci --prefix web-ui
npm run dev:ui -- tests/fixtures/valid-bundle --no-open
```

For production serving, run `npm run build:web-ui`, then
`npm run preview:ui -- tests/fixtures/valid-bundle --port 0`. Compile the CLI
separately with `npm run build` when testing `node dist/index.js ui ...`.
See [the web UI guide](docs/web-ui.md) and [API reference](docs/web-ui-api.md)
for launch/security contracts and instructions for adding routes and DTOs.

- Browser/TUI/headless orchestration belongs in `src/operations/`; browser routes
  must not call `src/components/` or import Ink. `src/ui-server/` is embeddable and
  must never call `process.exit`; `src/ui-command.ts` owns CLI lifetime policy.
- Startup source resolution enters through `src/bundle/source.ts` and delegates HTTP discovery to `src/discovery/`. Extend source types in
  `src/bundle/skill-source.ts` instead of creating another resolver.
- `web-ui/` has its own package/lockfile. Its only server-source imports are
  type-only `@api-types` imports. `src/ui-server/api-types.ts` contains types only,
  never runtime helpers, credentials or server objects. `npm run typecheck`
  enforces the import boundary; routes also need runtime input validation.
- `dist/`, `web-ui/dist/` and `assets/web-ui/` are generated. Rebuild them instead
  of editing or committing output. `.agentman.json` is machine-specific runtime
  state and must stay gitignored. Read installed versions with `getRecordVersion()`.
- Mutations take the shared lease before a config lock or a short session gate.
  Acquire/authenticate outside mutation critical sections; await nested work.
  Recheck identities/revisions before commit. See [mutation rules](docs/web-ui.md#coordination-cancellation-and-shutdown).
- The OAuth callback uses fixed port 19875; the extension bridge uses 19876;
  browser serving defaults to 19877 with fallback. The `desktop/` Electron package
  reuses the local server; see [desktop development/testing](docs/desktop.md).
- `npm pack` swaps in `scripts/README.npm.md`. Update both READMEs when launch
  instructions change, and build CLI/browser assets before packing.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <short description>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`

- Use imperative mood: `add flux capacitor`, not `added flux capacitor`
- No full stop at the end of the subject line
- Keep the subject under 72 characters
- Include a body only when the _why_ isn't obvious from the subject

**Examples:**

```
feat: add cursor repo-scoped install path
fix: handle missing manifest.json gracefully
docs: update bundle format specification
ci: pin Node version in publish workflow
```

## Branches

Branch names should reflect the change type and a short slug:

```
feat/repo-scoped-cursor
fix/missing-manifest
docs/contributing-guide
```

Target `main` for all PRs.

## Pull requests

- Keep PRs focused — one logical change per PR
- PR titles follow the same Conventional Commits format as commit messages
- There is no required template, but include enough context for a reviewer to understand _why_ the change exists, not just _what_ changed
- All CI checks (typecheck, tests, build) must pass before merge

## Tests

Root tests use Vitest; browser end-to-end specs use Playwright and separate
discovery rules. Add focused tests for behavior changes; documentation-only edits
need command/link checks rather than new runtime tests.

| Command | Scope |
| --- | --- |
| `npm test` | All root Vitest tests, including HTTP integration and cross-process mutation tests |
| `npm run test:unit` | Existing `tests/unit/` suite |
| `npm run test:integration` | Real HTTP/SSE, filesystem and test-harness regressions |
| `npm run test:web-ui` | Browser component tests in `web-ui/` |
| `npm run test:e2e` | Production/dev browser flows, OAuth/reconnection and installed tarball |
| `npm run test:e2e:pack` | Installed tarball browser test only |
| `npm run typecheck:integration` | Integration/browser/support TypeScript |

Follow [the test setup guide](tests/e2e/README.md) for asset builds, pinned Chromium
installation and focused runs. Root auth tests and browser OAuth tests must run
sequentially because they share callback port 19875. Use temporary HOME/repository
fixtures and owned servers, never real user state or keychain credentials.
Pack/install test children use private npm config/cache paths, and CLI children
fail if they attempt an OS browser launch despite `--no-open`. The tarball test
needs registry access; tests must run through the documented `npm run` commands.

Browser actions and navigation have 15-second timeouts, and fixtures have bounded
teardown with forced connection cleanup and busy-file retries. Preserve those
bounds when adding a fixture so HOME restoration still runs after failure.
Ubuntu/Windows CI runs the root, component and browser suites and retains failure
traces/screenshots. `prepublishOnly` builds the UI, runs root typecheck/tests and
compiles the CLI; it does not replace CI's component/browser checks.

## Reporting issues

Open a GitHub issue. Include:

- What you were doing
- What you expected to happen
- What actually happened
- Node version (`node --version`) and OS
