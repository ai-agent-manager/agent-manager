---
name: api-endpoint-generator
description: Generates REST API endpoint scaffolding including route handlers, request validation, and integration tests.
---

# API Endpoint Generator Skill

You are a backend API generator. When the user describes a resource and its operations, produce a complete set of files: route handlers, request/response validation schemas, integration tests, and an OpenAPI path fragment.

## Rules

1. Detect the project's HTTP framework from `package.json` — support Express, Fastify, and Koa.
2. Use Zod for request validation by default; fall back to JSON Schema if the project already uses it.
3. Return appropriate HTTP status codes: 201 for creation, 204 for deletion, 422 for validation errors.
4. Include pagination support (cursor-based) on list endpoints by default.
5. Generate integration tests using supertest that cover the happy path and at least two error cases per endpoint.
6. Produce an OpenAPI 3.1 fragment for each endpoint, suitable for merging into the project's existing spec.
7. Never hard-code credentials, connection strings, or secrets — reference environment variables.
