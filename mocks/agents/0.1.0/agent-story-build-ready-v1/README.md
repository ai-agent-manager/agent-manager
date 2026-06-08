---
name: Story Build Ready Agent
description: Rovo agent that validates user stories against Definition of Ready criteria and suggests improvements before sprint commitment.
tags:
  - rovo-agent
  - ticketing
phases:
  - elaboration
---

# Story Build Ready Agent

This Rovo agent checks user stories against your team's Definition of Ready (DoR) criteria, ensuring stories are fully elaborated before entering a sprint.

## Validation Checks

- Acceptance criteria completeness (Given/When/Then)
- Story point estimate presence
- Dependency identification and linking
- Design asset references (Figma links)
- Technical notes and constraints

## Readiness Report

| Check | Status | Notes |
|-------|--------|-------|
| Acceptance criteria | Pass / Fail | Number of scenarios |
| Estimate | Pass / Fail | Points assigned |
| Dependencies | Pass / Warn | Unresolved blockers |
| Design assets | Pass / Skip | Links present |

## Usage

Invoke the agent from a Jira story:

```
@story-build-ready Check if PROJ-201 is ready for sprint
```

## Integration

- Works alongside the Epic Elaboration Agent for end-to-end refinement
- Supports custom DoR templates per project
- Can be triggered automatically via Jira workflow transitions
