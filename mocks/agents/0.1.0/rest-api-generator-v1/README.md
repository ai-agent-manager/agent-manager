---
name: REST API Generator Skill
description: Agent skill that generates production-ready REST API scaffolding from requirements, including OpenAPI specs, controllers, and tests.
tags:
  - agent-skill
  - backend
  - api
phases:
  - build_and_release
---

# REST API Generator

This skill generates complete REST API implementations from high-level requirements or existing data models.

## What It Generates

- OpenAPI 3.1 specification
- Controller / route handlers with request validation
- Service layer with business logic stubs
- Repository interfaces and implementations
- Unit and integration tests
- Dockerfile and deployment configuration

## Supported Patterns

| Pattern | Description | Use Case |
|---------|-------------|----------|
| CRUD | Standard create, read, update, delete | Data-centric services |
| CQRS | Command query responsibility segregation | Complex domains |
| Event-driven | Async event publishing | Microservices |

## Usage

```bash
# Example prompt
Generate a REST API for managing customer orders with CRUD endpoints
```

## Configuration

Place a `.rest-api-gen.yaml` in your project root to customise output:

- Target framework (Spring Boot, Express, FastAPI)
- Database adapter (PostgreSQL, DynamoDB, MongoDB)
- Authentication strategy (JWT, OAuth2, API key)
