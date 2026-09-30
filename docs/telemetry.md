# Telemetry

You can choose to have Agent Manager sends a small set of anonymous usage events to help you understand adoption and catch operational failures.

Agent Manager currently supports the following telemetry providers:

- Matamo

> [!NOTE]
> No prompts, skill content, repo names, file paths, codebase files or personal identifiers are ever sent.

Events you can track include CLI start, skill/agent download outcomes, skill install/uninstall, update checks, and Rovo provisioning outcomes — plus coarse error categories for failures.

Telemetry has to be enabled explicitly by you in your [agent discovery file](discovery.md).

Even if configured with your telemetry endpoint, collection is also automatically disabled in CI and other non-interactive environments.

## Set-up telemetry

See the _Discovery Document Format_* section of the [agent discovery file](discovery.md) documentation.

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
