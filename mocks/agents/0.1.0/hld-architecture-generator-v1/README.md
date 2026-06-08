---
name: High Level Design Architecture Generator Skill
description: Agent skill that generates enterprise-grade High Level Design documents from project requirements and technical context.
tags:
  - agent-skill
  - architecture
phases:
  - discovery
  - elaboration
videos:
  - title: "See It in Action"
    src: "/media/skills/hld-architecture-generator-v1/hld-demo.mp4"
---

# HLD Architecture Generator

This skill generates comprehensive High Level Design (HLD) architecture documents from your project requirements, technical constraints, and existing codebase.

Install it with:

```
npx -y @ai-agent-manager/cli@latest <bundle-url>
```

## How It Works

The skill follows a structured workflow to produce a complete HLD:

- Extracts requirements from Jira epics, Confluence pages, and source code
- Analyses existing architecture patterns and technology choices
- Generates diagrams using Mermaid or PlantUML notation
- Produces a full HLD document following your organisation's template

## Supported Output Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| Markdown | Plain `.md` file with embedded diagrams | Developer-facing docs |
| Confluence | Confluence-compatible wiki markup | Stakeholder-facing docs |
| PDF | Rendered PDF via Pandoc | Formal deliverables |

## Quick Start

Run the skill from your AI coding tool:

```bash
# Example prompt for Claude Code
Generate an HLD for the payment service based on the Jira epic PAY-123
```

## Configuration

The skill reads configuration from an `hld-config.yaml` file in your project root:

```yaml
template: default
outputFormat: markdown
diagramTool: mermaid
sections:
  - context
  - containers
  - components
  - deployment
```

## Architecture Decision Records

The generator can also produce lightweight ADRs for key decisions identified during analysis.
