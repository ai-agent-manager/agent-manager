# Git Skill Importer — Example

This example demonstrates the git skill importer, which clones a git
repository and discovers skills in the Claude Code plugin marketplace
layout (`skills/<name>/SKILL.md`).

## Prerequisites

- Node.js (same version as the main project)
- Git

## Steps

### 1. Create a test plugin repo

The `create-test-repo.sh` script sets up a local git repository with
two skills in the standard marketplace layout:

```bash
./create-test-repo.sh
```

This creates a repo at `/tmp/test-plugin` with the following structure:

```
/tmp/test-plugin/
└── skills/
    ├── code-review/
    │   └── SKILL.md
    └── refactor/
        └── SKILL.md
```

You can pass a different path if you prefer:

```bash
./create-test-repo.sh /tmp/my-plugin
```

### 2. Run the importer

From the **project root** (`agent-manager/`):

```bash
npx tsx examples/git-skill-importer/test-git-import.ts
```

You can also point it at a different repo URL:

```bash
npx tsx examples/git-skill-importer/test-git-import.ts file:///tmp/my-plugin
```

Expected output:

```
Skills found: 2
  - code-review: Review code for quality issues
  - refactor: Refactor code for clarity
Clone path: /Users/<you>/.agentman/git-cache/test-plugin
```

### 3. Clean up

```bash
rm -rf /tmp/test-plugin ~/.agentman/git-cache/test-plugin
```
