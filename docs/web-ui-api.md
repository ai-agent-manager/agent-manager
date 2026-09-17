# Web UI API

This is the local browser API implemented by `src/ui-server/`. It is separate
from the Chrome extension bridge in `src/server/`. See [the web UI guide](web-ui.md)
for launch, security, lifecycle and contributor guidance. The type-only response
contract is primarily [api-types.ts](../src/ui-server/api-types.ts); small inline
responses, such as DELETE-install results, are described in the route table. Request validation lives
in [validate.ts](../src/ui-server/validate.ts) and the route handlers.

## Request conventions

- The server binds to `127.0.0.1`. Use the exact origin printed by the launcher;
  replacing the hostname with `localhost` fails the Host check. An Origin header,
  when present, must also equal that origin. No CORS permission is emitted.
- Every `/api/*` request, including reads and the event stream, requires
  `Authorization: Bearer <launch-token>`. `/health` and static assets do not
  require a token, but still pass Host/Origin validation.
- Mutations use `Content-Type: application/json` (optionally `charset=utf-8`).
  Send `{}` for actions and DELETE requests with no fields. The body limit is
  1 MiB. Unknown body fields and unknown/repeated query parameters are rejected.
- Encode identifiers as one path component with `encodeURIComponent`, especially
  namespaced install keys containing `/`. The router decodes once; identifiers
  are not filesystem paths. Rejecting `..`, backslashes and double encoding is
  part of server validation.
- `repoRoot` is an existing absolute Git repository root, canonicalized on the
  server. A subdirectory is not accepted. When omitted for repository scope, the
  detected launch repository is used; without either root the request fails.
  The optional sync repository for `POST /api/bundles/current` is different:
  omission means system installations only.
  Selecting another repository does not change the process working directory.
- `sessionRevision` is the integer from the current ready `SessionDto`. Reload,
  login, logout and source changes can invalidate it. Refresh and reselect after
  `STALE_SESSION`; do not silently retry a captured selection against a new revision.
- Bundle IDs are opaque, lowercase 64-character hex values returned by the
  server. Do not construct IDs from version labels, cache paths or URLs. Use
  `removalId` for deletion; an unattested cache may have this without a selectable
  `bundleId`.

In the table, `?` marks optional JSON fields or query parameters; query fields
are listed separately from JSON bodies. Success is HTTP 200 unless stated.

## Routes

| Method and path | Request | Success response |
| --- | --- | --- |
| `GET /health` | None | `{status: "ok"}`; no version or credentials |
| `GET /api/context` | None | `ContextDto`: version, platform, launch directory, detected repository and tools |
| `GET /api/session` | None | `SessionDto`: state, revision, permitted catalogue, auth/membership status, warnings and load job |
| `POST /api/session/load` | `{source?, forceUpdate?}` | **202** `{jobId}` |
| `GET /api/catalogue/skills/:skillId` | Query: `scope?`, `repoRoot?` | `{entry, readme?}`; scope defaults to `system`; `repo` previews pinned repository content |
| `GET /api/installs` | Query: `scope?`, `repoRoot?` | `{records: InstalledRecordDto[]}`; scope is `system`, `repo` or `all` (default) |
| `GET /api/installs/:installKey` | Query: `scope?`, `toolId?`, `repoRoot?` | `{record: InstalledRecordDto}`; ambiguous identities return a conflict |
| `POST /api/installs` | `{sessionRevision, skillId, installKey, scope, repoRoot?, toolIds}` | **202** `{jobId}`; scope is `system` or `repo` |
| `POST /api/installs/:installKey/update` | `{scope, toolId, repoRoot?}` | **202** `{jobId}` |
| `DELETE /api/installs/:installKey` | Query: `scope`, `toolId`, `repoRoot?`; body `{}` | `{result: {removed: [{name}], errors: [{name, error}]}}` |
| `GET /api/sources` | None | `SourcesDto`: `{sources, active}` |
| `POST /api/sources` | `{value, activate?}`; activation defaults to false | `SourcesDto` |
| `POST /api/sources/remove` | `{kind, value}` copied from a displayed stored source | `SourcesDto` |
| `POST /api/sources/activate` | `{kind, value}` copied from a displayed stored source | `SourcesDto` |
| `GET /api/settings` | None | `SettingsDto`: stored values and environment overrides |
| `PATCH /api/settings` | `{startupUpdateChecksDisabled?, telemetryDisabled?}` | Updated `SettingsDto` |
| `GET /api/auth` | None | `AuthDto`; checks cached token identity/expiry without interactive login |
| `POST /api/auth/login` | `{}` | **202** `{jobId}`; authenticates and reloads the selected source |
| `POST /api/auth/logout` | `{}` | `{}` after token-producing jobs drain and credentials are deleted |
| `GET /api/bundles` | None | `BundlesDto`: cached entries, current flat version, remote-browsing availability and reasons |
| `GET /api/bundles/remote` | None | `RemoteBundlesDto`: `{bundles, sessionRevision}`; records download choices for this session |
| `POST /api/bundles/download` | `{sessionRevision, bundleId}` from the remote listing | **202** `{jobId}`; downloads without activation |
| `POST /api/bundles/current` | `{sessionRevision, bundleId, syncInstalled, repoRoot?}`; `syncInstalled` is required | **202** `{jobId}`; omitted repository means synchronization covers system installations only |
| `DELETE /api/bundles/:bundleId` | Path contains the entry's **removalId**; body `{}` | `{}` after reference/provenance revalidation |
| `GET /api/skill-versions` | Query: `repoRoot?` | `{instances: InstalledRecordDto[]}` |
| `GET /api/skill-versions/:installKey/available` | Query: `scope`, `toolId`, `repoRoot?` | `SkillVersionsDto`: compatible cached bundles, `supported` and `reason?` |
| `PUT /api/skill-versions` | `{sessionRevision, bundleId, toolId, installKey, scope, repoRoot?}` | **202** `{jobId}` |
| `GET /api/jobs/:id` | None | `JobDto` |
| `POST /api/jobs/:id/cancel` | `{}` | `{}` after cancellation cleanup; 409 if finished or not cancellable |
| `GET /api/events` | None | SSE stream described below |
| `POST /api/shutdown` | `{}` | `{}` acknowledged before graceful drain begins |

