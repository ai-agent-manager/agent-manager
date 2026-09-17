# Telemetry

Agent Manager can send operational usage events to help understand adoption and
failures. Events contain an action, a per-process random session ID and selected
metadata such as counts, tool/scope, versions and coarse error categories. Some
source acquisition events include source endpoints or repository owner/name/ref;
they do not send prompts or skill contents. Local-directory bundle endpoints are
represented as `local-directory`.

## Event coverage

These are the action names currently used by the CLI. Calls are subject to the
telemetry client's configured endpoint/site ID and opt-out gates; an action being
called does not guarantee transmission.

| Area | Actions |
| --- | --- |
| CLI entry | `agentman_started`, `agentman_start_failed` |
| Browser CLI launch | `ui_started` (property: `forceUpdate`) |
| Source/session failures | `bundle_source_resolve_failed`, `bundle_extract_failed`, `bundle_import_failed`, `bundle_manifest_load_failed`, `bundle_scan_failed`, `repo_pinned_bundle_load_failed` |
| Bundle acquisition | `bundle_download_started`, `bundle_download_succeeded`, `bundle_download_failed` |
| Repository acquisition | `repo_download_started`, `repo_download_succeeded`, `repo_download_failed` |
| Artefact acquisition | `artefact_download_started`, `artefact_download_succeeded`, `artefact_download_failed` |
| Startup checks | `startup_update_check_completed`, `startup_app_update_check_failed`, `startup_bundle_update_check_failed` |
| TUI update checks | `update_check_started`, `update_check_completed`, `update_check_failed` |
| TUI selection | `tool_selected`, `repo_scope_detection_failed`, `installed_skills_load_failed` |
| TUI bulk sync | `skills_installed`, `skills_uninstalled` |
| TUI bundle versions | `bundle_version_switched`, `bundle_version_switch_failed`, `bundle_version_removed`, `bundle_version_remove_failed`, `bundle_version_browse_failed`, `bundle_version_index_fetch_failed`, `bundle_version_reload_failed` |
| CLI self-update | `app_self_update_started`, `app_self_update_completed`, `app_self_update_failed` |
| Rovo authentication/checks | `rovo_auth_check_failed`, `rovo_authenticate_failed`, `rovo_kb_check_failed` |
| Rovo provisioning | `rovo_provision_started`, `rovo_provision_succeeded`, `rovo_provision_failed` |

`ui_started` is called by the production CLI launcher after the local server starts;
it is not a browser pageview. Web UI installs and removals do **not** emit
`skills_installed` or `skills_uninstalled`: those calls live in the TUI bulk-sync
screen. Shared download/session operations can still call their own events when
used by the web UI. There is no general web UI action-counting or install/removal
coverage implied by the table.

`trackTelemetryError` adds an `errorCategory` rather than sending the exception
message or stack. Metadata labels are normalized and truncated; this is not a
semantic redaction of arbitrary property values.

Telemetry is automatically disabled in CI and other non-interactive environments.

## Disable telemetry

```bash
DISABLE_TELEMETRY=1
DO_NOT_TRACK=1
AGENTMAN_TELEMETRY_DISABLED=1
```

Any of the above will suppress it.

## Override the endpoint

```bash
AGENTMAN_TELEMETRY_URL=https://telemetry.example.com
AGENTMAN_TELEMETRY_SITE_ID=13
```

`AGENTMAN_TELEMETRY_URL` accepts either the Matomo base URL or a full `matomo.php` endpoint.
