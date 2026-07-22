---
name: API Endpoint Generator
description: Agent skill that generates REST API endpoint scaffolding including route handlers, request validation, and integration tests.
tags:
  - agent-skill
  - backend
  - api
phases:
  - build_and_release
---

# API Endpoint Generator

This skill generates REST API endpoints from a description of the resource and its operations. It produces route handlers, request/response schemas, validation middleware, and integration tests.

## What It Produces

| File | Purpose |
|------|---------|
| `routes/<resource>.ts` | Express/Fastify route handlers |
| `schemas/<resource>.ts` | Zod or JSON Schema request/response validation |
| `tests/<resource>.test.ts` | Integration tests with supertest |
| `openapi/<resource>.yaml` | OpenAPI 3.1 path fragment |

## Usage

Run the skill from your AI coding tool:

```
Generate CRUD endpoints for a Project resource with name, description, and status fields
```

The skill detects your framework (Express, Fastify, Koa) from `package.json` and generates idiomatic handlers.

## Configuration

Place an `.api-generator.yaml` in your project root:

```yaml
framework: express           # express | fastify | koa
validation: zod              # zod | json-schema
auth: bearer                 # bearer | api-key | none
```
