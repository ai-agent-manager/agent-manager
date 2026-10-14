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
Agent Manager pulls and installs agents, skills and Rovo agents from sources you control,
compatible with Claude Code, Devin Desktop, GitHub Copilot, Cursor, Amazon Kiro, OpenCode,
or Atlassian Jira — interactively on a laptop, or silently in CI.
</p>

<div class="am-hero__actions" markdown>

[Get started](getting-started.md){ .md-button .md-button--primary }
[Agent Discovery File](discovery.md){ .md-button }
[GitHub](https://github.com/ai-agent-manager/agent-manager){ .md-button }

</div>

</div>

## What you can do

- Aggregate across one or more **GitHub repos**, **HTTP URLs**, **git remotes**, or **local directories**
- Install skills into the coding tools your team already uses, with broad compatibility
- Install agents into platforms like Atlassian Jira/Confluence
- Run headless installs from CI with a YAML config
- Optionally authenticate with OIDC and map teams to agents/skills

## Where to look next

| Guide | When to read it |
|-------|-----------------|
| [Getting started](getting-started.md) | Install and first run |
| [Agent Discovery File](discovery.md) | Publish a catalogue your team can trust |
| [Authentication](authentication.md) | OIDC login and `AGENTMAN_ACCESS_TOKEN` |
| [My Projects](projects.md) | Project-scoped installs |
| [Artefact sources](artefact-sources.md) | Third-party zip packaging |
| [Bundle format](bundle-format.md) | Shape of `index.json` and `bundle.zip` |
| [Telemetry](telemetry.md) | What is collected and how to turn it off |
| [Publishing](publishing.md) | Release tags and npm publish (maintainers) |
