# Mocks — local HTTP skills server + backend API

This directory contains an [Imposter](https://docs.imposter.sh) mock that replicates:

1. The **agent content CDN** (discovery document, bundles, artefacts)
2. The **authenticated backend REST API** used by My Projects (`GET /projects`, `GET /projects/{id}`)
3. A local **OIDC authorization server** (Imposter `oidc-server` plugin) for login + PKCE

All three run on the same host so local development can work fully offline, including the interactive OAuth flow.

## Directory structure

```
mocks/
├── .imposter.yaml              # Imposter engine and plugin config
├── agents-config.yaml          # REST plugin — discovery, /agents/*, /artefacts/*
├── backend-api.yaml            # OpenAPI 3 — GET /projects (Agent Manager subset)
├── backend-api-config.yaml     # OpenAPI plugin — serves that subset from the spec
├── oidc-server-config.yaml     # oidc-server plugin — local IdP for CLI login
├── build-bundles.sh            # Rebuild bundle.zip after content changes
├── .well-known/
│   └── agents/
│       └── discovery.json      # Discovery document (api + auth + sources)
├── agents/
│   ├── index.json              # Version index — lists available bundle versions
│   └── 0.1.1/
│       ├── manifest.json       # Bundle manifest — agent IDs, names, tags, phases
│       ├── bundle.zip          # Downloadable bundle (built from this directory)
│       ├── bundle.zip.sha256
│       ├── react-component-generator/
│       │   ├── README.md       # Display metadata (frontmatter) + docs
│       │   └── SKILL.md        # agentskills.io skill definition
│       ├── api-endpoint-generator/
│       │   ├── README.md
│       │   └── SKILL.md
│       ├── agent-sprint-planner/
│       │   ├── README.md
│       │   └── rovo-agent.yaml # Rovo agent definition for Playwright automation
│       └── agent-release-notes/
│           ├── README.md
│           └── rovo-agent.yaml
└── artefacts/
    ├── artefact-test.zip        # Sample artefact zip (contains my-artefact-skill)
    └── artefact-test.zip.sha256 # Integrity sidecar
```

## Starting and stopping

Requires the [Imposter CLI](https://docs.imposter.sh/run_imposter_cli/) to be installed. The `oidc-server` plugin is listed in `imposter-project.yaml` (via `.imposter.yaml`) and installed automatically on start.

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

The discovery document requires auth, so the CLI will open a browser login. Use:

| Username | Password |
|----------|----------|
| `alice`  | `password123` |
| `bob`    | `password456` |

After login you should see **My Projects** (projects feature + API base URL + bearer token).

Interactive backend API sandbox (OpenAPI plugin): [http://localhost:8080/_spec](http://localhost:8080/_spec)

OIDC discovery: [http://localhost:8080/oidc/.well-known/openid-configuration](http://localhost:8080/oidc/.well-known/openid-configuration)

## Discovery document

`.well-known/agents/discovery.json` includes:

| Field | Value |
|-------|--------|
| `api.baseUrl` | `http://localhost:8080` — same mock host as content |
| `api.features.projects` | `true` — enables My Projects when authenticated |
| `auth.required` | `true` |
| `auth.oidcDiscoveryUrl` | `http://localhost:8080/oidc/.well-known/openid-configuration` |
| `auth.clientId` | `agent-manager` (public client; PKCE, no secret) |
| `sources` | HTTP bundle + artefact on this mock |

`agents-config.yaml` serves the discovery document and static files under `/agents/` and `/artefacts/`.

`oidc-server-config.yaml` registers redirect URI `http://localhost:19875/callback` (Agent Manager’s fixed OAuth callback). Project endpoints still respond without validating the JWT — auth here is for exercising the CLI’s OIDC + My Projects path end-to-end.

## Backend API mock (OpenAPI)

`backend-api-config.yaml` uses Imposter’s **openapi** plugin with `backend-api.yaml`. Sample payloads are set on mock resources via `response.content` (e.g. `proj-alpha` vs `proj-beta`).

### Sample data

| Project | Notes |
|---------|--------|
| `proj-alpha` | Skills restricted to `react-component-generator` |
| `proj-beta` | Agents restricted to `agent-sprint-planner` |

Catalogue IDs match the mock bundle under `agents/0.1.1/`.

### Quick checks

```bash
curl -s http://localhost:8080/.well-known/agents/discovery.json | jq '{api, auth}'
curl -s http://localhost:8080/oidc/.well-known/openid-configuration | jq '{issuer, authorization_endpoint, token_endpoint}'
curl -s http://localhost:8080/projects | jq '.[].name'
curl -s http://localhost:8080/projects/proj-alpha | jq '{name, restrictSkills, allowedSkillIds}'
```

## Adding or updating a bundle version

1. Create a new version directory, e.g. `agents/0.2.0/`.
2. Add (or copy and modify) agent/skill subdirectories and a `manifest.json`.
3. Update `agents/index.json` to include the new version entry.
4. Rebuild the zip:

   ```bash
   cd mocks
   ./build-bundles.sh
   ```

5. Restart Imposter to pick up the changes.

## Adding or updating an agent or skill

Each subdirectory of a version represents one agent or skill.

**Rovo agent** — must contain:
- `rovo-agent.yaml`
- `README.md` — YAML frontmatter (`name`, `description`, `tags[]`, `phases[]`) plus docs

**Skill** — must contain:
- `SKILL.md` — [agentskills.io](https://agentskills.io/specification) definition
- `README.md` — optional frontmatter

After changes, update `manifest.json`, rebuild with `build-bundles.sh`, and keep project allowlist examples in `backend-api.yaml` in sync with catalogue directory names.

## Keeping the mock in sync

When the bundle format or backend API changes, update:

- `backend-api.yaml` / `backend-api-config.yaml` — API shapes and examples
- `src/bundle/` and `src/api/` — CLI consumers
- `tests/fixtures/valid-bundle/` — unit-test fixtures (independent of this mock)
