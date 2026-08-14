# Bundle Format

Agent Manager expects an index and version directories relative to that index:

- `<index-directory>/index.json` — version index listing available bundles
- `<index-directory>/<version>/bundle.zip` — the versioned bundle zip
- `<index-directory>/<version>/bundle.zip.sha256` — optional integrity sidecar

Discovery documents should provide the exact index URL with `indexUrl`. Legacy
HTTP sources using `url` remain supported at `<url>/agents/index.json`, with
their bundle files under `<url>/agents/<version>/`.

## Zip contents

Each zip contains:

- **`manifest.json`** — Bundle metadata: `version` (semver) and `published` (ISO date)
- **Skill directories** — Each with a `SKILL.md` per the [agentskills.io specification](https://agentskills.io/specification), plus optional `scripts/`, `references/`, and `assets/` subdirectories
- **Rovo agent directories** — Each with a `rovo-agent.yaml` for Playwright automation
- **`README.md` frontmatter** — Optional `name`, `description`, and `tags[]` for display in the TUI
