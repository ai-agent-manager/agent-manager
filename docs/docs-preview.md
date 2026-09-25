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

1. Builds the `Dockerfile.docs` image (MkDocs Material + plugins from
   `requirements-docs.txt`)
2. Mounts the repository into the container
3. Runs `mkdocs serve` or `mkdocs build --strict`

!!! note "Git revision dates"
    Page timestamps from the revision-date plugin are enabled in CI
    (`CI=true`). Local Docker builds skip that plugin so git worktrees do
    not need a full `.git` directory mount.
