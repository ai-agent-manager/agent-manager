# Shared mutations and version management (M1b)

M1b applies to the TUI, headless commands, and the operations facade that the web
server will use. HTTP routing and job management remain in M2.

## Mutation ownership and recovery

`withMutation` coordinates cache publication, skill installation/removal, version
changes, and config writes. Lock order is **mutation lease, then config lock**.
Awaited nested helpers reuse ownership. Do not detach work or start parallel
conflicting mutations inside an operation.

Each acquisition creates a unique owner claim under the `mutation.lock/` directory.
A ticket queue serializes contenders. Claims first announce that a ticket is being
chosen; readers wait for that choice before comparing ticket/owner order. Claim
filenames are never reused, so concurrent reapers cannot unlink a successor's
claim. The experimental single-file lock is also recognized during upgrade.

Owners renew every two seconds. Dead PIDs are reclaimed immediately; claims whose
heartbeat expires after 60 seconds are reclaimed even when a PID was recycled,
its liveness check is inaccessible, or its initial write was incomplete. Holders
check their lease before nested operations and on completion, and an expired
holder cannot renew its lease. This is a lease, not a fixed maximum operation age.
External-process contention times out after 30 seconds with the owner PID and
lock location. Claims actually owned by this process queue without consuming that
timeout; a matching PID alone is insufficient to identify a local waiter.
SIGINT/SIGTERM and normal exit release owned claims; SIGKILL recovery relies on
reaping. Filesystem/config critical sections must stay short and asynchronous.

Authentication, downloads, and cloning happen before the mutation critical
section. Staging uses unique names. Cache publication and provisioner changes
still coordinate. An update rechecks its installed-instance snapshot before
committing, so removal during an authentication prompt cannot resurrect a skill.
Read-only version/catalogue facades do not take the mutation lease.

Publication restores the previous link if record writing fails. This covers
ordinary installs, reinstalls, and manual version switches. The coordinator is
not a crash-recovery journal, and older agentman binaries do not participate.

## Existing caches and version identity

Legacy flat caches remain usable after upgrade. When an origin marker is absent,
extraction compares the cache with the freshly acquired archive, then atomically
records the requested origin with `trackedReferences: false`. Directory imports
compare against a freshly copied directory in the same way. Adoption changes
metadata only and returns `isNew: false`. Version labels alone do not prove origin;
a mismatch needs cleanup of the unused entry or a distinct source cache. Existing
markers for another origin are rejected. Archive-supplied markers are never used
as evidence. Successful extraction removes its owned download ZIP.

HTTP content roots and local directories both have bundle identities. New local
pins retain the source directory; old local pins can use an adopted current cache
to establish that origin. Missing-marker diagnostics explain reacquisition/cleanup
without exposing absolute cache paths. An unattested current bundle does not
prevent moving to an attested bundle. If both origins are known, they must match.

An installation is `(installKey, toolId, scope, repoRoot?)`. Bare skill directory
names and stored link names are resolved separately. Switching updates both the
source pin and compatibility version, preserves source identity, and records the
actual symlink/copy method. Installed-info display prefers the authoritative
record version, with filesystem inference reserved for records without one.

The facade provides `listBundles`, `selectBundle`, `removeBundle`,
`listInstalledSkillVersions`, and `switchInstalledSkillVersion`. Opaque bundle IDs
identify cache location and provenance, **not content bytes**. Mutations resolve
and validate them again under the lease. Named-source versions are selected per
installed skill. Git/artefact installs use their update flow rather than bundle
version switching. Cache path checks reject traversal, symlink escapes, and
Windows-reserved filename characters; percent characters remain allowed.

## Repository catalogues and deletion

Repository catalogue selection reads per-install source pins before choosing
content and synthesizing legacy pins. Discovery skills retain their own metadata.
Bulk TUI installs also receive these pins. Mixed versions or an unreadable pinned
bundle stop repository scope selection with an error; deliberately falling back
to a global bundle could install different content under the repository pin.
This replaces the previous silent fallback and reports
`repo_pinned_bundle_load_failed`.

Repository writes register the canonical root before committing the install record.
Deletion checks system records and registered repositories. Missing repositories
or missing `.agentman.json` files count as no recorded references; corrupt or
unreadable files still block deletion. Known pins are compared by cache location,
so equal labels in different named-source caches do not block each other's cleanup.
Records without sufficient source information retain conservative version matching.

Unused legacy entries can be removed after these checks; `trackedReferences` is
historical metadata, not a permanent deletion prohibition. Existing unregistered
repositories and manually created links cannot be discovered globally. Current
bundles and known references remain protected. Local-directory bundles have the
same cleanup behavior as HTTP bundles.

## Regression coverage

- Real archive extraction in the old marker-less layout, exercised through forced
  startup update, Check for updates, headless config, and Manage update.
- Directory adoption, switching away from unattested current bundles, origin
  mismatch rejection, and successful-download ZIP cleanup.
- Real second-process install/remove and switch/delete barriers, plus SIGINT,
  SIGKILL, heartbeat renewal, expired malformed claims, timeout diagnostics, and
  competing reapers. Child-process waits allow cold CI startup.
- Flat/namespaced and system/repository install → switch → reload → info → update;
  Windows copy fallback, sibling preservation, missing skills, and rollback.
- TUI/headless repository catalogue parity, real version-screen provenance support,
  and caught contention errors in settings and bulk skill selection.
- Stale repository registrations, source-specific deletion, path confinement,
  manifest/directory version mismatch, and stale provenance IDs.

Tests use isolated temporary homes and never lock or modify real user state.
