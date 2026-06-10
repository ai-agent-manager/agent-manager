# Publishing

CI handles publishing automatically when a version tag is pushed.

| Tag pattern | Registry | Dist-tag |
|-------------|----------|----------|
| `v*.*.*` | npmjs.org | `latest` |
| `v*.*.*-*` | GitHub Packages | `beta` |

Published to: [npmjs.com/package/@ai-agent-manager/cli](https://www.npmjs.com/package/@ai-agent-manager/cli)

## Release process

```bash
npm test
npm version minor   # or patch
git push origin main --tags
```

Then monitor the CI release job to confirm publish succeeds.

## Required secrets

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | Automation token with publish access to the `@ai-agent-manager` org on npmjs.org |
| `AGENTMAN_CRX_KEY` | Base64-encoded PEM private key for signing the Chrome extension `.crx` |

The GitHub Packages beta publish uses the built-in `GITHUB_TOKEN` — no extra secret needed.

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
   npx -y @ai-agent-manager/cli@beta https://your-bundle-server.com
   ```
   Or pin to a version:
   ```bash
   npx -y @ai-agent-manager/cli@0.1.0-beta https://your-bundle-server.com
   ```
