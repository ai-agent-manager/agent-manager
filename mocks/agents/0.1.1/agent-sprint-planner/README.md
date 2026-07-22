---
name: Sprint Planner Agent
description: Rovo agent that breaks down epics into sprint-ready user stories with acceptance criteria, estimates, and dependency mapping.
tags:
  - rovo-agent
  - planning
phases:
  - discovery
  - elaboration
---

# Sprint Planner Agent

This Rovo agent helps product owners and delivery leads decompose epics into well-formed user stories ready for sprint commitment.

## Capabilities

- Analyses epic descriptions and linked context documents
- Generates user stories following the INVEST framework
- Adds acceptance criteria in Given/When/Then format
- Suggests relative story-point estimates
- Maps cross-story dependencies

## Story Template

| Field | Description |
|-------|-------------|
| Title | Concise action-oriented summary |
| Description | As a / I want / So that |
| Acceptance Criteria | Given / When / Then scenarios |
| Story Points | Relative estimate (1, 2, 3, 5, 8, 13) |
| Dependencies | Linked stories or external blockers |

## Usage

Invoke the agent from your project management tool:

```
@sprint-planner Break down epic PROJ-100 into stories for the next sprint
```

## Tips

- Attach relevant design docs or architecture notes as context before invoking
- Review generated stories with the team before committing to the sprint
- Use the agent iteratively — refine stories based on feedback
