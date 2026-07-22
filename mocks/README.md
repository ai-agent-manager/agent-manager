# Mocks — local HTTP skills server

This directory contains an [Imposter](https://docs.imposter.sh) mock that replicates the HTTP skills server used by the Agent Manager CLI. It serves the same URL structure as a real bundle server so integration tests and local development runs can work fully offline.

## Directory structure

```
mocks/
├── .imposter.yaml          # Imposter engine and plugin config
├── agents-config.yaml      # REST plugin routes — discovery, /agents/*, /artefacts/*
├── build-bundles.sh        # Script to rebuild bundle.zip after content changes
├── .well-known/
│   └── agents/
│       └── discovery.json  # Discovery document served at /.well-known/agents/discovery.json
├── agents/
│   ├── index.json          # Version index — lists available bundle versions
│   └── 0.1.1/
│       ├── manifest.json   # Bundle manifest — agent IDs, names, tags, phases
│       ├── bundle.zip      # Downloadable bundle (built from this directory)
│       ├── bundle.zip.sha256
│       ├── react-component-generator/
│       │   ├── README.md         # Display metadata (frontmatter) + docs
│       │   └── SKILL.md          # agentskills.io skill definition
│       ├── api-endpoint-generator/
│       │   ├── README.md
│       │   └── SKILL.md
│       ├── agent-sprint-planner/
│       │   ├── README.md
│       │   └── rovo-agent.yaml   # Rovo agent definition for Playwright automation
│       └── agent-release-notes/
│           ├── README.md
│           └── rovo-agent.yaml
└── artefacts/
    ├── artefact-test.zip        # Sample artefact zip (contains my-artefact-skill)
    └── artefact-test.zip.sha256 # Integrity sidecar
```

## Starting and stopping

Requires the [Imposter CLI](https://docs.imposter.sh/run_imposter_cli/) to be installed.

```bash
cd mocks
imposter up             # starts on http://localhost:8080
imposter down -a        # stop all running Imposter instances
```

The mock serves the discovery document at `/.well-known/agents/discovery.json`, all files under `/agents/`, and artefact zips under `/artefacts/`, with permissive CORS so the CLI and any browser-based frontend can reach it without cross-origin errors.

Point the CLI at the mock:

```bash
npx -y @ai-agent-manager/cli@latest http://localhost:8080
# or in dev:
npm run dev -- http://localhost:8080
```

## How the mock works

`.imposter.yaml` configures Imposter's native engine. `agents-config.yaml` defines three REST plugin rules:

```yaml
plugin: rest
resources:
  - path: /.well-known/agents/discovery.json
    method: GET
    response:
      file: .well-known/agents/discovery.json

  - path: /agents/*
    method: GET
    response:
      dir: agents

  - path: /artefacts/*
    method: GET
    response:
      dir: artefacts
```

The discovery rule returns `.well-known/agents/discovery.json` verbatim, so `GET /.well-known/agents/discovery.json` gives the CLI its list of sources. The `/agents/*` wildcard maps to files under `agents/` (e.g. `GET /agents/0.1.1/bundle.zip`). The `/artefacts/*` wildcard maps to files under `artefacts/` (e.g. `GET /artefacts/artefact-test.zip`), matching the community artefact source in the discovery document.

## Adding or updating a bundle version

1. Create a new version directory, e.g. `agents/0.2.0/`.
2. Add (or copy and modify) agent/skill subdirectories and a `manifest.json`.
3. Update `agents/index.json` to include the new version entry.
4. Rebuild the zip:

   ```bash
   cd mocks
   ./build-bundles.sh
   ```

   This zips each version directory in-place and writes `bundle.zip` + `bundle.zip.sha256` into it.

5. Restart Imposter to pick up the changes.

## Adding or updating an agent or skill

Each subdirectory of a version represents one agent or skill. The layout depends on type:

**Rovo agent** — must contain:
- `rovo-agent.yaml` — the StudioAgent definition consumed by the Playwright provisioner
- `README.md` — YAML frontmatter (`name`, `description`, `tags[]`, `phases[]`) plus human-readable docs

**Skill** — must contain:
- `SKILL.md` — the [agentskills.io](https://agentskills.io/specification) skill definition with frontmatter
- `README.md` — optional, same frontmatter format as above

After adding or modifying content, update `manifest.json` in the same version directory to keep the agent list in sync, then rebuild the bundle with `build-bundles.sh`.

## Keeping the mock in sync

When the bundle format changes (new fields in `manifest.json`, new agent types, new URL paths), update the mock content to match and also check:

- `src/bundle/` — the downloader, scanner, and manifest parser
- `tests/fixtures/valid-bundle/` — the unit-test fixtures, which use a minimal bundle and may need updating independently
