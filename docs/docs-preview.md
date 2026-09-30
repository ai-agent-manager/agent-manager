# Previewing docs

Build and serve this documentation site locally with Docker. You do not need a
local Python install.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) available on your `PATH`

## Serve (live reload)

From the repository root:

```bash
./scripts/docs.sh
```

Open [http://localhost:8000](http://localhost:8000). Edits under `docs/` and
`mkdocs.yml` reload automatically.

Override the published port:

```bash
DOCS_PORT=8080 ./scripts/docs.sh
```

## Build only

Smoke-check a production build (same flags CI uses):

```bash
./scripts/docs.sh build
```

Output lands in `site/` (gitignored).

## What the script does

1. Copies brand assets from `assets/` into `docs/assets/` (MkDocs can only
   serve files under `docs/`)
2. Builds the `Dockerfile.docs` image (MkDocs Material + plugins from
   `requirements-docs.txt`)
3. Mounts the repository into the container
4. Runs `mkdocs serve` or `mkdocs build --strict`

Asset sync alone (used by CI before `mkdocs build`):

```bash
./scripts/docs.sh sync-assets
```

> [!NOTE]
> **Git revision dates.** Page timestamps from the revision-date plugin are
> enabled in CI (`CI=true`). Local Docker builds skip that plugin so git
> worktrees do not need a full `.git` directory mount.

## Markdown alerts

GitHub-flavoured alert syntax is supported and renders as Material
admonitions:

```markdown
> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.
```

Put a short bold lead-in when you want a custom title (GitHub always shows
the alert type as the heading):

```markdown
> [!NOTE]
> **Source types.** Details go here.
```
