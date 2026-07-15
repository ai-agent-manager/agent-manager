---
name: project-pr31-always-namespace
description: PR #31 always-namespace install layout — merge conflict resolution + rework on feat/namespaced-install-layout; state as of 2026-07-15
metadata:
  type: project
---

## Status (2026-07-15)
All conflict resolution and always-namespace rework is **implemented and verified** but NOT yet staged (`git add`) or committed. User must confirm before staging.

**Why:** CLAUDE.md says "Never commit, push, or create PRs" and the task instructions said "DO NOT `git add`/`git commit` until I confirm."

## What was done
All 19 conflicted files are resolved. tsc clean, build clean, 604 tests passing.

### Bucket A — took theirs wholesale (14 files)
README.md, src/cli.ts, src/index.tsx, src/telemetry.ts, src/config/paths.ts,
src/components/SkillVersionManager.tsx, src/headless.ts, src/bundle/artefact-downloader.ts,
src/bundle/artefact-scanner.ts, tests/unit/bundle/artefact-downloader.test.ts,
tests/unit/bundle/artefact-scanner.test.ts, tests/unit/bundle/repo-downloader.test.ts,
tests/unit/headless.test.ts, tests/unit/provisioners/skill-provisioner-repo.test.ts

### Bucket B — reconciled (5 files)
- **src/bundle/cache.ts** — theirs + added `linkName?: string` to `InstallRecord`
- **src/bundle/repo-config.ts** — theirs + added `linkName?: string` to `RepoInstallRecord`
- **src/bundle/skill-source.ts** — theirs + appended 6 namespace helpers (sanitiseNamespaceSegment, deriveRepoNamespace, deriveArtefactNamespace, deriveInstallNamespace, buildInstallKey, flattenNamespace)
- **src/provisioners/SkillProvisioner.ts** — theirs as base; replaced install/getInstalled/uninstall with always-namespace logic; deleted pickLinkName() and collision-detection branch; kept resolveInstallKey() for bare-name disambiguation
- **tests/unit/bundle/skill-source.test.ts** — theirs + appended namespace test suites

### Net-new edits (non-conflicted files also changed)
- **src/discovery/resolver.ts** — added sourcePin tags to http and git branches
- **src/headless.ts** — re-keyed availableSkills Map on qualified identity; added disambiguation matching loop
- **tests/unit/provisioners/skill-provisioner-namespaced.test.ts** — fully rewritten from Variant B (collision-conditional) to always-namespace assertions
- **tests/unit/bundle/cache.test.ts** — updated one test assertion to match main's silent-fallback readConfig behavior

## Key design decisions applied
- flattenNamespace maps BOTH `/` and `.` to `-` (e.g. github.com/org/repo → github-com-org-repo)
- Link name: `${flattenNamespace(namespace)}__${skillId}` — always, no collision check
- Namespace includes hostname for repo sources (GHES discrimination)
- Legacy flat installs (no sourcePin/linkName) use bare skillId, unchanged

## Next step
User needs to say "go ahead and stage" (or equivalent), then:
```
git add README.md src/bundle/artefact-downloader.ts src/bundle/artefact-scanner.ts \
  src/bundle/cache.ts src/bundle/repo-config.ts src/bundle/skill-source.ts \
  src/cli.ts src/components/SkillVersionManager.tsx src/config/paths.ts \
  src/headless.ts src/index.tsx src/provisioners/SkillProvisioner.ts \
  src/telemetry.ts tests/unit/bundle/artefact-downloader.test.ts \
  tests/unit/bundle/artefact-scanner.test.ts tests/unit/bundle/repo-downloader.test.ts \
  tests/unit/bundle/skill-source.test.ts tests/unit/headless.test.ts \
  tests/unit/provisioners/skill-provisioner-repo.test.ts \
  src/discovery/resolver.ts \
  tests/unit/provisioners/skill-provisioner-namespaced.test.ts \
  tests/unit/bundle/cache.test.ts
```
Then commit as the merge commit with message:
`fix(install): always-namespace skill link names for multi-source installs`

**Why:** How to apply: recall this before starting any session on this branch so you don't re-do the work or lose context on the staging gate.
