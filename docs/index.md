---
title: Home
hide:
  - navigation
  - toc
---

<div class="am-hero" markdown>

<div class="am-hero__brand" markdown>

![Agent Manager](assets/icon.png){ width="64" }

<div markdown>

# Agent Manager

<p class="am-hero__tagline">Versioned skills for every coding agent on the team</p>

</div>

</div>

<p class="am-hero__lead">
Agent Manager pulls a versioned bundle of skills and Rovo agent configs from a
URL you control, then installs them into Claude Code, Devin Desktop, GitHub
Copilot, Cursor, or Kiro — interactively on a laptop, or silently in CI.
</p>

<div class="am-hero__actions" markdown>

[Get started](getting-started.md){ .md-button .md-button--primary }
[Discovery guide](discovery.md){ .md-button }
[GitHub](https://github.com/ai-agent-manager/agent-manager){ .md-button }

</div>

</div>

## What you can do

- Point at a **bundle URL**, **GitHub repo**, **git remote**, or **local directory**
- Install skills into the coding tools your team already uses
- Run headless installs from CI with a YAML config
- Optionally authenticate with OIDC and provision Rovo agents

## Where to look next

| Guide | When to read it |
|-------|-----------------|
| [Getting started](getting-started.md) | Install and first run |
| [Discovery](discovery.md) | Publish a catalogue your team can trust |
| [Bundle format](bundle-format.md) | Shape of `index.json` and `bundle.zip` |
| [Telemetry](telemetry.md) | What is collected and how to turn it off |
| [Publishing](publishing.md) | Release tags and npm publish (maintainers) |

!!! tip "Preview locally"
    Run `./scripts/docs.sh` to serve this site in Docker on
    [http://localhost:8000](http://localhost:8000). See
    [Previewing docs](docs-preview.md).
