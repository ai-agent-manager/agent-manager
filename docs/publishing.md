# Publishing

CI handles publishing automatically when a version tag is pushed.

| Tag pattern | Registry | Dist-tag | GitHub Release |
|-------------|----------|----------|----------------|
| `v*.*.*` | npmjs.org | `latest` | Yes — created automatically |
| `v*.*.*-*` | GitHub Packages | `beta` | No |

Published to: [npmjs.com/package/@ai-agent-manager/cli](https://www.npmjs.com/package/@ai-agent-manager/cli)

## Release process

```bash
npm test
npm version minor   # or patch
git push origin main --tags
```

CI will publish to npmjs.org, then automatically create a GitHub Release with an npm install link and a changelog generated from commits since the previous stable tag.

Monitor the CI jobs to confirm both the npm publish and GitHub Release succeed.

## Builds and verification

The [CI workflow](../.github/workflows/ci.yml) requires Ubuntu/Windows verification
and the Git importer smoke before either registry publish job. Verification builds
and tests the web UI, runs root and integration typechecks, root tests, the CLI
build and Playwright browser/tarball tests. npm cache keys include both root and
`web-ui/package-lock.json` lockfiles.

Both publish jobs install `web-ui/` dependencies, run `npm run build:web-ui`, build
the Chrome extension and compile the CLI. `prepublishOnly` also installs/builds
the web UI, runs root typecheck/tests and compiles the CLI. It does not replace
CI's component/browser tests. `assets/web-ui/` is generated and included in the
published package.

For a local tarball, build first: `npm run build:web-ui` (after installing
`web-ui/` dependencies) and `npm run build`, then `npm pack`. Packing alone does
not run `prepublishOnly` or create missing output. The pack hooks swap in
`scripts/README.npm.md` and restore the repository README afterward.

## Publishing authentication and secrets

| Secret | Purpose |
|--------|---------|
| `AGENTMAN_CRX_KEY` | Base64-encoded PEM private key for signing the Chrome extension `.crx` |

The npm publish job uses trusted publishing: it grants `id-token: write`, installs
npm 11.9.0 and runs `npm publish --access public` without an `NPM_TOKEN` secret.
This describes the configured CI path; a local manual publish needs its own npm
authentication. The GitHub Packages beta job uses the built-in `GITHUB_TOKEN`
through `NODE_AUTH_TOKEN` with `packages: write`; no separate registry secret is
configured.

## Beta / Prerelease Builds

Beta builds require authentication with GitHub Packages.

1. Create a GitHub PAT (classic) with `read:packages` at <https://github.com/settings/tokens>.

2. Add to `~/.npmrc`:
   ```
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
   ```

3. Add to `.npmrc` in your project (or home directory):
   ```
   @ai-agent-manager:registry=https://npm.pkg.github.com/
   ```

4. Run:
   ```bash
   npx @ai-agent-manager/cli@beta https://your-bundle-server.com
   ```
   Or pin to a version:
   ```bash
   npx @ai-agent-manager/cli@0.1.0-beta https://your-bundle-server.com
   ```
