# Bundle Format

Agent Manager expects your bundle server to expose two endpoints:

- `<base-url>/agents/index.json` — version index listing available bundles
- `<base-url>/agents/<version>/bundle.zip` — the versioned bundle zip

## Zip contents

Each zip contains:

- **`manifest.json`** — Bundle metadata: `version` (semver) and `published` (ISO date)
- **Skill directories** — Each with a `SKILL.md` per the [agentskills.io specification](https://agentskills.io/specification), plus optional `scripts/`, `references/`, and `assets/` subdirectories
- **Rovo agent directories** — Each with a `rovo-agent.yaml` for Playwright automation
- **`README.md` frontmatter** — Optional `name`, `description`, and `tags[]` for display in the TUI
