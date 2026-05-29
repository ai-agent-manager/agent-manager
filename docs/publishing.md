# Publishing

CI handles publishing automatically when a version tag is pushed. The version in `package.json` is derived from the tag — no manual bumps needed.

| Tag pattern | Registry | Dist-tag |
|-------------|----------|----------|
| `v*.*.*` | npmjs.org | `latest` |
| `v*.*.*-*` | GitHub Packages | `beta` |

```bash
git tag v1.3.0 && git push origin v1.3.0         # stable
git tag v1.3.0-beta.0 && git push origin v1.3.0-beta.0  # beta
```

Published to: [npmjs.com/package/@ai-agent-manager/cli](https://www.npmjs.com/package/@ai-agent-manager/cli)

## Required secrets

| Secret | Purpose |
|--------|---------|
| `NPM_TOKEN` | Automation token with publish access to the `@ai-agent-manager` org on npmjs.org |

The GitHub Packages beta publish uses the built-in `GITHUB_TOKEN` — no extra secret needed.

## Manual publish

```bash
npm login
npm version 1.3.0 --no-git-tag-version
npm publish
```

`prepublishOnly` runs typecheck, tests, and a clean build automatically.

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
