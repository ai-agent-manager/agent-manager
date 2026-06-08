---
name: TDD Frontend Generator Skill
description: Agent skill that scaffolds frontend components using test-driven development, generating tests first then implementation.
tags:
  - agent-skill
  - frontend
  - tdd
phases:
  - build_and_release
---

# TDD Frontend Generator

This skill generates frontend components following a strict test-driven development workflow. It writes failing tests first, then produces the minimal implementation to make them pass.

## Workflow

- Discover the component requirements from the Jira story or prompt
- Generate unit and integration test files using your project's test framework
- Implement the component to satisfy the tests
- Verify all tests pass before finalising

## Supported Frameworks

| Framework | Test Runner | Status |
|-----------|------------|--------|
| React | Vitest / Jest | Supported |
| Angular | Karma / Jest | Supported |
| Vue | Vitest | Supported |
| Svelte | Vitest | Experimental |

## Usage

```bash
# Example prompt
Generate a TDD component for a user profile card based on story PROJ-456
```

## Best Practices

- Keep components small and focused on a single responsibility
- Use snapshot tests sparingly — prefer explicit assertions
- Mock external dependencies at the boundary
