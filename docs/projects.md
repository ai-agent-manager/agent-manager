# My Projects

My Projects is a project-scoped install experience backed by the publisher's authenticated REST API. It is enabled through the [discovery document](discovery.md) `api` and `projects` blocks and requires [authentication](authentication.md).

## Discovery document fields

See the [full field reference](discovery.md#fields) for schema details. Projects-related fields:

| Field | Description |
|-------|-------------|
| `api.baseUrl` | Base URL of the authenticated REST API (e.g. `https://api.example.com`) |
| `projects.enabled` | When `true`, enable **My Projects** (also requires auth and a resolved API base URL) |
| `projects.exclusiveSource` | When `true`, constrain global Search & Install, Bulk Sync, and headless installs to the caller's project allowlists |

JSON Schema: [`src/discovery/schema.json`](../src/discovery/schema.json).

Publishers that do not expose projects should omit the `projects` block or set `projects.enabled` to `false`.

## API base URL

Agent Manager resolves the API host in this order:

1. `API_BASE_URL` environment variable (if set and non-empty)
2. `api.baseUrl` from the discovery document

Typical pairing:

| User-provided source | Discovery `api.baseUrl` |
|----------------------|-------------------------|
| `https://example.com` | `https://api.example.com` |

Agent Manager does not invent or hardcode API hosts. Use the discovery field for the normal published value, or set `API_BASE_URL` to override it (for example in local development).

```bash
API_BASE_URL=https://api.example.com npx -y @ai-agent-manager/cli@latest https://example.com
```

All API calls use the same OIDC bearer token as protected skill downloads — see [Authentication](authentication.md) for login, refresh, and `AGENTMAN_ACCESS_TOKEN`.

## Interactive menu

When `auth.required` is `true`, the user has an auth session (successful login or usable stored tokens), `projects.enabled` is `true`, and an API base URL is available, the main menu shows **My Projects**. That screen:

1. Calls `GET {apiBaseUrl}/projects` to list projects the caller can access ([bearer refreshed](authentication.md#token-refresh) immediately before the request).
2. On selection, calls `GET {apiBaseUrl}/projects/{projectId}` for details (same refresh-on-use behaviour).
3. Shows the project name and description (when present).
4. Offers **Install Agent Skills** and **Provision Rovo Agents** (same flows as the main menu). When a project restricts agents or skills, the catalogues shown in those flows are filtered client-side using `allowedAgentIds` / `allowedSkillIds` (IDs are catalogue directory names). Unrestricted projects see the full catalogue.

This matches the authenticated backend project API (including project agent/skill restriction fields).

## Exclusive source (`projects.exclusiveSource`)

When `projects.enabled` is `true` and `exclusiveSource` is `true`:

- **Search & Install** shows only skills and Rovo agents permitted by at least one of the caller's projects (union of project allowlists). The highlighted detail row lists the project name(s) that permit that item.
- **Bulk Sync** (Maintenance → Bulk Sync by Tool) offers the same membership-filtered skill list, so sync cannot install skills outside those allowlists.
- **Headless** installs fail if any requested skill is not permitted by the caller's project memberships (or is absent from the exclusive catalogue). [Authentication](authentication.md) is required so memberships can be loaded (`AGENTMAN_ACCESS_TOKEN` or a stored session).

When `exclusiveSource` is omitted or `false`, global Search & Install, Bulk Sync, and headless installs use the full discovery catalogue (project allowlists still apply inside My Projects flows).

## Related

- [Discovery document format](discovery.md) — `sources`, `api`, and `projects` blocks
- [Authentication](authentication.md) — bearer tokens for API and content requests
- [Mock server setup](../mocks/README.md) — local My Projects + OIDC end-to-end testing
