#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { parseCli, BANNER } from "./cli.js";
import { App } from "./app.js";
import { resolveSource, resolvePersistedSource, type BundleSource } from "./bundle/source.js";
import { resolveSkillSource, type SkillSource } from "./bundle/skill-source.js";
import { addSource, classifyStoredSource } from "./bundle/cache.js";
import { startConsoleSpinner } from "./lib/console-spinner.js";
import {
    getBundleEndpointTelemetryValue,
    getBundleSourceTelemetryProperties,
    trackTelemetryError,
    trackTelemetryEvent,
} from "./telemetry.js";

const { source: sourceInput, forceUpdate, configPath, showHelp } = parseCli();

console.log(BANNER);

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
    let source: BundleSource | undefined;
    let sourceError: string | undefined;

    if (sourceInput) {
        // One-liner: resolve exactly as before, then persist the source so a
        // later bare `agentman` invocation reaches the same place.
        source = await resolveSource(sourceInput);
        await addSource(classifyStoredSource(sourceInput), { setActive: true });
    } else {
        try {
            const resolved = await resolvePersistedSource();
            // No persisted source is not fatal: the TUI still opens so the user can
            // reach Source Management and add one, instead of hitting a dead end.
            source = resolved?.source;
        } catch (err) {
            // All configured sources failed to resolve (e.g. unreachable URLs).
            // Also not fatal: fall through to the TUI with the failure surfaced,
            // instead of exiting the process outright.
            trackTelemetryError("bundle_source_resolve_failed", err, telemetryForInput(sourceInput));
            sourceError = err instanceof Error ? err.message : String(err);
        }
    }

    spinner.stop();
    if (source) {
        trackTelemetryEvent({
            action: "agentman_started",
            properties: { forceUpdate, ...getBundleSourceTelemetryProperties(source) },
        });
    }

    render(<App source={source} forceUpdate={forceUpdate} sourceError={sourceError} />);
} catch (err) {
    spinner.stop();
    trackTelemetryError("bundle_source_resolve_failed", err, telemetryForInput(sourceInput));
    trackTelemetryError("agentman_start_failed", err, telemetryForInput(sourceInput));
    console.log(`  Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
}

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
