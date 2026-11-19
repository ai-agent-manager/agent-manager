# M2: local UI server core

`src/ui-server/index.ts` exports `startUiServer({ port, cwd, startupSource,
forceUpdate, token, staticDir, staticHandler })`. It returns the HTTP server,
actual port, launch token, bootstrap URL, and an idempotent asynchronous `stop()`.
The default port is 19877; port 0 requests an ephemeral port. This module does not
import Ink or terminate the process. CLI launch wiring and browser assets are
described in [the current web UI guide](web-ui.md). The complete current request/response
contract lives in the [API reference](web-ui-api.md).

The server binds only to `127.0.0.1`. Every request must have the exact bound Host
and, when present, the matching Origin. Every `/api/*` request needs the launch
bearer token. Mutations require JSON, reject unknown fields, and accept at most
1 MiB. Responses disable caching and MIME sniffing and suppress referrers. No
CORS permission is emitted. Packaged static assets have confined real paths and
a restrictive CSP; missing assets produce an actionable 503 response.

## Implemented routes

| Route | Behavior |
| --- | --- |
| `GET /health` | Public status only |
| `GET /api/context` | Launch directory, canonical repository root, platform, version, tools |
| `GET /api/session` | Browser-safe session and permitted skill catalogue |
| `POST /api/session/load` | Load a source through a job |
| `GET /api/catalogue/skills/:skillId` | Permitted detail and bounded README text; optional `scope=repo&repoRoot=...` previews repository pins |
| `GET /api/installs` | Installed records, filtered by scope and explicit repository |
| `GET /api/installs/:installKey` | Resolve an installation, including ambiguity errors |
| `POST /api/installs` | Install a server-owned candidate to selected tools through a job |
| `POST /api/installs/:installKey/update` | Update with interactive authentication through a job |
| `DELETE /api/installs/:installKey` | Remove an exact scope/tool instance |
| `GET, POST /api/sources` | List and add sources |
| `POST /api/sources/activate`, `/remove` | Change stored source selection and invalidate the catalogue |
| `GET, PATCH /api/settings` | Read/update supported settings |
| `GET /api/auth`, `POST /api/auth/login`, `POST /api/auth/logout` | Fresh auth status, login/reload jobs and coordinated sign-out |
| `GET /api/bundles`, `GET /api/bundles/remote` | Cache inventory (separate safe removal IDs for unattested caches) and remote source/version IDs |
| `POST /api/bundles/download`, `POST /api/bundles/current` | Download or select a version through a revision-checked job |
| `DELETE /api/bundles/:bundleId` | Remove unused, non-current caches via removal IDs, including unattested legacy entries |
| `GET /api/skill-versions`, `GET /api/skill-versions/:installKey/available` | Exact installed instances and compatible cached versions |
| `PUT /api/skill-versions` | Change an exact tool/scope/repository pin through a job |
| `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel` | Observe/cancel jobs |
| `GET /api/events` | SSE snapshots, session changes, jobs, keepalives |
| `POST /api/shutdown` | Acknowledge, then drain and stop |

DELETE and action requests without fields still send a JSON `{}` body. Namespaced
install keys must be encoded as one route component. They are decoded once and
treated as identities. Repo scope requires an existing canonical Git root and
never changes the process working directory. When launch is outside a repository,
unfiltered installed reads include only system installations unless an explicit
repository root is supplied.

## Lifecycle guarantees

- Session revisions advance when a load or source change is accepted. Resolution
  and acquisition defer source/current-bundle persistence; only the newest load
  can publish or persist. Read-only session snapshots require no mutation lock.
- Install requests capture a candidate from the permitted catalogue. Jobs check
  its revision and identity again under the mutation lock before installation.
  Repository catalogue overrides use the shared facade. Client paths and source
  pins are never accepted. Membership failure leaves the catalogue restricted.
- A short per-server gate orders revision acceptance and publication. Installation
  loops do not hold it. Shared cross-process mutation leases coordinate filesystem
  writes with TUI/headless; take the lease before the gate when both are needed.
  Network acquisition runs outside those leases.
- Jobs have explicit queued/running/succeeded/failed/cancelled states. Four jobs
  may run, with at most 20 waiting and 50 completed retained. Queued cancellation
  prevents execution. Authentication is cancellable; acknowledgement waits for
  cleanup. Download and commit phases cannot claim cancellation or rollback.
- Authentication calls from all front doors share one process-wide coordinator.
  It covers token resolution only. A callback port occupied by another process
  becomes an actionable conflict. That process is never terminated.
- Logout invalidates the catalogue, blocks new authentication, cancels or drains
  in-flight load/login/update/download jobs, then deletes the token identities used by this
  server. A late token save in those jobs cannot undo logout.
- Each SSE connection begins with an authoritative snapshot of the session and
  retained jobs. Subscription and snapshot emission have no asynchronous gap.
  Monotonic event IDs order updates; reconnect uses snapshots, without replay.
  Slow clients are disconnected and can recover via a new snapshot.
- Shutdown rejects new API work, cancels queued/auth jobs, drains accepted
  mutations, emits final job states, closes SSE, and closes the HTTP server.

DTOs select fields explicitly, omit credential and discovery-auth objects, and
redact URL credentials/query strings and upstream API/token response bodies from
diagnostics. README content is plain text; the browser must not render raw HTML.
Authorization prompts require HTTPS, except HTTP on localhost, 127.0.0.1, or ::1
for local providers. Embedded URL credentials are rejected in all cases.

## Validation and remaining milestones

`tests/unit/ui-server/` covers HTTP guards and schemas, static traversal and
symlink escape attempts, real bundle load/install/remove, explicit repo roots,
source/settings changes, job bounds/cancellation, membership rejection,
out-of-order loads, stale selections, logout during auth cleanup, SSE reconnect,
and graceful shutdown during real installation. Importing the server with an
Ink mock that throws is part of the HTTP suite. Auth tests also exercise the
coordinator through real `authenticate` calls.

Version routes and dedicated login/logout controls were added in M5. Direct Git sources
currently return an explicit unsupported-operation conflict; Git sources inside
a discovery catalogue are supported. The optional direct-source preview/install
flow remains deferred. The `agentman ui` command, browser application, development middleware/HMR and
CLI signals were added in M3/M4; M5 version/auth screens use the same DTO, job and
session-revision contracts. M6 adds browser/packaged integration coverage.
The [M8 desktop shell](desktop.md) embeds this same server.

Synchronous filesystem mutations have a five-second queue deadline, including
contention with this server's own jobs. A disconnected waiter cannot commit later.
Once acquired, local commits drain with the response socket kept open. Bundle
removal revalidates both installed references and live catalogue paths under the
mutation lock. Selection still requires verified provenance; a removal ID alone
never authorizes selection. Bundle-switch results include `superseded: true` when
a reload accepted during sync prevents publishing that switch's catalogue.
