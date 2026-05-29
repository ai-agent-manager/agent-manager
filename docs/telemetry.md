# Telemetry

Agent Manager sends a small set of anonymous usage events to help understand adoption and catch operational failures. No prompts, skill content, repo names, file paths, or personal identifiers are ever sent.

Tracked events include CLI start, bundle download outcomes, skill install/uninstall, update checks, and Rovo provisioning outcomes — plus coarse error categories for failures.

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
