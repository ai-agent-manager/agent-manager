# Artefact Source — Packaging and Publishing

> **Prefer [`http`](discovery.md#source-types) and [`git`](discovery.md#source-types) sources.** Artefacts are a secondary packaging option for third-party zip distributions. Declare preferred catalogue sources in the [discovery document](discovery.md).

## What is an artefact?

An artefact is a **versioned `.zip` file** containing one or more skills. Unlike a bundle (which uses an index/manifest and supports rovo agents), an artefact is a self-contained package — simpler to create, version, and distribute.

## Directory layout inside the zip

agentman scans for skills in three layout patterns (checked in this order):

```
# Layout 1: SKILL.md at the zip root (single skill, name derived from zip filename)
artefact.zip/
  SKILL.md

# Layout 2: skill directories at the root (each dir with SKILL.md = one skill)
artefact.zip/
  my-skill/
    SKILL.md
  another-skill/
    SKILL.md

# Layout 3: single wrapper directory containing skill directories
artefact.zip/
  my-wrapper/
    my-skill/
      SKILL.md
    another-skill/
      SKILL.md
```

**Resolution order matters:** Layout 1 is checked first — if a `SKILL.md` exists at the root, that single skill is used and subdirectories are ignored (a warning is logged if skill directories are also present). Layout 3 only kicks in when there's exactly one top-level directory and no skills were found at root level.

> **Note:** In Layout 1, the skill's identifier is derived from the zip filename (e.g. `my-skill-1.0.0.zip` → `my-skill`), not from the `name:` field in `SKILL.md`. The `name:` field is used as display metadata only. Use Layouts 2 or 3 if you need to control the skill identifier directly.

Each skill **must** have a `SKILL.md` file. The frontmatter is optional but recommended:

```markdown
---
name: my-skill
description: What this skill does
version: 1.0.0
---

# My Skill

Instructions for the AI go here...
```

## Creating an artefact zip

```bash
# Single skill
mkdir -p my-skill && cp SKILL.md my-skill/
zip -r my-skill-1.0.0.zip my-skill/

# Multiple skills
mkdir -p skills/skill-a skills/skill-b
cp skill-a/SKILL.md skills/skill-a/
cp skill-b/SKILL.md skills/skill-b/
zip -r my-skills-2.0.0.zip skills/
```

## Publishing

1. **Upload the zip** to any HTTPS-accessible URL (CDN, GitHub Releases, S3, etc.)
2. **Create a `.sha256` sidecar** next to the zip:
   ```bash
   shasum -a 256 my-skill-1.0.0.zip | awk '{print $1}' > my-skill-1.0.0.zip.sha256
   ```
3. **Add to your discovery document:**
   ```json
   {
     "name": "my-skill-artefact",
     "type": "artefact",
     "url": "https://cdn.example.com/skills/my-skill-1.0.0.zip",
     "status": "official"
   }
   ```

## Version resolution

The artefact version is resolved in this priority order:
1. Version extracted from the URL/filename pattern (e.g. `my-skill-1.2.0.zip` → `1.2.0`, or a semver path segment like `.../1.2.0/skill.zip`)
2. Embedded `manifest.json` in the zip root (if present, with a `version` field)
3. Content hash as a fallback (`sha-<first 12 hex chars>`)

## Integrity verification

- agentman fetches `<artefact-url>.sha256` automatically (e.g. `my-skill-1.0.0.zip.sha256`)
- If the sidecar exists, the downloaded zip is verified against it
- If verification fails, the install is rejected (zip is deleted)
- If no sidecar exists, the install proceeds with a warning
- An explicit `sha256` field on the source (or `artefact-sha256` in headless config) takes precedence over the sidecar — use this for out-of-band integrity pinning:
  ```yaml
  artefact-sha256: 5927d6052d97440998d2b0de8d19b6142d35ddde9996d792aafde81c6efeb207
  ```

## Security requirements

- Artefact URLs **must** use `https://`
- Plain `http://` is only allowed for `localhost` / `127.0.0.1` / `::1` (local development)
- This prevents network attackers from swapping both the zip and its sha256 sidecar

## Example: full end-to-end

```bash
# 1. Create skill
mkdir -p my-skill
cat > my-skill/SKILL.md << 'EOF'
---
name: code-reviewer
description: Reviews pull requests for common issues
version: 1.0.0
---
# Code Reviewer
You review code changes and flag potential issues...
EOF

# 2. Package
zip -r code-reviewer-1.0.0.zip my-skill/

# 3. Create integrity sidecar
shasum -a 256 code-reviewer-1.0.0.zip | awk '{print $1}' > code-reviewer-1.0.0.zip.sha256

# 4. Upload both files to your CDN
# aws s3 cp code-reviewer-1.0.0.zip s3://my-bucket/skills/
# aws s3 cp code-reviewer-1.0.0.zip.sha256 s3://my-bucket/skills/

# 5. Add to discovery.json
# { "name": "code-reviewer", "type": "artefact", "url": "https://cdn.example.com/skills/code-reviewer-1.0.0.zip" }

# 6. Users install via:
# npx @ai-agent-manager/cli@latest https://your-domain.com
```

## Related

- [Discovery document format](discovery.md) — preferred `http` / `git` sources and the `artefact` field
- [Authentication](authentication.md) — bearer tokens for protected downloads
- [My Projects](projects.md) — authenticated API and project-scoped installs
