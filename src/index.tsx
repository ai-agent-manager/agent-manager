#!/usr/bin/env node
import { installMutationSignalHandlers } from "./lib/mutation.js";
import { parseCli, BANNER } from "./cli.js";
import type { BundleSource } from "./bundle/source.js";
import { resolveStartupSource } from "./operations/session.js";
import { resolveSkillSource, type SkillSource } from "./bundle/skill-source.js";
import { startConsoleSpinner } from "./lib/console-spinner.js";
import {
    getBundleEndpointTelemetryValue,
    getBundleSourceTelemetryProperties,
    trackTelemetryError,
    trackTelemetryEvent,
} from "./telemetry.js";

async function main(): Promise<void> {
    const cli = parseCli();
    const { source: sourceInput, forceUpdate, configPath, showHelp } = cli;

    console.log(BANNER);

    if (cli.command === 'ui') {
        const { runUiCommand } = await import('./ui-command.js');
        await runUiCommand({ startupSource: sourceInput, forceUpdate, port: cli.port,
            portExplicit: cli.portExplicit, open: cli.open, cwd: process.cwd() });
        return;
    }

    installMutationSignalHandlers();

    // Headless mode is strict: it requires an explicit source argument and never
    // falls back to persisted sources, so a CI run stays reproducible regardless of
    // the config saved on the machine.
    if (configPath) {
        if (!sourceInput) {
            console.log("  Error: --config requires a source argument.\n");
            showHelp();
            process.exit(1);
        }

        try {
            // Use the new multi-source resolver for headless mode
            const skillSource = await resolveSkillSource(sourceInput);
            // Map to legacy BundleSource for telemetry compatibility
            const source = skillSourceToBundleSource(skillSource);
            trackTelemetryEvent({
                action: "agentman_started",
                properties: { forceUpdate, ...getBundleSourceTelemetryProperties(source) },
            });
            const { runHeadless } = await import("./headless.js");
            await runHeadless(sourceInput, configPath, forceUpdate);
            process.exit(0);
        } catch (err) {
            trackTelemetryError("agentman_start_failed", err, telemetryForInput(sourceInput));
            console.log(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
            process.exit(1);
        }
    }

    const spinner = startConsoleSpinner("Resolving source...");

    try {
        const { source, directInstallSource, sourceError } = await resolveStartupSource(sourceInput);

        spinner.stop();
        const telemetrySource = source ?? directInstallSource;
        if (telemetrySource) {
            trackTelemetryEvent({
                action: "agentman_started",
                properties: {
                    forceUpdate,
                    ...getBundleSourceTelemetryProperties(
                        telemetrySource.type === "repo"
                            ? skillSourceToBundleSource(telemetrySource)
                            : telemetrySource,
                    ),
                },
            });
        }

        const [{ render }, { App }] = await Promise.all([
            import('ink'), import('./app.js'),
        ]);
        render(
            <App
                source={source}
                directInstallSource={directInstallSource}
                forceUpdate={forceUpdate}
                sourceError={sourceError}
            />,
        );
    } catch (err) {
        spinner.stop();
        trackTelemetryError("bundle_source_resolve_failed", err, telemetryForInput(sourceInput));
        trackTelemetryError("agentman_start_failed", err, telemetryForInput(sourceInput));
        console.log(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
    }

}

await main().catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});

function telemetryForInput(input: string | undefined): { source: string; bundleEndpoint: string } {
    if (input && /^https?:\/\//i.test(input)) {
        return { source: "url", bundleEndpoint: getBundleEndpointTelemetryValue(input) };
    }
    if (input) {
        return { source: "directory", bundleEndpoint: "local-directory" };
    }
    return { source: "persisted", bundleEndpoint: "persisted-source" };
}

/**
 * Convert a SkillSource to a legacy BundleSource for telemetry compatibility.
 * This is a temporary bridge until telemetry is updated to understand SkillSource.
 */
function skillSourceToBundleSource(source: SkillSource): BundleSource {
    if (source.type === 'bundle') {
        if (source.dirPath) {
            return { type: 'directory', dirPath: source.dirPath };
        }
        return { type: 'url', baseUrl: source.baseUrl ?? '' };
    }
    // For repo and artefact sources, map to URL type for telemetry
    if (source.type === 'repo') {
        return { type: 'url', baseUrl: source.repoUrl };
    }
    // source.type === 'artefact'
    return { type: 'url', baseUrl: source.artefactUrl };
}
