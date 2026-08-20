# Bundle Format

Agent Manager expects an index and version directories under a source's
**content root** — the `url` its discovery entry declares:

- `<content-root>/index.json` — version index listing available bundles
- `<content-root>/<version>/bundle.zip` — the versioned bundle zip
- `<content-root>/<version>/bundle.zip.sha256` — optional integrity sidecar

The client appends nothing else, so a source may publish at any path.

## Zip contents

Each zip contains:

- **`manifest.json`** — Bundle metadata: `version` (semver) and `published` (ISO date)
- **Skill directories** — Each with a `SKILL.md` per the [agentskills.io specification](https://agentskills.io/specification), plus optional `scripts/`, `references/`, and `assets/` subdirectories
- **Rovo agent directories** — Each with a `rovo-agent.yaml` for Playwright automation
- **`README.md` frontmatter** — Optional `name`, `description`, and `tags[]` for display in the TUI
