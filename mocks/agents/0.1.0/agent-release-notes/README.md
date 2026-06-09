---
name: Release Notes Agent
description: Rovo agent that generates structured release notes from merged pull requests and commit history.
tags:
  - rovo-agent
  - documentation
phases:
  - build_and_release
---

# Release Notes Agent

This Rovo agent generates clear, audience-appropriate release notes by analysing merged pull requests, commit messages, and linked tickets for a given release.

## Capabilities

- Scans merged PRs between two tags or dates
- Groups changes by category (features, fixes, breaking changes, internal)
- Links each entry to its PR and ticket
- Produces both technical and user-facing summaries
- Detects breaking changes from conventional commit prefixes

## Output Format

The agent produces Markdown release notes with the following sections:

```markdown
## What's New
- Feature description (#PR)

## Bug Fixes
- Fix description (#PR)

## Breaking Changes
- Migration steps (#PR)
```

## Usage

Invoke the agent from your repository:

```
@release-notes Generate notes for v2.4.0 based on changes since v2.3.0
```

## Tips

- Use conventional commits for best results — the agent uses commit prefixes to categorise changes
- Run the agent before tagging a release to review the summary with the team
