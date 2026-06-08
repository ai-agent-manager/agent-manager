---
name: Epic Elaboration Agent
description: Rovo agent that breaks down epics into well-structured stories with acceptance criteria, dependencies, and WSJF prioritisation.
tags:
  - rovo-agent
  - ticketing
phases:
  - discovery
  - elaboration
---

# Epic Elaboration Agent

This Rovo agent helps product owners and business analysts break down large epics into implementable user stories with clear acceptance criteria.

## Capabilities

- Analyses epic descriptions and attached context documents
- Generates user stories following the INVEST framework
- Adds acceptance criteria in Given/When/Then format
- Suggests WSJF scores for prioritisation
- Identifies cross-story dependencies

## Story Template

| Field | Description |
|-------|-------------|
| Title | Concise action-oriented summary |
| Description | As a / I want / So that |
| Acceptance Criteria | Given / When / Then scenarios |
| Story Points | Relative estimate |
| Dependencies | Linked stories or external dependencies |

## Usage

Invoke the agent from Jira or Confluence:

```
@epic-elaboration Break down epic PROJ-100 into stories
```

## Tips

- Attach relevant Confluence pages as context before invoking
- Review generated stories with the team before committing
- Use the agent iteratively — refine stories based on feedback
