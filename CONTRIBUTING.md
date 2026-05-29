# Contributing

Contributions are welcome. This document covers the practical bits.

## Prerequisites

- Node.js 22 (use [nvm](https://github.com/nvm-sh/nvm): `nvm use`)
- npm (bundled with Node)

## Setup

```bash
git clone https://github.com/ai-agent-manager/agent-manager.git
cd agent-manager
npm install
```

## Development workflow

```bash
npm run dev -- https://your-bundle-server.com  # run locally
npm run typecheck                               # type check
npm test                                        # run tests once
npm run test:watch                              # watch mode
npm run build                                   # compile to dist/
```

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

Tests live in `tests/` and use [Vitest](https://vitest.dev/). Add or update tests for any behaviour change. The `prepublishOnly` hook runs typecheck, tests, and a build — if it wouldn't pass that, the PR isn't ready.

## Reporting issues

Open a GitHub issue. Include:

- What you were doing
- What you expected to happen
- What actually happened
- Node version (`node --version`) and OS
