---
name: Mock APIs Skill
description: Agent skill that generates mock API configurations for service virtualisation during development and testing.
tags:
  - agent-skill
  - backend
  - testing
phases:
  - build_and_release
---

# Mock APIs Skill

This skill generates mock server configurations from OpenAPI specifications or ad-hoc endpoint definitions, enabling teams to develop and test against realistic API doubles.

## Features

- Scaffold mock configurations from OpenAPI specs
- Generate realistic response data using Faker
- Support for stateful mocks with request capture
- CORS configuration for browser-based consumers

## Supported Mock Engines

| Engine | Config Format | Runtime |
|--------|--------------|---------|
| Imposter | YAML | Docker / JVM |
| WireMock | JSON | Docker / JVM |
| MSW | TypeScript | Node.js |

## Usage

```bash
# Example prompt
Generate Imposter mock configs for the payment-api OpenAPI spec
```

## Best Practices

- Keep mock data realistic but deterministic for repeatable tests
- Version mock configurations alongside the API spec
- Use environment variables for dynamic values