Unfiltered installed reads include system and detected/explicit repository
records. Without a repository root they include system records only.
`GET /api/skill-versions` follows the same repository selection rule. Mutations
that target an installed instance require its exact tool and scope, plus the
repository root for repository installations.

Catalogue-detail and skill-version instance routes reject `repoRoot` outside repo
scope. Install routes accept it for system scope but the system install operation
does not use that root. Do not send a repository root for system installations.

Stored-source `kind` is `discovery`, `repo` or `directory`. Source changes read
fresh config. Activating/removing a source invalidates the loaded catalogue;
load the selected source before installing again. Adding without activation only
changes the saved list.

## Jobs and events

A 202 response means work was accepted, not that it succeeded. Read the returned
job or consume SSE until its `state` is `succeeded`, `failed` or `cancelled`.
Nonterminal states are `queued` and `running`; phases are `queued`, `resolving`,
`auth`, `download`, `commit` and `complete`. Trust `canCancel` rather than guessing
from elapsed time. The job may expose an `authorizeUrl` during sign-in.

| Job kind | Successful `result` |
| --- | --- |
| `session-load`, `auth-login` | `{sessionRevision}` |
| `install`, `install-update` | `{result: InstallResultDto}`; inspect per-skill `errors` even when the job succeeded |
| `bundle-download` | `{}` |
| `bundle-select` | `{failures: string[], superseded: boolean}`; synchronization failures and a newer reload are explicit |
| `skill-version-select` | `{success: true}` |

`superseded` is optional in the shared `JobResult` type, but the bundle-select
route currently always returns a boolean.

`GET /api/events` uses `text/event-stream` with `id`, `event` and JSON `data`
fields. The browser uses streaming `fetch` so authorization stays in a header.

| Event | Data and handling |
| --- | --- |
| `snapshot` | `SnapshotDto {session, jobs}` on **every** connection; replace/reconcile local state from it |
| `session` | Complete `SessionDto`; a new revision invalidates previous selections |
| `job` | Complete `JobDto`; update the matching job |
| `ping` | `{}` keepalive, currently every 25 seconds |

Event IDs increase within a server lifetime. Reconnection takes a new snapshot;
there is no `Last-Event-ID` replay contract. A snapshot includes retained completed
jobs, covering work that finished before subscription or while disconnected.
The registry currently allows four running jobs, 20 queued jobs and 50 retained
completed jobs. A missing/evicted job returns 404 `JOB_NOT_FOUND`; refresh the
affected resource rather than assuming success. Jobs are not persisted across
server restarts.

## Errors and time bounds

HTTP failures use `{error: ErrorDto}` with `name`, `message`, `category` and
optional `code`/structured details. Jobs put the same error object in `JobDto.error`.
Known domain failures retain safe diagnostics; unknown errors return a generic
message without a stack. DTOs deliberately expose context/installation paths where
needed. Error diagnostics redact URL credentials/query strings, bearer strings
and upstream API/token-exchange response bodies. Known operational errors may
include local paths, such as the mutation lock directory.

Common responses include 400 for malformed input, 401 for a missing/invalid launch
token, 403 for Host/Origin or catalogue rejection, 404 for missing resources,
405 for unsupported methods, 409 for stale selections/contention/unsupported
operations, 413 for oversized bodies, 415 for non-JSON mutations and 503 while
stopping. The serializer also returns 422 for source/validation domain failures,
500 for unknown failures and 502 for some upstream/integrity failures. Remote version lookup can return 504 `REMOTE_TIMEOUT` after its
15-second deadline.

Synchronous filesystem mutations wait up to five seconds to acquire the mutation
lease. A disconnected or expired waiter is cancelled so it cannot write after
the browser reports failure. Once acquired, the response timeout is disabled and
the local commit drains. Job-backed operations report their progress separately;
closing a browser tab does not cancel them.
